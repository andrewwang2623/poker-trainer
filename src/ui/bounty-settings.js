import { BOUNTY_DEFAULTS } from '../shared/schemas.js';
import { element } from './dom.js';

const STORAGE_KEY = 'felt-theory-bounty';
const validChance = value => Number.isFinite(value) && value >= 0 && value <= 1;
const validAmount = value => Number.isFinite(value) && value >= 0.01 && Number.isSafeInteger(Math.round(value * 100));

export function normalizeBounty(value) {
  const result = { paysOn: ['showdownOrFold', 'showdownOnly'].includes(value?.paysOn)
    ? value.paysOn : BOUNTY_DEFAULTS.paysOn };
  for (const type of ['hand', 'card']) {
    const saved = value?.[type];
    const defaults = BOUNTY_DEFAULTS[type];
    result[type] = {
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : defaults.enabled,
      chance: validChance(saved?.chance) ? saved.chance : defaults.chance,
      amountBb: validAmount(saved?.amountBb) ? saved.amountBb : defaults.amountBb,
    };
  }
  return result;
}

export function loadBounty(storage) {
  try { return normalizeBounty(JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return normalizeBounty(null); }
}

export function saveBounty(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(normalizeBounty(value))); }
  catch { /* Settings remain usable without browser storage. */ }
}

export function renderBountySettings(value, onChange) {
  let bounty = normalizeBounty(value);
  const section = element('div', 'bounty-settings');
  section.append(element('h3', '', 'Bounties'), element('p', 'panel-note', 'Applies next hand. Each other player pays up to the bounty amount from their remaining stack.'));
  for (const type of ['hand', 'card']) {
    const title = type === 'hand' ? 'Hand' : 'Card';
    const row = element('label', 'switch-row');
    const toggle = element('input', 'switch-input');
    toggle.id = `bounty-${type}-enabled`;
    toggle.type = 'checkbox';
    toggle.checked = bounty[type].enabled;
    row.append(toggle, element('span', '', `${title} bounties`));
    section.append(row);
    const inputs = [];
    for (const [key, label, factor, valid] of [
      ['chance', `${title} bounty frequency (%)`, 100, validChance],
      ['amountBb', `${title} bounty amount (bb)`, 1, validAmount],
    ]) {
      const field = element('label', 'field-label', label);
      const input = element('input', 'select-input');
      input.id = `bounty-${type}-${key}`;
      field.htmlFor = input.id;
      input.type = 'number';
      input.min = key === 'chance' ? '0' : '0.01';
      if (key === 'chance') input.max = '100';
      input.step = '0.01';
      input.value = String(Number((bounty[type][key] * factor).toFixed(8)));
      input.disabled = !bounty[type].enabled;
      input.addEventListener('change', () => {
        const next = Number(input.value) / factor;
        if (!input.value.trim() || !valid(next)) {
          input.value = String(Number((bounty[type][key] * factor).toFixed(8)));
          return;
        }
        bounty = { ...bounty, [type]: { ...bounty[type], [key]: next } };
        onChange(bounty);
      });
      inputs.push(input);
      section.append(field, input);
    }
    toggle.addEventListener('change', () => {
      bounty = { ...bounty, [type]: { ...bounty[type], enabled: toggle.checked } };
      for (const input of inputs) input.disabled = !toggle.checked;
      onChange(bounty);
    });
  }
  const label = element('label', 'field-label', 'Bounties pay on');
  const select = element('select', 'select-input');
  select.id = 'bounty-pays-on';
  label.htmlFor = select.id;
  for (const [value, text] of [['showdownOrFold', 'Showdown or fold'], ['showdownOnly', 'Showdown only']]) {
    const option = element('option', '', text);
    option.value = value;
    select.append(option);
  }
  select.value = bounty.paysOn;
  select.addEventListener('change', () => {
    bounty = { ...bounty, paysOn: select.value };
    onChange(bounty);
  });
  section.append(label, select);
  return section;
}
