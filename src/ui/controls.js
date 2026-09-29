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

export function presetTarget(state, legal, fraction) {
  const committed = state.players[state.heroSeat].committedStreet;
  const target = committed + legal.toCall + Math.round((potSize(state) + legal.toCall) * fraction);
  return Math.min(legal.maxTo, Math.max(legal.minTo, target));
}

export function potPercent(state, legal, target) {
  const committed = state.players[state.heroSeat].committedStreet;
  return Math.round(100 * (target - committed - legal.toCall) / (potSize(state) + legal.toCall));
}

export function parseBetBb(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
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
    const label = element('label', 'sizing-label', `${aggressiveType === 'bet' ? 'Bet' : 'Raise to'} (bb)`);
    const input = element('input', 'bet-amount');
    input.id = 'bet-amount';
    label.htmlFor = input.id;
    input.type = 'number';
    input.inputMode = 'decimal';
    input.step = '0.01';
    input.min = (legal.minTo / 100).toFixed(2);
    input.max = (legal.maxTo / 100).toFixed(2);
    input.value = (presetTarget(state, legal, 0.5) / 100).toFixed(2);
    const percentage = element('span', 'size-percent');
    percentage.setAttribute('aria-live', 'polite');
    const range = element('div', 'sizing-range');
    range.append(element('span', '', `Min ${chips(legal.minTo)}`), element('span', '', `Max ${chips(legal.maxTo)}`));
    const presets = element('div', 'preset-row');
    const fractions = [['⅓ pot', 1 / 3], ['½ pot', 0.5], ['⅔ pot', 2 / 3], ['¾ pot', 0.75], ['Pot', 1]];
    for (const [label, fraction] of fractions) {
      const preset = element('button', 'preset-button', label);
      preset.type = 'button';
      preset.addEventListener('click', () => {
        input.value = (presetTarget(state, legal, fraction) / 100).toFixed(2);
        update();
      });
      presets.append(preset);
    }
    const commitButton = button(aggressiveType === 'bet' ? 'Bet' : 'Raise', 'button button-primary', null,
      () => onAction({ type: aggressiveType, amount: parseBetBb(input.value) }));
    const update = () => {
      const target = parseBetBb(input.value);
      const valid = target !== null && target >= legal.minTo && target <= legal.maxTo;
      commitButton.disabled = !valid;
      input.setAttribute('aria-invalid', String(!valid));
      percentage.textContent = target === null ? 'Enter an amount in bb'
        : `${potPercent(state, legal, target)}% of ${aggressiveType === 'raise' ? 'pot after call' : 'pot'}`;
    };
    input.addEventListener('input', update);
    update();
    const commit = element('div', 'commit-row');
    commit.append(
      commitButton,
      button('All-in', 'button button-allin', null,
        () => onAction({ type: aggressiveType, amount: legal.maxTo })),
    );
    sizing.append(label, percentage, input, range, presets, commit);
    section.append(sizing);
  } else if (legal.types.includes('call') && legal.toCall >= state.players[state.heroSeat].stack) {
    section.append(button('Call all-in', 'button button-allin', { type: 'call' }, onAction));
  }
  return section;
}
