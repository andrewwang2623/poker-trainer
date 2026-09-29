import { STAKES, TIER_LABELS, TIERS } from '../shared/schemas.js';
import { element } from './dom.js';
import { LOOKS, TEXT_SIZES, THEMES } from './appearance.js';
import { BOT_SPEEDS, OUT_BOT_SPEEDS, normalizeBotSpeed } from './bot-speed.js';
import { normalizeStraddle } from './straddle-settings.js';
import { renderBountySettings } from './bounty-settings.js';

function percentages(pool) {
  const whole = TIERS.map(tier => Math.round((pool[tier] ?? 0) * 100));
  whole[whole.length - 1] += 100 - whole.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(TIERS.map((tier, index) => [tier, whole[index]]));
}

function setMixValue(current, chosen, target) {
  const next = { ...current, [chosen]: target };
  const others = TIERS.filter(tier => tier !== chosen);
  const available = 100 - target;
  const previous = others.reduce((sum, tier) => sum + current[tier], 0);
  const shares = others.map(tier => ({
    tier, exact: previous ? current[tier] / previous * available : available / others.length,
  }));
  for (const share of shares) next[share.tier] = Math.floor(share.exact);
  let remainder = available - shares.reduce((sum, share) => sum + next[share.tier], 0);
  for (const share of [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (!remainder) break;
    next[share.tier]++;
    remainder--;
  }
  return next;
}

export function renderSettings(settings, onChange, appearance, onAppearanceChange, timerSettings = { enabled: false, seconds: 30 }, onTimerChange = () => {}) {
  const section = element('section', 'panel settings-panel');
  section.setAttribute('aria-labelledby', 'settings-title');
  const heading = element('div', 'panel-heading');
  heading.append(element('h2', '', 'Table settings'), element('span', 'panel-note', 'Stakes apply next hand'));
  heading.querySelector('h2').id = 'settings-title';
  section.append(heading);

  const stakeLabel = element('label', 'field-label', 'Stakes');
  stakeLabel.htmlFor = 'stake-select';
  const stakeSelect = element('select', 'select-input');
  stakeSelect.id = 'stake-select';
  stakeSelect.setAttribute('aria-label', 'Stakes');
  for (const stake of Object.values(STAKES)) {
    const option = element('option', '', `${stake.label} · $${stake.sb.toFixed(2)}/$${stake.bb.toFixed(2)}`);
    option.value = stake.id;
    stakeSelect.append(option);
  }
  stakeSelect.value = settings.stakes;
  stakeSelect.addEventListener('change', () => onChange({ ...settings, stakes: stakeSelect.value }));
  section.append(stakeLabel, stakeSelect);

  let straddle = normalizeStraddle(settings.straddle);
  const straddleRow = element('label', 'switch-row');
  const straddleToggle = element('input', 'switch-input');
  straddleToggle.id = 'straddle-enabled';
  straddleToggle.type = 'checkbox';
  straddleToggle.checked = straddle.enabled;
  straddleRow.append(straddleToggle, element('span', '', 'Straddles on · 2 bb'));
  const chanceLabel = element('label', 'field-label', 'Hero straddle chance when UTG (%)');
  chanceLabel.htmlFor = 'straddle-chance';
  const chance = element('input', 'select-input');
  chance.id = chanceLabel.htmlFor;
  chance.type = 'number';
  chance.min = '0'; chance.max = '100'; chance.step = '1';
  chance.value = String(straddle.heroChancePercent);
  chance.disabled = !straddle.enabled;
  straddleToggle.addEventListener('change', () => {
    straddle = { ...straddle, enabled: straddleToggle.checked };
    chance.disabled = !straddle.enabled;
    onChange({ ...settings, straddle });
  });
  chance.addEventListener('change', () => {
    const value = Number(chance.value);
    if (!chance.value.trim() || !Number.isInteger(value) || value < 0 || value > 100) {
      chance.value = String(straddle.heroChancePercent);
      return;
    }
    straddle = { ...straddle, heroChancePercent: value };
    onChange({ ...settings, straddle });
  });
  section.append(straddleRow, chanceLabel, chance,
    element('p', 'straddle-help', 'Applies next hand at 3+ player tables. Bots straddle too, at rates based on their tier. Your default chance is 33% when first after the big blind; 0% stops your straddles but keeps bot straddles on.'));

  section.append(renderBountySettings(settings.bounty, bounty => onChange({ ...settings, bounty })));

  const pacingRow = element('label', 'switch-row');
  const pacingToggle = element('input', 'switch-input');
  pacingToggle.id = 'bot-pacing';
  pacingToggle.type = 'checkbox';
  pacingToggle.checked = settings.botPacing !== false;
  pacingRow.append(pacingToggle, element('span', '', 'Pause AI actions while I’m in the hand'));
  const speedLabel = element('label', 'field-label', 'AI speed while I’m in the hand');
  speedLabel.htmlFor = 'bot-speed';
  const speedSelect = element('select', 'select-input');
  speedSelect.id = speedLabel.htmlFor;
  for (const speed of BOT_SPEEDS) {
    const option = element('option', '', speed.label);
    option.value = speed.id;
    speedSelect.append(option);
  }
  speedSelect.value = normalizeBotSpeed(settings.botSpeed);
  speedSelect.disabled = !pacingToggle.checked;
  pacingToggle.addEventListener('change', () => {
    speedSelect.disabled = !pacingToggle.checked;
    onChange({ ...settings, botPacing: pacingToggle.checked });
  });
  speedSelect.addEventListener('change', () => onChange({ ...settings, botSpeed: speedSelect.value }));
  section.append(pacingRow, speedLabel, speedSelect,
    element('p', 'panel-note', 'Off: instant AI actions while you’re in. All-in still counts as in the hand.'));

  const outSpeedLabel = element('label', 'field-label', 'AI speed after I fold');
  outSpeedLabel.htmlFor = 'bot-speed-out';
  const outSpeedSelect = element('select', 'select-input');
  outSpeedSelect.id = outSpeedLabel.htmlFor;
  for (const speed of OUT_BOT_SPEEDS) {
    const option = element('option', '', speed.label);
    option.value = speed.id;
    outSpeedSelect.append(option);
  }
  outSpeedSelect.value = normalizeBotSpeed(settings.outBotSpeed);
  outSpeedSelect.addEventListener('change', () => onChange({ ...settings, outBotSpeed: outSpeedSelect.value }));
  section.append(outSpeedLabel, outSpeedSelect,
    element('p', 'panel-note', 'Independent of your in-hand speed. Choose Instant to turn pauses off after folding. Speed changes apply after the current wait.'));

  const timerRow = element('label', 'switch-row');
  const timerToggle = element('input', 'switch-input');
  timerToggle.id = 'action-timer-enabled';
  timerToggle.type = 'checkbox';
  timerToggle.checked = timerSettings.enabled;
  timerRow.append(timerToggle, element('span', '', 'Player action timer'));
  const durationLabel = element('label', 'field-label', 'Seconds per decision');
  durationLabel.htmlFor = 'action-timer-seconds';
  const duration = element('input', 'select-input');
  duration.id = durationLabel.htmlFor;
  duration.type = 'number';
  duration.min = '5';
  duration.max = '300';
  duration.step = '1';
  duration.value = String(timerSettings.seconds);
  duration.disabled = !timerSettings.enabled;
  timerToggle.addEventListener('change', () => onTimerChange({ ...timerSettings, enabled: timerToggle.checked }));
  duration.addEventListener('change', () => {
    const seconds = Number(duration.value);
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) {
      duration.value = String(timerSettings.seconds);
      return;
    }
    onTimerChange({ ...timerSettings, seconds });
  });
  section.append(timerRow, durationLabel, duration,
    element('p', 'panel-note', '5–300 seconds. Checks when time runs out, or folds if facing a bet. Changes restart your current timer.'));

  const switchRow = element('label', 'switch-row');
  const checkbox = element('input', 'switch-input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(settings.poolOverride);
  switchRow.append(checkbox, element('span', '', 'Custom opponent mix'));
  section.append(switchRow);

  const mix = element('div', 'mix-sliders');
  mix.setAttribute('aria-label', 'Opponent mix');
  let values = percentages(settings.poolOverride ?? STAKES[settings.stakes].pool);
  const controls = new Map();
  for (const tier of TIERS) {
    const row = element('div', 'mix-row');
    const label = element('label', 'mix-label', TIER_LABELS[tier]);
    const percent = element('output', 'mix-percent', `${values[tier]}%`);
    const slider = element('input', 'mix-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(values[tier]);
    slider.disabled = !settings.poolOverride;
    slider.setAttribute('aria-label', `${TIER_LABELS[tier]} percentage`);
    slider.addEventListener('input', () => {
      values = setMixValue(values, tier, Number(slider.value));
      for (const [key, control] of controls) {
        control.slider.value = String(values[key]);
        control.percent.value = `${values[key]}%`;
      }
      onChange({ ...settings, poolOverride: Object.fromEntries(TIERS.map(key => [key, values[key] / 100])) });
    });
    label.append(slider);
    row.append(label, percent);
    mix.append(row);
    controls.set(tier, { slider, percent });
  }
  checkbox.addEventListener('change', () => {
    const override = checkbox.checked
      ? Object.fromEntries(TIERS.map(tier => [tier, values[tier] / 100])) : null;
    for (const { slider } of controls.values()) slider.disabled = !checkbox.checked;
    onChange({ ...settings, poolOverride: override });
  });
  section.append(mix);

  const appearanceSection = element('div', 'appearance-settings');
  appearanceSection.append(element('h3', '', 'Appearance'));
  const looksLabel = element('span', 'field-label', 'Suggested looks');
  const looks = element('div', 'look-row');
  for (const look of LOOKS) {
    const button = element('button', 'look-button', look.label);
    button.type = 'button';
    button.dataset.theme = look.theme;
    button.setAttribute('aria-pressed', String(look.theme === appearance.theme && look.textSize === appearance.textSize));
    button.addEventListener('click', () => onAppearanceChange({ theme: look.theme, textSize: look.textSize }));
    looks.append(button);
  }
  appearanceSection.append(looksLabel, looks);

  for (const [key, title, options] of [
    ['theme', 'Background color', THEMES], ['textSize', 'Text size', TEXT_SIZES],
  ]) {
    const label = element('label', 'field-label', title);
    const select = element('select', 'select-input');
    select.id = `appearance-${key}`;
    label.htmlFor = select.id;
    for (const option of options) {
      const node = element('option', '', option.label);
      node.value = option.id;
      select.append(node);
    }
    select.value = appearance[key];
    select.addEventListener('change', () => onAppearanceChange({ ...appearance, [key]: select.value }));
    appearanceSection.append(label, select);
  }
  section.append(appearanceSection);
  return section;
}
