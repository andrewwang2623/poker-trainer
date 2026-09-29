// HandRecord builder: replays the event log to extract hero decisions and stat flags.
import { SCHEMA_VERSION, CHIPS_PER_BB } from '../shared/schemas.js';

const toBb = (chips) => Math.round((chips / CHIPS_PER_BB) * 100) / 100;

/**
 * @param {import('../shared/schemas.js').GameState} state a completed hand
 * @param {{sessionId: string, timestamp?: number}} meta
 * @returns {import('../shared/schemas.js').HandRecord}
 */
export function buildHandRecord(state, { sessionId, timestamp } = {}) {
  if (state.street !== 'complete' || !state.result) {
    throw new RangeError('buildHandRecord: hand is not complete');
  }
  const heroSeat = state.heroSeat;
  const result = state.result;
  const { decisions, statFlags } = replay(state);

  const awards = state.events.filter((e) => e.type === 'award');
  const totalAwarded = awards.reduce((a, e) => a + e.amount, 0);
  const heroAwarded = awards.filter((e) => e.seat === heroSeat).reduce((a, e) => a + e.amount, 0);
  const heroNetBb = toBb(result.netChips[heroSeat]);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: state.handId,
    timestamp: timestamp ?? Date.now(),
    sessionId: sessionId ?? '',
    seed: state.seed,
    stakes: state.stakes,
    numPlayers: state.numPlayers,
    heroSeat,
    heroPosition: state.players[heroSeat].position,
    buttonSeat: state.buttonSeat,
    straddleSeat: state.straddleSeat ?? null,
    players: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      position: p.position,
      isHero: p.isHero,
      startStackBb: toBb(p.startStack),
      holeCards: p.holeCards.slice(),
      profile: p.profile,
    })),
    board: state.board.slice(),
    events: state.events.slice(),
    result,
    heroNetBb,
    heroEvNetBb: result.heroAllInEv ? toBb(result.heroAllInEv.evNetChips) : heroNetBb,
    rakeBb: toBb(result.rakeChips),
    heroRakeBb: totalAwarded > 0 ? toBb((result.rakeChips * heroAwarded) / totalAwarded) : 0,
    statFlags,
    decisions,
    coach: null,
  };
}

function replay(state) {
  const n = state.numPlayers;
  const hero = state.heroSeat;
  const players = state.players;
  const stacks = players.map((p) => p.startStack);
  let committed = new Array(n).fill(0);
  const folded = new Array(n).fill(false);
  const board = [];
  let street = 'preflop';
  let preflopRaises = 0;
  let limpers = 0;
  let streetAggressions = 0; // bets + raises on the current postflop street
  let firstFlopBettor = null;
  let preflopAggressor = null;
  let heroFlopDecisions = 0;

  const flags = {
    vpip: false, pfr: false, threeBetOpp: false, threeBet: false,
    cbetOpp: false, cbet: false, foldToCbetOpp: false, foldToCbet: false,
    sawFlop: false, wentToShowdown: false, wonAtShowdown: false,
    postflopBets: 0, postflopRaises: 0, postflopCalls: 0,
    // The straddle is a forced post: it never counts toward vpip/pfr or as a raise.
    straddled: false, facedStraddle: false,
  };
  const decisions = [];
  // Postflop order index: 0 = first to act (left of the button).
  const postflopIndex = (seat) => (seat - state.buttonSeat - 1 + n) % n;

  for (const e of state.events) {
    switch (e.type) {
      case 'postBlind':
        stacks[e.seat] -= e.amount;
        committed[e.seat] += e.amount;
        if (e.blind === 'straddle') {
          if (e.seat === hero) flags.straddled = true;
          else flags.facedStraddle = true;
        }
        break;
      case 'board':
        if (e.street === 'flop' && !folded[hero]) flags.sawFlop = true;
        street = e.street;
        board.push(...e.cards);
        committed = new Array(n).fill(0);
        streetAggressions = 0;
        break;
      case 'uncalled':
        stacks[e.seat] += e.amount;
        committed[e.seat] -= e.amount;
        break;
      case 'action': {
        if (e.seat === hero) {
          const opponentSeats = players.filter((p) => p.seat !== hero && !folded[p.seat]).map((p) => p.seat);
          const oppMax = Math.max(0, ...opponentSeats.map((s) => stacks[s] + committed[s]));
          let facing;
          if (street === 'preflop') {
            facing = preflopRaises === 0 ? (limpers > 0 ? 'limped' : 'unopened')
              : preflopRaises === 1 ? 'raised' : preflopRaises === 2 ? 'threeBet' : 'fourBetPlus';
          } else {
            facing = streetAggressions === 0 ? 'checkedTo' : streetAggressions === 1 ? 'facingBet' : 'facingRaise';
          }
          decisions.push({
            index: decisions.length,
            eventSeq: e.seq,
            street,
            position: players[hero].position,
            holeCards: players[hero].holeCards.slice(),
            board: board.slice(),
            potBeforeBb: toBb(e.potBefore),
            toCallBb: toBb(e.toCall),
            stackBeforeBb: toBb(e.stackBefore),
            effectiveStackBb: toBb(Math.min(stacks[hero] + committed[hero], oppMax)),
            numOpponents: opponentSeats.length,
            inPosition: opponentSeats.every((s) => postflopIndex(s) < postflopIndex(hero)),
            facing,
            opponentSeats,
            action: e.action === 'bet' || e.action === 'raise' ? { type: e.action, amount: e.to } : { type: e.action },
            allIn: e.allIn,
          });

          if (street === 'preflop') {
            if (e.action === 'call' || e.action === 'raise') flags.vpip = true;
            if (e.action === 'raise') flags.pfr = true;
            if (preflopRaises === 1) {
              flags.threeBetOpp = true;
              if (e.action === 'raise') flags.threeBet = true;
            }
          } else {
            if (e.action === 'bet') flags.postflopBets++;
            if (e.action === 'raise') flags.postflopRaises++;
            if (e.action === 'call') flags.postflopCalls++;
          }
          if (street === 'flop') {
            heroFlopDecisions++;
            if (heroFlopDecisions === 1 && preflopAggressor === hero && streetAggressions === 0) {
              flags.cbetOpp = true;
              flags.cbet = e.action === 'bet';
            }
            if (!flags.foldToCbetOpp && preflopAggressor !== null && preflopAggressor !== hero &&
                streetAggressions === 1 && firstFlopBettor === preflopAggressor) {
              flags.foldToCbetOpp = true;
              flags.foldToCbet = e.action === 'fold';
            }
          }
        }

        stacks[e.seat] -= e.amount;
        committed[e.seat] += e.amount;
        if (e.action === 'fold') folded[e.seat] = true;
        if (e.action === 'bet' || e.action === 'raise') {
          if (street === 'preflop') {
            preflopRaises++;
            preflopAggressor = e.seat;
          } else {
            if (street === 'flop' && streetAggressions === 0) firstFlopBettor = e.seat;
            streetAggressions++;
          }
        } else if (e.action === 'call' && street === 'preflop' && preflopRaises === 0) {
          limpers++;
        }
        break;
      }
      default:
        break;
    }
  }

  const result = state.result;
  flags.wentToShowdown = result.showdownSeats.includes(hero);
  flags.wonAtShowdown = flags.wentToShowdown &&
    result.pots.some((p) => p.eligibleSeats.length >= 2 && p.winnerSeats.includes(hero));
  return { decisions, statFlags: flags };
}
