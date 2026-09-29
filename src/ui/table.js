import { TIER_LABELS } from '../shared/schemas.js';
import { cards, chips, element } from './dom.js';

const POT_LABEL = 'Pot';

export function renderTable(state) {
  const section = element('section', 'table-wrap');
  section.setAttribute('aria-label', 'Poker table');
  const table = element('div', 'felt-table');
  const inner = element('div', 'felt-inner');
  const center = element('div', 'table-center');
  const street = element('span', 'street-tag', state.street === 'complete' ? 'Hand complete' : state.street);
  const pot = state.potCollected + state.players.reduce((sum, player) => sum + player.committedStreet, 0);
  const potNode = element('div', 'pot-readout');
  potNode.append(element('span', 'pot-caption', POT_LABEL), element('strong', '', chips(pot)));
  const board = element('div', 'board-cards');
  board.setAttribute('aria-label', 'Community cards');
  board.append(cards(state.board));
  for (let i = state.board.length; i < 5; i++) board.append(element('span', 'card card-empty', ''));
  center.append(street, board, potNode);
  inner.append(center);
  table.append(inner);

  const shown = new Set(state.events.filter(event => event.type === 'showdown').map(event => event.seat));
  for (const player of state.players) {
    const offset = (player.seat - state.heroSeat + state.numPlayers) % state.numPlayers;
    const angle = (90 + offset * 360 / state.numPlayers) * Math.PI / 180;
    const x = 50 + Math.cos(angle) * 42;
    const y = 50 + Math.sin(angle) * 40;
    const seat = element('div', `seat ${player.isHero ? 'seat-hero' : ''} ${player.folded ? 'seat-folded' : ''} ${state.actingSeat === player.seat ? 'seat-acting' : ''}`);
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
    const top = element('div', 'seat-top');
    top.append(avatar, details);
    seat.append(top);
    const visibleCards = player.isHero || shown.has(player.seat);
    const hole = cards(visibleCards ? player.holeCards : ['??', '??'], !visibleCards);
    hole.classList.add('hole-cards');
    seat.append(hole);
    if (player.committedStreet > 0) seat.append(element('span', 'bet-chips', chips(player.committedStreet)));
    if (player.seat === state.buttonSeat) seat.append(element('span', 'dealer-button', 'D'));
    table.append(seat);
  }
  section.append(table);
  return section;
}
