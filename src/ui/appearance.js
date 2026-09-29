export const THEMES = [
  { id: 'felt', label: 'Classic felt' },
  { id: 'midnight', label: 'Midnight blue' },
  { id: 'walnut', label: 'Warm walnut' },
];

export const TEXT_SIZES = [
  { id: 'compact', label: 'Compact' },
  { id: 'standard', label: 'Standard' },
  { id: 'large', label: 'Large' },
];

export const LOOKS = [
  { label: 'Classic', theme: 'felt', textSize: 'standard' },
  { label: 'Night focus', theme: 'midnight', textSize: 'large' },
  { label: 'Warm & compact', theme: 'walnut', textSize: 'compact' },
];

const STORAGE_KEY = 'felt-theory-appearance';

export function normalizeAppearance(value) {
  return {
    theme: THEMES.some(theme => theme.id === value?.theme) ? value.theme : 'felt',
    textSize: TEXT_SIZES.some(size => size.id === value?.textSize) ? value.textSize : 'standard',
  };
}

export function loadAppearance(storage) {
  try { return normalizeAppearance(JSON.parse((storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return normalizeAppearance(null); }
}

export function saveAppearance(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify(normalizeAppearance(value))); }
  catch { /* Appearance still works when local storage is unavailable. */ }
}

export function applyAppearance(value, root = document.documentElement) {
  const appearance = normalizeAppearance(value);
  root.dataset.theme = appearance.theme;
  root.dataset.textSize = appearance.textSize;
}
