import { CHIPS_PER_BB, RANKS, SCHEMA_VERSION, STAKES, SUITS, TIERS } from '../shared/schemas.js';

// A small, deterministic hand for developing the UI before the engine is available.
// Every state and event uses the public schema; no display-only fields are mixed in.
const HOLES = [['Qs', 'Qc'], ['Jh', 'Th'], ['5c', '5d'], ['As', 'Kd'], ['Ad', 'Jc'], ['9h', '9d']];
const RUNOUT = ['Ah', '7d', '2c', '9s', '3h'];
const NAMES = ['Mika', 'Sage', 'Noor', 'Hero', 'Lena', 'Rui'];
const COLORS = ['#d38b64', '#9b82c7', '#5eaaa3', '#f2c76d', '#b77d9e', '#6d9acc'];
const BASE_TIERS = ['fish', 'lowReg', 'midReg', null, 'fish', 'lowReg'];

function profile(seat, tier) {
  if (!tier) return null;
  return {
    id: `mock-${seat}-${tier}`, name: NAMES[seat], tier,
    avatar: { color: COLORS[seat], initials: NAMES[seat].slice(0, 2).toUpperCase() },
    vpip: tier === 'fish' ? 0.52 : 0.25,
    pfr: tier === 'fish' ? 0.11 : 0.19,
    threeBet: tier === 'fish' ? 0.03 : 0.07,
    aggression: tier === 'fish' ? 0.9 : 2.5,
    bluffFreq: tier === 'fish' ? 0.1 : 0.23,
    foldToBet: tier === 'fish' ? 0.28 : 0.44,
    skill: tier === 'fish' ? 0.2 : 0.6,
    usesCharts: tier === 'midReg' || tier === 'toughReg',
    textureSizing: tier === 'midReg' || tier === 'toughReg',
    mixing: tier === 'toughReg',
    exploitsHero: tier === 'toughReg',
  };
}

function deckAfterHole() {
  const dealt = new Set(HOLES.flat());
  const rest = RANKS.flatMap(rank => SUITS.map(suit => rank + suit)).filter(card => !dealt.has(card));
  return [...RUNOUT, ...rest.filter(card => !RUNOUT.includes(card))];
}

function event(state, type, fields = {}) {
  state.events.push({ seq: state.events.length, type, street: state.street, ...fields });
}

function tierForSeat(seat, poolOverride) {
  if (seat === 3) return null;
  if (!poolOverride) return BASE_TIERS[seat];
  const roll = ((seat * 37 + 17) % 100) / 100;
  let cumulative = 0;
  for (const tier of TIERS) {
    cumulative += poolOverride[tier] ?? 0;
    if (roll < cumulative) return tier;
  }
  return TIERS.at(-1);
}

/** @returns {import('../shared/schemas.js').GameState} */
export function createMockGameState({ stakes = 'micro', handNumber = 1, poolOverride = null } = {}) {
  if (!STAKES[stakes]) throw new RangeError(`Unknown stakes: ${stakes}`);
  const players = HOLES.map((holeCards, seat) => {
    const tier = tierForSeat(seat, poolOverride);
    const blind = seat === 4 ? STAKES[stakes].sbChips : seat === 5 ? CHIPS_PER_BB : 0;
    return {
      seat, name: NAMES[seat], isHero: seat === 3,
      position: ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'][seat],
      profile: profile(seat, tier), startStack: 10000, stack: 10000 - blind,
      committedStreet: blind, committedTotal: blind, holeCards: [...holeCards],
      folded: false, allIn: false, hasActed: false,
    };
  });
  const state = {
    schemaVersion: SCHEMA_VERSION, handId: `mock-hand-${handNumber}`,
    seed: handNumber, stakes, numPlayers: 6, buttonSeat: 3, sbSeat: 4, bbSeat: 5,
    heroSeat: 3, players, street: 'preflop', board: [], deck: deckAfterHole(),
    potCollected: 0, currentBet: CHIPS_PER_BB, lastRaiseSize: CHIPS_PER_BB,
    actingSeat: 3, lastAggressorSeat: null, preflopAggressorSeat: null,
    events: [], result: null,
  };
  event(state, 'postBlind', { seat: 4, blind: 'SB', amount: STAKES[stakes].sbChips });
  event(state, 'postBlind', { seat: 5, blind: 'BB', amount: CHIPS_PER_BB });
  for (const player of players) event(state, 'dealHole', { seat: player.seat, cards: [...player.holeCards] });
  for (const seat of [0, 1, 2]) addAction(state, seat, 'fold', 0);
  return state;
}

function addAction(state, seat, action, amount) {
  const player = state.players[seat];
  const potBefore = state.potCollected + state.players.reduce((sum, p) => sum + p.committedStreet, 0);
  const toCall = Math.max(0, state.currentBet - player.committedStreet);
  const stackBefore = player.stack;
  player.stack -= amount;
  player.committedStreet += amount;
  player.committedTotal += amount;
  player.folded = action === 'fold';
  player.allIn = player.stack === 0;
  player.hasActed = true;
  if (action === 'bet' || action === 'raise') {
    state.lastRaiseSize = player.committedStreet - state.currentBet;
    state.currentBet = player.committedStreet;
    state.lastAggressorSeat = seat;
    if (state.street === 'preflop') state.preflopAggressorSeat = seat;
  }
  event(state, 'action', {
    seat, action, amount, to: player.committedStreet, allIn: player.allIn,
    potBefore, toCall, stackBefore,
  });
}

