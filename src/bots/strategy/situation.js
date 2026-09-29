// Reads a SeatView into the facts the strategy needs: preflop spot, stack depth, live opponents,
// who did what, and position. Pure; never looks at hidden cards.
import { CHIPS_PER_BB } from '../../shared/schemas.js';

/**
 * The effective big blind in chips preflop: the straddle when one was posted, else 1bb.
 * Bots size opens and read stack depth in these units.
 */
export function effectiveBlind(view) {
  const straddle = view.events.find((e) => e.type === 'postBlind' && e.blind === 'straddle');
  return Math.max(CHIPS_PER_BB, straddle?.amount ?? 0);
}

/** Position for charts: the straddler plays its option like the big blind. */
export function chartPosition(view) {
  return view.straddleSeat != null && view.straddleSeat === view.seat ? 'BB' : view.position;
}

export function depthBand(effBb) {
  if (effBb <= 40) return 'short';
  if (effBb <= 100) return 'mid';
  return 'deep';
}

/**
 * Per-seat preflop summary from the event log.
 * raiseIndex: 1 = open/iso, 2 = 3-bet, 3+ = 4-bet and up (the highest raise the seat made).
 * @returns {Map<number, {raiseIndex: number, called: boolean, facingRaises: number, limped: boolean}>}
 */
export function preflopActions(view) {
  const bySeat = new Map();
  let raises = 0;
  for (const e of view.events) {
    if (e.type !== 'action' || e.street !== 'preflop') continue;
    const row = bySeat.get(e.seat) ?? { raiseIndex: 0, called: false, facingRaises: 0, limped: false };
    if (e.action === 'raise' || e.action === 'bet') {
      raises++;
      row.raiseIndex = raises;
    } else if (e.action === 'call') {
      row.called = true;
      row.facingRaises = Math.max(row.facingRaises, raises);
      if (raises === 0) row.limped = true;
    }
    bySeat.set(e.seat, row);
  }
  return bySeat;
}

/**
 * The preflop spot for the acting seat.
 * @returns {{spot: 'unopened'|'limped'|'raised'|'threeBet'|'fourBetPlus', raises: number, limpers: number,
 *            callers: number, raiserSeat: number|null}}
 */
export function preflopSpot(view) {
  let raises = 0;
  let limpers = 0;
  let callers = 0;
  let raiserSeat = null;
  for (const e of view.events) {
    if (e.type !== 'action' || e.street !== 'preflop') continue;
    if (e.action === 'raise' || e.action === 'bet') {
      raises++;
      callers = 0;
      raiserSeat = e.seat;
    } else if (e.action === 'call') {
      if (raises === 0) limpers++;
      else callers++;
    }
  }
  const spot = raises === 0 ? (limpers > 0 ? 'limped' : 'unopened')
    : raises === 1 ? 'raised' : raises === 2 ? 'threeBet' : 'fourBetPlus';
  return { spot, raises, limpers, callers, raiserSeat };
}

/** Players still in the hand other than `seat`. */
export function liveOpponents(view) {
  return view.players.filter((p) => p.seat !== view.seat && !p.folded);
}

/** Chips a player started the hand with (stack behind + everything committed). */
const totalChips = (p) => p.stack + p.committedTotal;

/** Effective stack in bb against the deepest live opponent. */
export function effectiveStackBb(view) {
  const me = view.players[view.seat];
  const opps = liveOpponents(view);
  const deepest = opps.length ? Math.max(...opps.map(totalChips)) : totalChips(me);
  return Math.min(totalChips(me), deepest) / CHIPS_PER_BB;
}

/** Postflop acting order: from the seat after the button, clockwise (heads-up: BB first). */
export function postflopOrder(view) {
  const order = [];
  for (let i = 1; i <= view.numPlayers; i++) order.push((view.buttonSeat + i) % view.numPlayers);
  return order;
}

/** True when this seat acts last postflop among players still in the hand. */
export function inPosition(view) {
  const live = postflopOrder(view).filter((s) => !view.players[s].folded);
  return live[live.length - 1] === view.seat;
}

/**
 * Postflop aggression per seat: bets/raises on the current street and on earlier postflop streets.
 * @returns {Map<number, {current: number, earlier: number}>}
 */
export function postflopAggression(view) {
  const out = new Map();
  for (const e of view.events) {
    if (e.type !== 'action' || e.street === 'preflop') continue;
    if (e.action !== 'bet' && e.action !== 'raise') continue;
    const row = out.get(e.seat) ?? { current: 0, earlier: 0 };
    if (e.street === view.street) row.current++;
    else row.earlier++;
    out.set(e.seat, row);
  }
  return out;
}

