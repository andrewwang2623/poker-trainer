import { STAKES, TIER_LABELS } from '../shared/schemas.js';
import { cards, chips, element } from './dom.js';
import { straddlePost } from './straddle.js';

const POT_LABEL = 'Pot';

const REVEAL_DURATION = 360;
const REVEAL_STAGGER = 160;

/** Track reveal times across whole-table redraws so betting updates don't replay the deal. */
export function createBoardReveal(now = () => performance.now()) {
  let handId;
  let starts = [];
  return state => {
    const time = now();
    if (state.handId !== handId) {
      handId = state.handId;
      starts = [];
    }
    starts.length = Math.min(starts.length, state.board.length);
    const firstNew = starts.length;
    for (let index = firstNew; index < state.board.length; index++) {
      starts.push(time + (index - firstNew) * REVEAL_STAGGER);
    }
    return starts.map(start => time - start < REVEAL_DURATION ? start - time : null);
  };
}

export function canRabbitHunt(state) {
  return state.street === 'complete' && state.board.length < 5 &&
    Array.isArray(state.deck) && state.deck.length >= 5 - state.board.length;
}

export function renderTable(state, revealDelays = [], revealHands = false, rabbitHunt = false) {
  const showRabbit = rabbitHunt && canRabbitHunt(state);
  const revealAll = revealHands && state.street === 'complete';
  const section = element('section', 'table-wrap');
  section.setAttribute('aria-label', 'Poker table');
  const table = element('div', 'felt-table');
  const inner = element('div', 'felt-inner');
  const center = element('div', 'table-center');
  const street = element('span', 'street-tag', state.street === 'complete' ? 'Hand complete' : state.street);
  const pot = state.potCollected + state.players.reduce((sum, player) => sum + player.committedStreet, 0);
  const potNode = element('div', 'pot-readout');
  potNode.append(element('span', 'pot-caption', POT_LABEL), element('strong', '', chips(pot)));
  const potSummary = element('div', 'pot-summary');
  potSummary.append(potNode);
  const stakes = STAKES[state.stakes];
  if (stakes) {
    const rake = element('div', 'rake-readout');
    rake.setAttribute('aria-label', 'Table rake');
    rake.append(element('span', 'rake-policy',
      `Rake ${Number((stakes.rakePct * 100).toFixed(2))}% · Cap ${stakes.rakeCapBb.toFixed(1)} bb`));
    if (state.street === 'complete' && Number.isFinite(state.result?.rakeChips)) {
      rake.append(element('span', 'rake-taken', `Rake taken: ${chips(state.result.rakeChips)}`));
    } else if (stakes.noFlopNoDrop) {
      rake.append(element('span', 'rake-rule', 'No flop, no drop'));
    }
    potSummary.append(rake);
  }
  const board = element('div', 'board-cards');
  board.setAttribute('aria-label', 'Community cards');
  // The engine deals from the front of the deck without burns. Read a copy only:
  // rabbit cards must never enter the real board, events, results, or exports.
  const displayBoard = showRabbit ? [...state.board, ...state.deck.slice(0, 5 - state.board.length)] : state.board;
  const communityCards = cards(displayBoard);
  Array.from(communityCards.children).forEach((card, index) => {
    if (index >= state.board.length) {
      card.classList.add('rabbit-card');
      card.setAttribute('title', 'Rabbit card — not dealt in this hand');
    }
    if (revealDelays[index] == null) return;
    card.classList.add('card-revealing');
    card.style.animationDelay = `${revealDelays[index]}ms`;
    card.style.animationDuration = `${REVEAL_DURATION}ms`;
  });
  board.append(communityCards);
  for (let i = displayBoard.length; i < 5; i++) board.append(element('span', 'card card-empty', ''));
  if (showRabbit) {
    const note = element('span', 'rabbit-note', 'Rabbit hunt · outlined cards were not dealt');
    note.id = 'rabbit-note';
    board.setAttribute('aria-describedby', note.id);
    potSummary.append(note);
  }
  center.append(street, board, potSummary);
  inner.append(center);
  table.append(inner);

  const shown = new Set(state.events.filter(event => event.type === 'showdown').map(event => event.seat));
  const straddle = straddlePost(state);
  const actions = state.events.filter(event => event.type === 'action');
  const lastAction = actions.at(-1);
  const actionStreet = ['complete', 'showdown'].includes(state.street) ? lastAction?.street : state.street;
  const latestActions = new Map(actions.filter(event => event.street === actionStreet)
    .map(event => [event.seat, event]));
  // A closing check advances the engine's street immediately. Keep it visible,
  // labeled with its street, until the next action so it is not skipped on screen.
  if (lastAction?.action === 'check' && lastAction.street !== actionStreet) {
    latestActions.set(lastAction.seat, lastAction);
  }
  for (const player of state.players) {
    const offset = (player.seat - state.heroSeat + state.numPlayers) % state.numPlayers;
    const angle = (90 + offset * 360 / state.numPlayers) * Math.PI / 180;
    const x = 50 + Math.cos(angle) * 42;
    const y = 50 + Math.sin(angle) * 40;
    const seat = element('div', `seat ${player.isHero ? 'seat-hero' : ''} ${player.folded ? 'seat-folded' : ''} ${state.actingSeat === player.seat ? 'seat-acting' : ''}`);
    if (revealAll) seat.classList.add('seat-revealed');
    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;
    seat.setAttribute('aria-label', `${player.name}, ${player.position}, ${chips(player.stack)} remaining`);
    const avatar = element('span', 'avatar', player.isHero ? 'YOU' : player.profile?.avatar.initials ?? player.name[0]);
    avatar.style.backgroundColor = player.isHero ? '#cfb171' : player.profile?.avatar.color ?? '#667e78';
    const nameLine = element('div', 'seat-name-line');
    nameLine.append(element('strong', 'seat-name', player.name), element('span', 'seat-position', player.position));
    const badge = element('span', 'tier-badge', player.isHero ? 'Hero' : TIER_LABELS[player.profile?.tier] ?? 'Opponent');
    const stack = element('span', 'seat-stack', chips(player.stack));
    const details = element('div', 'seat-details');
    details.append(nameLine, badge, stack);
    if (straddle?.seat === player.seat) details.append(element('span', 'straddle-badge', 'Straddle · 2 bb'));
    const top = element('div', 'seat-top');
    top.append(avatar, details);
    seat.append(top);
    const visibleCards = player.isHero || shown.has(player.seat) || revealAll;
    const hole = cards(visibleCards ? player.holeCards : ['??', '??'], !visibleCards);
    hole.classList.add('hole-cards');
    seat.append(hole);
    const latestAction = latestActions.get(player.seat);
    if (latestAction?.action === 'check' && !player.folded) {
      const label = latestAction.street === actionStreet ? 'Check' : `Check · ${latestAction.street}`;
      const check = element('span', 'bet-chips seat-check', label);
      check.setAttribute('aria-label', `${player.name} checks on the ${latestAction.street}`);
      seat.append(check);
    } else if (player.committedStreet > 0) {
      seat.append(element('span', 'bet-chips', chips(player.committedStreet)));
    }
    if (player.seat === state.buttonSeat) seat.append(element('span', 'dealer-button', 'D'));
    table.append(seat);
  }
  section.append(table);
  return section;
}
