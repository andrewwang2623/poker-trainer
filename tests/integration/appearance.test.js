import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppearance, loadAppearance, normalizeAppearance, saveAppearance } from '../../src/ui/appearance.js';

test('appearance choices persist and apply to the document root', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const choice = { theme: 'midnight', textSize: 'large' };
  saveAppearance(choice, storage);
  assert.deepEqual(loadAppearance(storage), choice);
  const root = { dataset: {} };
  applyAppearance(loadAppearance(storage), root);
  assert.deepEqual(root.dataset, { theme: 'midnight', textSize: 'large' });
});

test('invalid or unavailable saved appearance falls back safely', () => {
  assert.deepEqual(normalizeAppearance({ theme: 'unknown', textSize: 'large' }), {
    theme: 'felt', textSize: 'large',
  });
  assert.deepEqual(loadAppearance({ getItem: () => '{bad json' }), {
    theme: 'felt', textSize: 'standard',
  });
  assert.deepEqual(loadAppearance({ getItem: () => { throw new Error('blocked'); } }), {
    theme: 'felt', textSize: 'standard',
  });
});
