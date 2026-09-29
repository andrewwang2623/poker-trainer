import { STAKES, TIER_LABELS, TIERS } from '../shared/schemas.js';
import { element } from './dom.js';

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

export function renderSettings(settings, onChange) {
  const section = element('section', 'panel settings-panel');
  section.setAttribute('aria-labelledby', 'settings-title');
  const heading = element('div', 'panel-heading');
  heading.append(element('h2', '', 'Table settings'), element('span', 'panel-note', 'Applies next hand'));
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
  return section;
}
