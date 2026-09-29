import { chips, element } from './dom.js';
import { straddlePost } from './straddle.js';

const ACTION_VERBS = { fold: 'folds', check: 'checks', call: 'calls', bet: 'bets', raise: 'raises to' };

function description(event, state) {
  const name = event.seat === undefined ? '' : state.players[event.seat]?.name ?? `Seat ${event.seat + 1}`;
  switch (event.type) {
    case 'postBlind': return `${name} posts ${event === straddlePost(state) ? 'straddle' : event.blind} · ${chips(event.amount)}`;
    case 'dealHole': return event.seat === state.heroSeat ? `Your cards are dealt` : null;
    case 'action': {
      const size = event.action === 'raise' ? event.to : event.amount;
      return `${name} ${ACTION_VERBS[event.action]}${['call', 'bet', 'raise'].includes(event.action) ? ` ${chips(size)}` : ''}${event.allIn ? ' · all-in' : ''}`;
    }
    case 'board': return `${event.street[0].toUpperCase() + event.street.slice(1)} · ${event.cards.join(' ')}`;
    case 'uncalled': return `${chips(event.amount)} returned to ${name}`;
    case 'showdown': return `${name} shows ${event.cards.join(' ')} · ${event.handLabel}`;
    case 'rake': return `Rake · ${chips(event.amount)}`;
    case 'award': return `${name} wins ${chips(event.amount)}`;
    default: return null;
  }
}

export function renderLog(state) {
  const section = element('section', 'panel hand-log');
  section.setAttribute('aria-labelledby', 'hand-log-title');
  const header = element('div', 'panel-heading');
  header.append(element('h2', '', 'Hand log'), element('span', 'hand-id', `#${state.handId}`));
  const list = element('ol', 'event-list');
  list.setAttribute('aria-live', 'polite');
  for (const entry of state.events) {
    const copy = description(entry, state);
    if (!copy) continue;
    const item = element('li', `event-item ${entry.seat === state.heroSeat ? 'event-hero' : ''}`);
    item.append(element('span', 'event-seq', String(entry.seq + 1).padStart(2, '0')), element('span', '', copy));
    list.append(item);
  }
  section.append(header, list);
  section.querySelector('h2').id = 'hand-log-title';
  return section;
}
