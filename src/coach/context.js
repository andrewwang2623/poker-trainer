// Rebuilds the betting state at each hero decision from a HandRecord's event log: stacks, bets,
// who folded or is all-in, the legal actions (mirroring engine getLegalActions), and the preflop and
// postflop lines so far. Forced posts (blinds, straddle) are never decisions or raises.
import { CHIPS_PER_BB, STRADDLE_BB } from '../shared/schemas.js';

/**
 * @typedef {Object} SeatRow
 * @property {number} seat
 * @property {Object|null} profile
 * @property {string} position
 * @property {boolean} folded
 * @property {boolean} allIn
 * @property {number} stack            chips behind
 * @property {number} committedStreet
 */

/**
 * @typedef {Object} DecisionContext
 * @property {import('../shared/schemas.js').HeroDecision} decision
 * @property {number} heroSeat
 * @property {Object} event                   hero's action event
 * @property {Object[]} events                every event before it
 * @property {string} street
 * @property {string[]} board
 * @property {SeatRow[]} seats                index = seat
 * @property {SeatRow[]} opponents            live opponents
 * @property {{types: string[], toCall: number, minTo: number, maxTo: number}} legal  chips
 * @property {number} pot                     chips in the middle before the action
 * @property {number} heroCommitted           hero's chips in on this street before acting
 * @property {number} currentBet
 * @property {number} blind                   effective big blind in chips (the straddle when live)
 * @property {{raises: number, limpers: number, raiserSeat: number|null, raiseTo: number}} preflop
 *   raises/limpers before this preflop decision; raiserSeat/raiseTo = the last preflop raise
 * @property {number|null} preflopAggressor
 * @property {number|null} lastAggressor     last opponent to bet or raise this hand, before the decision
 * @property {number|null} streetAggressor   last opponent to bet or raise on this street
 * @property {boolean} firstFlopDecision
 */

/**
 * @param {import('../shared/schemas.js').HandRecord} record
 * @returns {DecisionContext[]} one per record.decisions entry, in order
 */
export function decisionContexts(record) {
  const n = record.numPlayers;
  const hero = record.heroSeat;
  const bySeq = new Map(record.decisions.map((d) => [d.eventSeq, d]));
  const seats = record.players.slice().sort((a, b) => a.seat - b.seat).map((p) => ({
    seat: p.seat,
    profile: p.profile ?? null,
    position: p.position,
    folded: false,
    allIn: false,
    stack: Math.round(p.startStackBb * CHIPS_PER_BB),
    committedStreet: 0,
    hasActed: false,
  }));
  let collected = 0;
  let street = 'preflop';
  const board = [];
  let currentBet = 0;
  let blind = CHIPS_PER_BB;
  let lastRaiseSize = CHIPS_PER_BB;
  let raises = 0;
  let limpers = 0;
  let raiserSeat = null;
  let raiseTo = 0;
  let preflopAggressor = null;
  let lastAggressor = null;
  let streetAggressor = null;
  let heroFlopDecisions = 0;
  const out = [];

  const commit = (p, amount) => {
    p.stack -= amount;
    p.committedStreet += amount;
    if (p.stack <= 0) p.allIn = true;
  };

  record.events.forEach((e, i) => {
    switch (e.type) {
      case 'postBlind': {
        const p = seats[e.seat];
        commit(p, e.amount);
        currentBet = Math.max(currentBet, p.committedStreet);
        if (e.blind === 'straddle') {
          blind = Math.max(CHIPS_PER_BB, STRADDLE_BB * CHIPS_PER_BB, e.amount);
          lastRaiseSize = blind;
        }
        break;
      }
      case 'uncalled': {
        const p = seats[e.seat];
        p.stack += e.amount;
        p.committedStreet -= e.amount;
        p.allIn = p.stack === 0;
        break;
      }
      case 'board':
        for (const p of seats) {
          collected += p.committedStreet;
          p.committedStreet = 0;
          p.hasActed = false;
        }
        street = e.street;
        board.push(...e.cards);
        currentBet = 0;
        lastRaiseSize = CHIPS_PER_BB;
        streetAggressor = null;
        break;
      case 'action': {
        const p = seats[e.seat];
        const decision = e.seat === hero ? bySeq.get(e.seq) : undefined;
        if (decision) {
          if (street === 'flop') heroFlopDecisions++;
          const owed = currentBet - p.committedStreet;
          const toCall = Math.max(0, Math.min(owed, p.stack));
          const maxTo = p.committedStreet + p.stack;
          const types = owed > 0 ? ['fold', 'call'] : ['check'];
          let minTo = 0;
          const othersCanAct = seats.some((o) => o.seat !== hero && !o.folded && !o.allIn);
          if (othersCanAct && p.stack > owed && !p.hasActed) {
            types.push(currentBet === 0 ? 'bet' : 'raise');
            minTo = Math.min(currentBet + lastRaiseSize, maxTo);
          }
          const snapshot = seats.map((s) => ({
            seat: s.seat, profile: s.profile, position: s.position, folded: s.folded, allIn: s.allIn,
            stack: s.stack, committedStreet: s.committedStreet,
          }));
          out.push({
            decision,
            heroSeat: hero,
            event: e,
            events: record.events.slice(0, i),
            street,
            board: board.slice(),
            seats: snapshot,
            opponents: snapshot.filter((s) => s.seat !== hero && !s.folded),
            legal: { types, toCall, minTo, maxTo },
            pot: collected + seats.reduce((sum, s) => sum + s.committedStreet, 0),
            heroCommitted: p.committedStreet,
            currentBet,
            blind,
            preflop: { raises, limpers, raiserSeat, raiseTo },
            preflopAggressor,
            lastAggressor,
            streetAggressor,
            firstFlopDecision: street === 'flop' && heroFlopDecisions === 1,
          });
        }

        commit(p, e.amount);
        p.hasActed = true;
        if (e.action === 'fold') p.folded = true;
        if (e.action === 'bet' || e.action === 'raise') {
          const increment = e.to - currentBet;
          if (currentBet === 0 || increment >= lastRaiseSize) {
            lastRaiseSize = Math.max(increment, lastRaiseSize);
            for (const o of seats) if (o !== p) o.hasActed = false;
          }
          currentBet = e.to;
          if (e.seat !== hero) {
            lastAggressor = e.seat;
            streetAggressor = e.seat;
          }
          if (street === 'preflop') {
            raises++;
            raiserSeat = e.seat;
            raiseTo = e.to;
            preflopAggressor = e.seat;
          }
        } else if (e.action === 'call' && street === 'preflop' && raises === 0) {
          limpers++;
        }
        break;
      }
      default:
        break;
    }
  });
  if (out.length !== record.decisions.length) {
    throw new RangeError('coach: record decisions do not match its action events');
  }
  return out;
}
