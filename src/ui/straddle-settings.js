const STORAGE_KEY = 'felt-theory-straddle';

export function normalizeStraddle(value) {
  return {
    enabled: value?.enabled === true,
    heroChancePercent: Number.isInteger(value?.heroChancePercent) && value.heroChancePercent >= 0 && value.heroChancePercent <= 100
      ? value.heroChancePercent : 33,
  };
}

export function loadStraddle(storage) {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? 'null');
    // Preserve the previously saved hero-only percentage when upgrading settings.
    return normalizeStraddle({ ...saved, heroChancePercent: saved?.heroChancePercent ?? saved?.chancePercent });
  } catch { return normalizeStraddle(null); }
}

export function saveStraddle(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(normalizeStraddle(value))); }
  catch { /* Settings remain usable without browser storage. */ }
}