function collect(state) {
  state.potCollected += state.players.reduce((sum, p) => sum + p.committedStreet, 0);
  for (const player of state.players) {
    player.committedStreet = 0;
    player.hasActed = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = CHIPS_PER_BB;
  state.lastAggressorSeat = null;
}

function deal(state, street, count) {
  state.street = street;
  const cards = state.deck.splice(0, count);
  state.board.push(...cards);
  event(state, 'board', { cards });
}

function finish(state, winnerSeat, showdown) {
  collect(state);
  state.street = showdown ? 'showdown' : 'preflop';
  if (showdown) {
    for (const seat of [3, 5]) {
      event(state, 'showdown', {
        seat, cards: [...state.players[seat].holeCards],
        handLabel: seat === 5 ? 'Three of a Kind, Nines' : 'Pair of Aces',
      });
    }
  }
  const rakeChips = showdown
    ? Math.floor(Math.min(state.potCollected * STAKES[state.stakes].rakePct, STAKES[state.stakes].rakeCapBb * CHIPS_PER_BB))
    : 0;
  if (rakeChips) event(state, 'rake', { amount: rakeChips });
  const award = state.potCollected - rakeChips;
  event(state, 'award', { seat: winnerSeat, amount: award, potIndex: 0 });
  const netChips = state.players.map(p => (p.seat === winnerSeat ? award : 0) - p.committedTotal);
  const heroAllInEvent = state.events.find(entry => entry.type === 'action' && entry.seat === 3 && entry.allIn);
  const heroAllIn = showdown && Boolean(heroAllInEvent);
  state.result = {
    pots: [{ amount: award, eligibleSeats: showdown ? [3, 5] : [5], winnerSeats: [winnerSeat] }],
    rakeChips, netChips, showdownSeats: showdown ? [3, 5] : [],
    heroAllInEv: heroAllIn ? {
      street: heroAllInEvent.street, heroEquity: 0.47,
      evNetChips: Math.round(award * 0.47 - state.players[3].committedTotal),
    } : null,
  };
  state.street = 'complete';
  state.actingSeat = null;
}

/** Legal hero actions for the current mock state, with engine-style chip amounts. */
export function getMockLegalActions(state) {
  if (state.actingSeat !== state.heroSeat || state.street === 'complete') return null;
  const hero = state.players[state.heroSeat];
  const toCall = Math.max(0, state.currentBet - hero.committedStreet);
  const maxTo = hero.committedStreet + hero.stack;
  const minTo = state.currentBet + state.lastRaiseSize;
  return {
    seat: hero.seat,
    types: toCall ? ['fold', 'call', ...(maxTo > state.currentBet ? ['raise'] : [])]
      : ['check', ...(hero.stack ? ['bet'] : [])],
    toCall, minTo: maxTo > state.currentBet ? Math.min(minTo, maxTo) : 0,
    maxTo,
  };
}

/** An interactive mock adapter used by the static demo entry point. */
export function createMockSession(settings = {}) {
  let handNumber = 1;
  let state = createMockGameState({ ...settings, handNumber });
  return {
    getState: () => state,
    getLegalActions: () => getMockLegalActions(state),
    act(action) {
      const legal = getMockLegalActions(state);
      if (!legal?.types.includes(action.type)) throw new RangeError('Illegal mock action');
      const hero = state.players[state.heroSeat];
      const amount = action.type === 'call' ? Math.min(legal.toCall, hero.stack)
        : action.type === 'bet' || action.type === 'raise'
          ? action.amount - hero.committedStreet : 0;
      if (amount < 0 || amount > hero.stack ||
        (['bet', 'raise'].includes(action.type) && (action.amount < legal.minTo || action.amount > legal.maxTo))) {
        throw new RangeError('Illegal mock amount');
      }
      addAction(state, state.heroSeat, action.type, amount);
      if (action.type === 'fold') {
        addAction(state, 4, 'fold', 0);
        finish(state, 5, false);
        return state;
      }
      if (state.street === 'preflop') {
        addAction(state, 4, 'fold', 0);
        const bbCall = Math.min(state.currentBet - state.players[5].committedStreet, state.players[5].stack);
        addAction(state, 5, bbCall ? 'call' : 'check', bbCall);
        collect(state);
        deal(state, 'flop', 3);
      } else {
        const bbCall = Math.min(state.currentBet - state.players[5].committedStreet, state.players[5].stack);
        addAction(state, 5, bbCall ? 'call' : 'check', bbCall);
        collect(state);
        if (state.street === 'flop') deal(state, 'turn', 1);
        else if (state.street === 'turn') deal(state, 'river', 1);
        else { finish(state, 5, true); return state; }
      }
      while (hero.allIn || state.players[5].allIn) {
        if (state.street === 'flop') deal(state, 'turn', 1);
        else if (state.street === 'turn') deal(state, 'river', 1);
        else break;
      }
      if (hero.allIn || state.players[5].allIn) finish(state, 5, true);
      else {
        addAction(state, 5, 'check', 0);
        state.actingSeat = state.heroSeat;
      }
      return state;
    },
    newHand(nextSettings = settings) {
      return this.nextHand(nextSettings);
    },
    nextHand(nextSettings = settings) {
      settings = nextSettings;
      state = createMockGameState({ ...settings, handNumber: ++handNumber });
      return state;
    },
  };
}

export const MOCK_GAME_STATE = createMockGameState();
export const MOCK_EVENTS = MOCK_GAME_STATE.events;
