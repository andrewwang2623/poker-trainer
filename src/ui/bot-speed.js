const STORAGE_KEY = 'felt-theory-bot-speed';

export const BOT_SPEEDS = Object.freeze([
  { id: 'instant', label: 'Instant', multiplier: 0 },
  { id: 'fast', label: 'Fast · 0.2–0.5 seconds', multiplier: 0.5 },
  { id: 'normal', label: 'Normal · 0.4–0.9 seconds', multiplier: 1 },
  { id: 'slow', label: 'Slow · 1–2.3 seconds', multiplier: 2.5 },
  { id: 'study', label: 'Study · 2–4.5 seconds', multiplier: 5 },
].map(Object.freeze));

export function normalizeBotSpeed(value) {
  return BOT_SPEEDS.some(speed => speed.id === value) ? value : 'normal';
}

export function botActionDelay(speed, random) {
  const multiplier = BOT_SPEEDS.find(option => option.id === normalizeBotSpeed(speed)).multiplier;
  return Math.round((400 + Math.floor(random * 501)) * multiplier);
}

export function loadBotSpeed(storage) {
  try { return normalizeBotSpeed((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)); }
  catch { return 'normal'; }
}

export function saveBotSpeed(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, normalizeBotSpeed(value)); }
  catch { /* Speed changes still work when browser storage is blocked. */ }
}
