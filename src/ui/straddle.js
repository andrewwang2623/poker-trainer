import { CHIPS_PER_BB } from '../shared/schemas.js';

const STORAGE_KEY = 'felt-theory-straddle';
const STRADDLE_CHIPS = 2 * CHIPS_PER_BB;

export function normalizeStraddle(value) {
  return {
    enabled: value?.enabled === true,
    chancePercent: Number.isInteger(value?.chancePercent) && value.chancePercent >= 0 && value.chancePercent <= 100
      ? value.chancePercent : 33,
  };
}

export function loadStraddle(storage) {
  try { return normalizeStraddle(JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return normalizeStraddle(null); }
}

export function saveStraddle(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(normalizeStraddle(value))); }
  catch { /* The setting remains usable without browser storage. */ }
}

/** Local compatibility encoding: an extra live BB post by the seat after BB.
 * See REQUESTS-astra.md. No extra schema fields or voluntary action are added.
 */
export function straddlePost(state) {
  if (state.numPlayers < 3) return null;
  const utg = (state.bbSeat + 1) % state.numPlayers;
  return state.events.find(event => event.type === 'postBlind' && event.blind === 'BB' &&
    event.seat === utg && event.amount === STRADDLE_CHIPS) ?? null;
}

/** Post a live UTG straddle without consuming the deck/bot RNG or mutating engine state. */
export function maybePostStraddle(state, value, rng) {
  const settings = normalizeStraddle(value);
  const hero = state.players[state.heroSeat];
  if (!settings.enabled || settings.chancePercent === 0 || state.numPlayers < 3 ||
      state.street !== 'preflop' || state.heroSeat !== (state.bbSeat + 1) % state.numPlayers ||
      state.actingSeat !== state.heroSeat || state.events.some(event => event.type === 'action') ||
      straddlePost(state) || hero.folded || hero.allIn || hero.stack <= STRADDLE_CHIPS ||
      hero.committedStreet !== 0 || state.currentBet !== CHIPS_PER_BB) return state;
  if (rng() >= settings.chancePercent / 100) return state;
  const next = Array.from({ length: state.numPlayers - 1 }, (_, index) =>
    state.players[(state.heroSeat + index + 1) % state.numPlayers])
    .find(player => !player.folded && !player.allIn);
  if (!next) return state;
  const post = { type: 'postBlind', street: 'preflop', seat: state.heroSeat, blind: 'BB', amount: STRADDLE_CHIPS };
  // Keep all forced posts before hole-card deals in the history.
  const dealIndex = state.events.findIndex(event => event.type === 'dealHole');
  const index = dealIndex < 0 ? state.events.length : dealIndex;
  const events = [...state.events.slice(0, index), post, ...state.events.slice(index)]
    .map((event, seq) => ({ ...event, seq }));
  return {
    ...state,
    players: state.players.map(player => player.seat !== state.heroSeat ? player : {
      ...player, stack: player.stack - STRADDLE_CHIPS,
      committedStreet: STRADDLE_CHIPS, committedTotal: player.committedTotal + STRADDLE_CHIPS,
      hasActed: false,
    }),
    currentBet: STRADDLE_CHIPS, lastRaiseSize: STRADDLE_CHIPS, actingSeat: next.seat, events,
  };
}
