import { chips, element } from './dom.js';

function button(label, className, action, callback) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => callback(action));
  return node;
}

function potSize(state) {
  return state.potCollected + state.players.reduce((sum, player) => sum + player.committedStreet, 0);
}

export function renderControls(state, legal, onAction, onNextHand) {
  const section = element('section', 'panel controls');
  section.setAttribute('aria-labelledby', 'action-title');
  const heading = element('div', 'panel-heading');
  heading.append(element('h2', '', state.street === 'complete' ? 'Hand finished' : 'Your action'));
  heading.querySelector('h2').id = 'action-title';
  section.append(heading);
  if (state.street === 'complete') {
    const net = state.result?.netChips[state.heroSeat] ?? 0;
    const resultText = net === 0 ? 'Hero breaks even' : `Hero ${net > 0 ? 'wins' : 'loses'} ${chips(Math.abs(net))} net`;
    const result = element('p', `hand-result ${net >= 0 ? 'result-win' : 'result-loss'}`, resultText);
    section.append(result, button('Next hand →', 'button button-primary next-hand', null, onNextHand));
    return section;
  }
  if (!legal) {
    section.append(element('p', 'waiting-copy', 'Waiting for the next action…'));
    return section;
  }
  const actions = element('div', 'basic-actions');
  if (legal.types.includes('fold')) actions.append(button('Fold', 'button button-quiet', { type: 'fold' }, onAction));
  if (legal.types.includes('check')) actions.append(button('Check', 'button button-secondary', { type: 'check' }, onAction));
  if (legal.types.includes('call')) actions.append(button(`Call ${chips(legal.toCall)}`, 'button button-secondary', { type: 'call' }, onAction));
  section.append(actions);

  const aggressiveType = legal.types.includes('bet') ? 'bet' : legal.types.includes('raise') ? 'raise' : null;
  if (aggressiveType) {
    const sizing = element('div', 'sizing-controls');
    sizing.append(element('label', 'sizing-label', `${aggressiveType === 'bet' ? 'Bet' : 'Raise to'} size`));
    const amount = element('strong', 'size-value');
    const slider = element('input', 'bet-slider');
    slider.type = 'range';
    slider.min = String(legal.minTo);
    slider.max = String(legal.maxTo);
    slider.step = '1';
    slider.value = String(Math.min(legal.maxTo, Math.max(legal.minTo, Math.round(potSize(state) * 0.5))));
    slider.setAttribute('aria-label', `${aggressiveType === 'bet' ? 'Bet' : 'Raise to'} amount in chips`);
    const update = () => { amount.textContent = chips(Number(slider.value)); };
    slider.addEventListener('input', update);
    update();
    const range = element('div', 'sizing-range');
    range.append(element('span', '', chips(legal.minTo)), element('span', '', chips(legal.maxTo)));
    const presets = element('div', 'preset-row');
    const fractions = [['⅓ pot', 1 / 3], ['½ pot', 0.5], ['¾ pot', 0.75], ['Pot', 1]];
    for (const [label, fraction] of fractions) {
      const preset = element('button', 'preset-button', label);
      preset.type = 'button';
      preset.addEventListener('click', () => {
        const hero = state.players[state.heroSeat];
        const target = hero.committedStreet + legal.toCall + Math.round((potSize(state) + legal.toCall) * fraction);
        slider.value = String(Math.min(legal.maxTo, Math.max(legal.minTo, target)));
        update();
      });
      presets.append(preset);
    }
    const commit = element('div', 'commit-row');
    commit.append(
      button(aggressiveType === 'bet' ? 'Bet' : 'Raise', 'button button-primary', null,
        () => onAction({ type: aggressiveType, amount: Number(slider.value) })),
      button('All-in', 'button button-allin', null,
        () => onAction({ type: aggressiveType, amount: legal.maxTo })),
    );
    sizing.append(amount, slider, range, presets, commit);
    section.append(sizing);
  } else if (legal.types.includes('call') && legal.toCall >= state.players[state.heroSeat].stack) {
    section.append(button('Call all-in', 'button button-allin', { type: 'call' }, onAction));
  }
  return section;
}
