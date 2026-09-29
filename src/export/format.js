export const number = value => value == null ? '—' : value.toFixed(1);
export const bb = value => `${number(value)}bb`;
export const signed = value => value == null ? '—' : `${value >= 0 ? '+' : ''}${number(value)}`;
export const percent = value => value == null ? '—' : String(Math.round(value * 100));
export const date = timestamp => new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');

const rateKeys = new Set(['equity', 'requiredEquity', 'chartFreq', 'callFreq', 'threeBetFreq',
  'foldEstimate', 'oppVpip', 'vpip', 'pfr', 'gap', 'vpipBefore', 'vpipAfter', 'sizePct']);

/** Preserve all flag details even when the optional explanation module is absent. */
export function flagDetails(flag) {
  const data = flag.data;
  return Object.entries(data).map(([key, value]) => {
    const rate = rateKeys.has(key) || key === 'recommendedPct' ||
      ((key === 'value' || key === 'target') && data.stat !== 'af');
    const format = item => typeof item !== 'number' ? String(item)
      : rate ? `${percent(item)}%` : key.endsWith('Bb') ? bb(item) : String(item);
    return `${key}: ${Array.isArray(value) ? value.map(format).join('–') : format(value)}`;
  }).join('; ');
}
