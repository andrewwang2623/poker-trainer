// No-Limit Hold'em hand state machine. All amounts are integer chips.
// applyAction never mutates its input: every transition works on a shallow-cloned state
// (event objects and hole-card arrays are never mutated once created, so they're shared).
import {
  SCHEMA_VERSION, CHIPS_PER_BB, STAKES, POSITIONS_BY_SIZE, MIN_PLAYERS, MAX_PLAYERS,
} from '../shared/schemas.js';
import { createRng, deriveSeed } from './rng.js';
import { sha256Hex } from './sha256.js';
import { isValidCreatedAt, straddlePosition, STRADDLE_CHIPS } from './scenario.js';
import { fullDeck, shuffle, cardCode, isValidCard } from './cards.js';
import { evaluateCodes, scoreLabel } from './evaluator.js';
import { forEachRunout } from './equity.js';

const BB = CHIPS_PER_BB;
const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const CARDS_PER_STREET = { flop: 3, turn: 1, river: 1 };
const ALL_IN_EV_SAMPLES = 20000;

// ---------------------------------------------------------------------------
// Hand setup
// ---------------------------------------------------------------------------

/**
 * base36 createdAt, a dash, then the first 8 hex chars of SHA-256(String(seed)) (SPEC §5).
 * The hash is one-way, so the id (visible in every SeatView) doesn't reveal the seed.
 */
export function makeHandId(createdAt, seed) {
  return `${createdAt.toString(36)}-${sha256Hex(String(seed)).slice(0, 8)}`;
}

function validateScenario(sc) {
  if (!sc || typeof sc !== 'object') throw new TypeError('createHand: scenario required');
  if (!STAKES[sc.stakes]) throw new RangeError(`Unknown stakes: ${sc.stakes}`);
  if (!isValidCreatedAt(sc.createdAt)) throw new TypeError('createHand: scenario.createdAt must be ms since epoch');
  const n = sc.numPlayers;
  if (!Number.isInteger(n) || n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new RangeError(`numPlayers must be ${MIN_PLAYERS}..${MAX_PLAYERS}`);
  }
  if (!Array.isArray(sc.seats) || sc.seats.length !== n) throw new RangeError('seats must have numPlayers entries');
  for (const key of ['buttonSeat', 'heroSeat']) {
    if (!Number.isInteger(sc[key]) || sc[key] < 0 || sc[key] >= n) throw new RangeError(`bad ${key}`);
  }
  const seen = new Set();
  for (const s of sc.seats) {
    if (!Number.isInteger(s.seat) || s.seat < 0 || s.seat >= n || seen.has(s.seat)) {
      throw new RangeError('seats must cover 0..numPlayers-1 exactly once');
    }
    seen.add(s.seat);
    if (!Number.isInteger(s.stack) || s.stack <= 0) throw new RangeError(`seat ${s.seat}: stack must be a positive integer`);
  }
  const straddleSeat = sc.straddleSeat ?? null;
  if (straddleSeat !== null) {
    if (straddleSeat !== straddlePosition(n, sc.buttonSeat)) {
      throw new RangeError('straddleSeat must be the first seat after the BB at a 3+ player table');
    }
    if (sc.seats.find((s) => s.seat === straddleSeat).stack <= STRADDLE_CHIPS) {
      throw new RangeError('straddleSeat needs a stack above 2bb');
    }
  }
}

/**
 * Build a new hand: shuffle with rng(deriveSeed(seed, 'deck')), post blinds (and the live 2bb
 * straddle when scenario.straddleSeat is set), deal hole cards.
 * @param {import('../shared/schemas.js').ScenarioConfig} scenario
 * @param {{cards?: {holes?: Object<number, string[]>, board?: string[]}}} [opts]
 *   `cards` presets specific hole cards and/or the first board cards (tests and replays).
 *   Unset cards are dealt from the seeded shuffle.
 * @returns {import('../shared/schemas.js').GameState}
 */
