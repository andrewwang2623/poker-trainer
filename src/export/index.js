import { CHIPS_PER_BB, STAKES, STREETS, TIER_LABELS } from '../shared/schemas.js';
import { bb, number, signed, percent, date, flagDetails } from './format.js';
export { formatSummary } from './summary.js';

const PROMPT = `You are an expert No-Limit Hold'em coach. Review the hand(s) below from a training app with bot opponents.
For each hero decision, say whether it was a mistake, why, and what you would do instead, considering
opponent profiles, stack depth, and board texture. The app's own coach notes are included; agree or
disagree with them. Then summarize the most important leak.`;
const chips = value => bb(value / CHIPS_PER_BB);
const cards = values => `[${values.join(' ')}]`;

function actionText(event, decision = false) {
  const verbs = decision ? { fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise to' }
    : { fold: 'folds', check: 'checks', call: 'calls', bet: 'bets', raise: 'raises to' };
  const amount = event.action === 'raise' ? event.to : event.amount;
  return `${verbs[event.action]}${['call', 'bet', 'raise'].includes(event.action) ? ` ${chips(amount)}` : ''}${event.allIn ? ' (all-in)' : ''}`;
}

function handBlock(record, index, count, { hideOpponentCards = false, explain } = {}) {
  const stakes = STAKES[record.stakes];
  const hero = record.players.find(player => player.seat === record.heroSeat);
  const player = seat => record.players.find(item => item.seat === seat);
  const actor = (seat, street) => seat === record.heroSeat
    ? `Hero${street === 'preflop' ? ` (${hero.position})` : ''}` : player(seat).position;
  const hole = (seat, values) => hideOpponentCards && seat !== record.heroSeat ? '[?? ??]' : cards(values);
  const lines = [
    `--- Hand ${index} of ${count} | id ${record.id} | ${stakes.label} $${stakes.sb.toFixed(2)}/$${stakes.bb.toFixed(2)} | ${record.numPlayers}-handed | ${date(record.timestamp)} ---`,
    `Rake: ${percent(stakes.rakePct)}% cap ${bb(stakes.rakeCapBb)} | Effective stacks: hero ${bb(hero.startStackBb)}`,
    'Players:',
  ];
  for (const p of record.players) {
    const profile = p.profile;
    const description = p.seat === record.heroSeat ? 'HERO' : profile
      ? `${TIER_LABELS[profile.tier]}  VPIP ${percent(profile.vpip)} PFR ${percent(profile.pfr)} 3B ${percent(profile.threeBet)} AF ${number(profile.aggression)} Bluff ${percent(profile.bluffFreq)}% Skill ${percent(profile.skill)}%`
      : 'Unknown';
    lines.push(`  Seat ${p.seat + 1} ${p.position}  ${p.name}  ${bb(p.startStackBb)}  ${description}  ${hole(p.seat, p.holeCards)}`);
  }
  let pot = 0;
  let board = [];
  for (const street of STREETS) {
    const events = record.events.filter(event => event.street === street);
    if (!events.length) continue;
    const newCards = events.filter(event => event.type === 'board').flatMap(event => event.cards);
    const boardText = newCards.length ? ` ${board.length ? `${cards(board)} ` : ''}${cards(newCards)}` : '';
    board = [...board, ...newCards];
    const openingPot = pot + events.filter(event => event.type === 'postBlind').reduce((sum, event) => sum + event.amount, 0);
    const actions = [];
    for (const event of events) {
      if (event.type === 'postBlind') {
        // Compatibility with the UI's live-straddle adapter (REQUESTS-astra.md).
        const straddle = record.numPlayers >= 3 && event.blind === 'BB' &&
          event.seat === (record.buttonSeat + 3) % record.numPlayers && event.amount === 2 * CHIPS_PER_BB;
        actions.push(`${actor(event.seat, street)} posts ${straddle ? 'straddle' : event.blind} ${chips(event.amount)}`);
        pot += event.amount;
      } else if (event.type === 'action') {
        actions.push(`${actor(event.seat, street)} ${actionText(event)}`);
        pot += event.amount;
      } else if (event.type === 'uncalled') {
        actions.push(`Uncalled ${chips(event.amount)} returned to ${player(event.seat).position}`);
        pot -= event.amount;
      }
    }
    lines.push(`${street.toUpperCase()}${boardText} (pot ${chips(openingPot)}): ${actions.join(', ') || 'No betting'}`);
    if (record.coach) {
      for (const decision of record.decisions.filter(item => item.street === street)) {
        const note = record.coach.decisions.find(item => item.decisionIndex === decision.index);
        if (!note) continue;
        const event = record.events.find(item => item.seq === decision.eventSeq);
        const chart = note.chart ? ` | chart: ${{ open: 'open', call: 'call', threeBet: '3-bet' }[note.chart.action]} ${percent(note.chart.freq)}%` : '';
        lines.push(`  Hero #${decision.index + 1}: ${actionText(event, true)} | equity ${note.equity == null ? '—' : `${percent(note.equity)}%`} | pot odds ${note.potOdds == null ? '—' : `${percent(note.potOdds)}%`} | EV loss ${bb(note.evLossBb)}${chart}`);
      }
    }
  }
  const shows = record.events.filter(event => event.type === 'showdown').map(event =>
    `${actor(event.seat)} shows ${hole(event.seat, event.cards)}${hideOpponentCards && event.seat !== record.heroSeat ? '' : ` (${event.handLabel})`}`);
  if (shows.length) lines.push(`SHOWDOWN: ${shows.join('; ')}`);
  const winnings = record.events.filter(event => event.type === 'award' && event.seat === record.heroSeat)
    .reduce((sum, event) => sum + event.amount, 0);
  lines.push(`RESULT: Hero wins ${chips(winnings)} (net ${signed(record.heroNetBb)}bb) | rake ${bb(record.rakeBb)}${record.result.heroAllInEv ? ` | all-in EV net ${signed(record.result.heroAllInEv.evNetChips / CHIPS_PER_BB)}bb` : ''}`);
  if (record.coach?.flags.length) {
    lines.push('COACH FLAGS:');
    for (const flag of record.coach.flags) {
      const location = [flag.street, flag.decisionIndex == null ? null : `#${flag.decisionIndex + 1}`].filter(Boolean).join(', ');
      const detail = flagDetails(flag);
      lines.push(`  - [${flag.severity}] ${flag.id}${location ? ` (${location})` : ''}:${detail ? ` ${detail}.` : ''}${flag.evLossBb == null ? '' : ` EV loss ${bb(flag.evLossBb)}`}`);
      const explanation = explain?.(flag);
      if (explanation?.body) lines.push(`    Explanation: ${explanation.body}`);
    }
  }
  return lines.join('\n');
}

/** Pure text export; timestamps are UTC and inputs are never mutated. */
export function formatHands(records, opts = {}) {
  const ordered = [...records].sort((a, b) => a.timestamp - b.timestamp);
  return ['=== POKER TRAINER EXPORT v1 ===', ...(opts.includePrompt === false ? [] : [PROMPT, '']),
    ...ordered.map((record, index) => handBlock(record, index + 1, ordered.length, opts)), '=== END ==='].join('\n');
}

export function formatHand(record, opts = {}) {
  return formatHands([record], opts);
}
