const STORAGE_KEY = 'felt-theory-bot-speed';
const PACING_KEY = 'felt-theory-bot-pacing';
const OUT_SPEED_KEY = 'felt-theory-bot-speed-out';

export const BOT_SPEEDS = Object.freeze([
  { id: 'instant', label: 'Instant', multiplier: 0 },
  { id: 'fast', label: 'Fast · 0.2–0.5 seconds', multiplier: 0.5 },
  { id: 'normal', label: 'Normal · 0.4–0.9 seconds', multiplier: 1 },
  { id: 'slow', label: 'Slow · 1–2.3 seconds', multiplier: 2.5 },
  { id: 'study', label: 'Study · 2–4.5 seconds', multiplier: 5 },
].map(Object.freeze));

export const OUT_BOT_SPEEDS = Object.freeze(BOT_SPEEDS.map(speed => speed.id === 'normal'
  ? Object.freeze({ ...speed, label: 'Normal · 1 second' }) : speed));

export function normalizeBotSpeed(value) {
  return BOT_SPEEDS.some(speed => speed.id === value) ? value : 'normal';
}

export function botActionDelay(speed, random, { folded = false, enabled = true, outSpeed = 'normal' } = {}) {
  if (folded) return normalizeBotSpeed(outSpeed) === 'normal' ? 1000 : botActionDelay(outSpeed, random);
  if (!enabled) return 0;
  const multiplier = BOT_SPEEDS.find(option => option.id === normalizeBotSpeed(speed)).multiplier;
  return Math.round((400 + Math.floor(random * 501)) * multiplier);
}

export function loadOutBotSpeed(storage) {
  try { return normalizeBotSpeed((storage ?? globalThis.localStorage)?.getItem(OUT_SPEED_KEY)); }
  catch { return 'normal'; }
}

export function saveOutBotSpeed(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(OUT_SPEED_KEY, normalizeBotSpeed(value)); }
  catch { /* Speed changes still work when browser storage is blocked. */ }
}

export function loadBotPacing(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem(PACING_KEY) !== 'false'; }
  catch { return true; }
}

export function saveBotPacing(enabled, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(PACING_KEY, String(enabled !== false)); }
  catch { /* Pacing remains usable without storage. */ }
}

export function loadBotSpeed(storage) {
  try { return normalizeBotSpeed((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY)); }
  catch { return 'normal'; }
}

export function saveBotSpeed(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, normalizeBotSpeed(value)); }
  catch { /* Speed changes still work when browser storage is blocked. */ }
}