export function createHand(scenario, opts = {}) {
  validateScenario(scenario);
  const n = scenario.numPlayers;
  const stakes = STAKES[scenario.stakes];
  const buttonSeat = scenario.buttonSeat;
  const sbSeat = n === 2 ? buttonSeat : (buttonSeat + 1) % n;
  const bbSeat = (sbSeat + 1) % n;
  const positions = POSITIONS_BY_SIZE[n]; // positions[i] belongs to seat bbSeat + 1 + i

  // The deck gets its own stream: createScenario already consumed createRng(seed), and reusing it
  // made the deal depend on table size (SPEC §13 item 11).
  let deck = shuffle(fullDeck(), createRng(deriveSeed(scenario.seed, 'deck')));
  const presetHoles = opts.cards?.holes ?? {};
  const presetBoard = opts.cards?.board ?? [];
  const presetAll = [...Object.values(presetHoles).flat(), ...presetBoard];
  if (presetAll.some((c) => !isValidCard(c)) || new Set(presetAll).size !== presetAll.length) {
    throw new RangeError('createHand: preset cards must be valid and distinct');
  }
  if (presetBoard.length > 5) throw new RangeError('createHand: preset board has more than 5 cards');
  deck = deck.filter((c) => !presetAll.includes(c));

  const bySeat = [...scenario.seats].sort((a, b) => a.seat - b.seat);
  const players = bySeat.map((cfg) => {
    const isHero = cfg.seat === scenario.heroSeat;
    return {
      seat: cfg.seat,
      name: isHero ? 'Hero' : (cfg.profile?.name ?? `Seat ${cfg.seat + 1}`),
      isHero,
      position: positions[(cfg.seat - bbSeat - 1 + 2 * n) % n],
      profile: isHero ? null : (cfg.profile ?? null),
      startStack: cfg.stack,
      stack: cfg.stack,
      committedStreet: 0,
      committedTotal: 0,
      holeCards: [],
      folded: false,
      allIn: false,
      hasActed: false,
    };
  });

  const straddleSeat = scenario.straddleSeat ?? null;
  const s = {
    schemaVersion: SCHEMA_VERSION,
    handId: makeHandId(scenario.createdAt, scenario.seed),
    seed: scenario.seed,
    stakes: scenario.stakes,
    numPlayers: n,
    buttonSeat,
    sbSeat,
    bbSeat,
    heroSeat: scenario.heroSeat,
    straddleSeat,
    players,
    street: 'preflop',
    board: [],
    deck: [],
    potCollected: 0,
    currentBet: 0,
    lastRaiseSize: BB,
    actingSeat: null,
    lastAggressorSeat: null,
    preflopAggressorSeat: null,
    events: [],
    result: null,
  };

  const posts = [[sbSeat, 'SB', stakes.sbChips], [bbSeat, 'BB', BB]];
  // A live straddle is a third blind: it sets the bet to 2bb and the min raise to 4bb.
  if (straddleSeat !== null) posts.push([straddleSeat, 'straddle', STRADDLE_CHIPS]);
  for (const [seat, blind, size] of posts) {
    const p = players[seat];
    const amount = Math.min(size, p.stack);
    commit(p, amount);
    pushEvent(s, { type: 'postBlind', street: 'preflop', seat, blind, amount });
  }
  s.currentBet = Math.max(...posts.map(([seat]) => players[seat].committedStreet));
  if (straddleSeat !== null) s.lastRaiseSize = STRADDLE_CHIPS;

  // Deal one card at a time, starting left of the button (the SB).
  const dealOrder = Array.from({ length: n }, (_, i) => (sbSeat + i) % n);
  const holes = players.map((p) => presetHoles[p.seat]?.slice() ?? []);
  for (let round = 0; round < 2; round++) {
    for (const seat of dealOrder) {
      if (!presetHoles[seat]) holes[seat].push(deck.shift());
    }
  }
  for (const seat of dealOrder) {
    if (holes[seat].length !== 2) throw new RangeError(`createHand: seat ${seat} preset needs 2 cards`);
    players[seat].holeCards = holes[seat];
    pushEvent(s, { type: 'dealHole', street: 'preflop', seat, cards: holes[seat] });
  }
  s.deck = [...presetBoard, ...deck];

  // Action starts left of the last live blind; the straddler (like the BB) keeps its option.
  progress(s, straddleSeat ?? bbSeat);
  return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushEvent(s, e) {
  s.events.push({ seq: s.events.length, ...e });
}

function commit(p, amount) {
  p.stack -= amount;
  p.committedStreet += amount;
  p.committedTotal += amount;
  if (p.stack === 0) p.allIn = true;
}

function cloneState(state) {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    board: state.board.slice(),
    deck: state.deck.slice(),
    events: state.events.slice(),
  };
}

function totalPot(s) {
  return s.potCollected + s.players.reduce((sum, p) => sum + p.committedStreet, 0);
}

const isLive = (p) => !p.folded;
const canAct = (p) => !p.folded && !p.allIn;

function needsAction(s, p) {
  if (!canAct(p)) return false;
  if (p.committedStreet < s.currentBet) return true;
  if (p.hasActed) return false;
  // Unacted but matched: only worth asking if someone could respond to a bet.
  return s.players.some((o) => o !== p && canAct(o));
}

/** First seat clockwise after `fromSeat` that needs to act, or null. */
function findNextToAct(s, fromSeat) {
  for (let i = 1; i <= s.numPlayers; i++) {
    const p = s.players[(fromSeat + i) % s.numPlayers];
    if (needsAction(s, p)) return p.seat;
  }
  return null;
}

/** Seats ordered clockwise starting left of the button. */
function seatsFromButton(s) {
  return Array.from({ length: s.numPlayers }, (_, i) => (s.buttonSeat + 1 + i) % s.numPlayers);
}

function computeRake(potTotal, stakesId, flopDealt) {
  const st = STAKES[stakesId];
  if (!flopDealt && st.noFlopNoDrop) return 0;
  const bps = Math.round(st.rakePct * 10000);
  const raw = Math.floor((potTotal * bps) / 10000);
  return Math.min(raw, Math.round(st.rakeCapBb * BB));
}

/**
 * Main pot + side pots from committedTotal. Folded chips count toward pots but folded seats
 * aren't eligible. Pots are ordered main first.
 * @returns {{amount: number, eligibleSeats: number[], winnerSeats: number[]}[]}
 */
export function buildPots(players) {
  const levels = [...new Set(players.filter(isLive).map((p) => p.committedTotal))]
    .filter((l) => l > 0)
    .sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.min(p.committedTotal, level) - Math.min(p.committedTotal, prev);
    const eligibleSeats = players.filter((p) => isLive(p) && p.committedTotal >= level).map((p) => p.seat);
    if (amount > 0) pots.push({ amount, eligibleSeats, winnerSeats: [] });
    prev = level;
  }
  // Dead chips above the top live level (can't normally happen after uncalled returns).
  const extra = players.reduce((sum, p) => sum + Math.max(0, p.committedTotal - prev), 0);
  if (extra > 0 && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

/** Take rake off pots main-first. Mutates pots. */
function applyRake(pots, rake) {
  let left = rake;
  for (const pot of pots) {
    const take = Math.min(left, pot.amount);
    pot.amount -= take;
    left -= take;
  }
}

// ---------------------------------------------------------------------------
// Street flow
// ---------------------------------------------------------------------------

/** Return any uncalled excess, then move street bets into potCollected. */
function closeStreet(s) {
  const sorted = [...s.players].sort((a, b) => b.committedStreet - a.committedStreet);
  const [top, second] = sorted;
  const excess = top.committedStreet - (second ? second.committedStreet : 0);
  if (excess > 0) {
    top.committedStreet -= excess;
    top.committedTotal -= excess;
    top.stack += excess;
    top.allIn = top.stack === 0;
    pushEvent(s, { type: 'uncalled', street: s.street, seat: top.seat, amount: excess });
  }
  for (const p of s.players) {
    s.potCollected += p.committedStreet;
    p.committedStreet = 0;
  }
  s.currentBet = 0;
  s.actingSeat = null;
}

function dealNextStreet(s) {
  const next = STREET_ORDER[STREET_ORDER.indexOf(s.street) + 1];
  const cards = s.deck.slice(0, CARDS_PER_STREET[next]);
  s.deck = s.deck.slice(CARDS_PER_STREET[next]);
  s.board = [...s.board, ...cards];
  s.street = next;
  s.currentBet = 0;
  s.lastRaiseSize = BB;
  s.lastAggressorSeat = null;
  for (const p of s.players) p.hasActed = false;
  pushEvent(s, { type: 'board', street: next, cards });
}

/** Decide who acts next, or advance streets / finish the hand when betting is closed. */
function progress(s, fromSeat) {
  if (s.players.filter(isLive).length === 1) {
    closeStreet(s);
    finishHand(s, false);
    return;
  }
  const next = findNextToAct(s, fromSeat);
  if (next !== null) {
    s.actingSeat = next;
    return;
  }
  closeStreet(s);
  if (s.street === 'river') {
    finishHand(s, true);
    return;
  }
  if (s.players.filter(canAct).length <= 1) {
    // No more betting possible: run the board out.
    const heroAllInEv = computeHeroAllInEv(s);
    while (s.board.length < 5) dealNextStreet(s);
    finishHand(s, true, heroAllInEv);
    return;
  }
  dealNextStreet(s);
  s.actingSeat = findNextToAct(s, s.buttonSeat);
}

function finishHand(s, isShowdown, heroAllInEv = null) {
  const endStreet = isShowdown ? 'showdown' : s.street;
  const live = s.players.filter(isLive);
  const scores = new Map();
  const showdownSeats = [];

  if (isShowdown) {
    s.street = 'showdown';
    const boardCodes = s.board.map(cardCode);
    // Last river aggressor shows first, otherwise first live seat left of the button.
    const order = seatsFromButton(s);
    if (s.lastAggressorSeat !== null && isLive(s.players[s.lastAggressorSeat])) {
      const i = order.indexOf(s.lastAggressorSeat);
      order.push(...order.splice(0, i));
    }
    for (const seat of order) {
      const p = s.players[seat];
      if (!isLive(p)) continue;
      const score = evaluateCodes([...p.holeCards.map(cardCode), ...boardCodes]);
      scores.set(seat, score);
      showdownSeats.push(seat);
      pushEvent(s, { type: 'showdown', street: 'showdown', seat, cards: p.holeCards, handLabel: scoreLabel(score) });
    }
  }

  const pots = buildPots(s.players);
  const potTotal = pots.reduce((sum, p) => sum + p.amount, 0);
  const rakeChips = computeRake(potTotal, s.stakes, s.board.length >= 3);
  if (rakeChips > 0) {
    applyRake(pots, rakeChips);
    pushEvent(s, { type: 'rake', street: endStreet, amount: rakeChips });
  }

  const clockwise = seatsFromButton(s);
  pots.forEach((pot, potIndex) => {
    let winners;
    if (pot.eligibleSeats.length === 1 || !isShowdown) {
      winners = pot.eligibleSeats.length === 1 ? pot.eligibleSeats : [live[0].seat];
    } else {
      const best = Math.max(...pot.eligibleSeats.map((seat) => scores.get(seat)));
      winners = pot.eligibleSeats.filter((seat) => scores.get(seat) === best);
    }
    winners = clockwise.filter((seat) => winners.includes(seat));
    pot.winnerSeats = winners;
    const share = Math.floor(pot.amount / winners.length);
    const odd = pot.amount - share * winners.length;
    winners.forEach((seat, i) => {
      const amount = share + (i === 0 ? odd : 0); // odd chips to the first winner left of the button
      if (amount <= 0) return;
      s.players[seat].stack += amount;
      pushEvent(s, { type: 'award', street: endStreet, seat, amount, potIndex });
    });
  });

  s.street = 'complete';
  s.actingSeat = null;
  s.result = {
    pots,
    rakeChips,
    netChips: s.players.map((p) => p.stack - p.startStack),
    showdownSeats,
    heroAllInEv,
  };
}

/**
 * Hero's all-in EV when betting has closed with board cards still to come.
 * Exact for 1–2 cards to come, 20,000-sample Monte Carlo otherwise. Folded hands are treated
 * as unknown (they stay in the stub).
 */
function computeHeroAllInEv(s) {
  const hero = s.players[s.heroSeat];
  if (!isLive(hero) || s.board.length >= 5) return null;
  const live = s.players.filter(isLive);
  const pots = buildPots(s.players);
  const gross = pots.map((p) => p.amount);
  const grossTotal = gross.reduce((a, b) => a + b, 0);
  applyRake(pots, computeRake(grossTotal, s.stakes, true));
  const net = pots.map((p) => p.amount);

  const holes = new Map(live.map((p) => [p.seat, p.holeCards.map(cardCode)]));
  const boardCodes = s.board.map(cardCode);
  const toCome = 5 - boardCodes.length;
  const hand = new Array(7);
  const scores = new Map();
  let heroGross = 0;
  let heroNet = 0;
  const count = forEachRunout({
    boardCodes,
    deadCodes: [...holes.values()].flat(),
    exact: toCome <= 2,
    iterations: ALL_IN_EV_SAMPLES,
    rng: createRng(deriveSeed(s.seed, 'allInEv')),
  }, (full) => {
    for (let i = 0; i < 5; i++) hand[i + 2] = full[i];
    for (const [seat, codes] of holes) {
      hand[0] = codes[0];
      hand[1] = codes[1];
      scores.set(seat, evaluateCodes(hand));
    }
    pots.forEach((pot, i) => {
      if (!pot.eligibleSeats.includes(hero.seat)) return;
      let best = -1;
      let k = 0;
      for (const seat of pot.eligibleSeats) {
        const sc = scores.get(seat);
        if (sc > best) { best = sc; k = 1; }
        else if (sc === best) k++;
      }
      if (scores.get(hero.seat) === best) {
        heroGross += gross[i] / k;
        heroNet += net[i] / k;
      }
    });
  });
  return {
    street: s.street,
    heroEquity: grossTotal > 0 ? heroGross / count / grossTotal : 0,
    evNetChips: Math.round((heroNet / count - hero.committedTotal) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {import('../shared/schemas.js').GameState} state
 * @returns {import('../shared/schemas.js').LegalActions|null}
 */
export function getLegalActions(state) {
  if (state.actingSeat === null || state.actingSeat === undefined || !STREET_ORDER.includes(state.street)) {
    return null;
  }
  const p = state.players[state.actingSeat];
  const owed = state.currentBet - p.committedStreet;
  const toCall = Math.max(0, Math.min(owed, p.stack));
  const maxTo = p.committedStreet + p.stack;
  const types = owed > 0 ? ['fold', 'call'] : ['check'];
  let minTo = 0;
  // Raising needs chips beyond a call, someone left to respond, and betting open to this seat
  // (a seat that already acted can't re-raise after an incomplete all-in raise).
  const othersCanAct = state.players.some((o) => o.seat !== p.seat && canAct(o));
  if (othersCanAct && p.stack > owed && !p.hasActed) {
    types.push(state.currentBet === 0 ? 'bet' : 'raise');
    minTo = Math.min(state.currentBet + state.lastRaiseSize, maxTo);
  }
  return { seat: p.seat, types, toCall, minTo, maxTo };
}

/**
 * @param {import('../shared/schemas.js').GameState} state
 * @param {import('../shared/schemas.js').Action} action
 * @returns {import('../shared/schemas.js').GameState} a new state
 * @throws {RangeError} when the action is illegal
 */
export function applyAction(state, action) {
  const legal = getLegalActions(state);
  if (!legal) throw new RangeError('No action is pending');
  if (!action || !legal.types.includes(action.type)) {
    throw new RangeError(`Illegal action ${action?.type} for seat ${legal.seat}; legal: ${legal.types.join(', ')}`);
  }
  const s = cloneState(state);
  const p = s.players[legal.seat];
  const potBefore = totalPot(s);
  const stackBefore = p.stack;
  let add = 0;

  switch (action.type) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      break;
    case 'call':
      add = legal.toCall;
      break;
    case 'bet':
    case 'raise': {
      const to = action.amount;
      if (!Number.isInteger(to) || to < legal.minTo || to > legal.maxTo) {
        throw new RangeError(`${action.type} amount must be an integer in [${legal.minTo}, ${legal.maxTo}], got ${to}`);
      }
      add = to - p.committedStreet;
      const increment = to - s.currentBet;
      // An opening bet always reopens action; a raise reopens only when it's a full raise.
      if (s.currentBet === 0 || increment >= s.lastRaiseSize) {
        s.lastRaiseSize = Math.max(increment, s.lastRaiseSize);
        for (const o of s.players) if (o !== p) o.hasActed = false;
      }
      s.currentBet = to;
      s.lastAggressorSeat = p.seat;
      if (s.street === 'preflop') s.preflopAggressorSeat = p.seat;
      break;
    }
    default:
      throw new RangeError(`Unknown action type: ${action.type}`);
  }

  commit(p, add);
  p.hasActed = true;
  pushEvent(s, {
    type: 'action',
    street: s.street,
    seat: p.seat,
    action: action.type,
    amount: add,
    to: p.committedStreet,
    allIn: add > 0 && p.stack === 0,
    potBefore,
    toCall: legal.toCall,
    stackBefore,
  });
  progress(s, p.seat);
  return s;
}

/**
 * The state as one seat may see it: no deck or seed (the deck is a pure function of the seed),
 * other seats' hole cards hidden until they show down, and other seats' dealHole events removed.
 * @returns {import('../shared/schemas.js').SeatView}
 */
export function getView(state, seat) {
  const me = state.players[seat];
  if (!me) throw new RangeError(`No seat ${seat}`);
  const shown = new Set(state.events.filter((e) => e.type === 'showdown').map((e) => e.seat));
  const { deck, seed, ...rest } = state;
  return {
    ...rest,
    seat,
    position: me.position,
    holeCards: me.holeCards.slice(),
    pot: totalPot(state),
    legal: state.actingSeat === seat ? getLegalActions(state) : null,
    players: state.players.map((p) => ({
      ...p,
      holeCards: p.seat === seat || shown.has(p.seat) ? p.holeCards.slice() : [],
    })),
    events: state.events.filter((e) => e.type !== 'dealHole' || e.seat === seat),
  };
}

export function isComplete(state) {
  return state.street === 'complete';
}
