import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportPanel } from '../../src/ui/export.js';
import * as exporter from '../../src/export/index.js';
import { handFixture } from '../export/fixtures.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(name, callback) { this.events[name] = callback; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function setup(t, writeText) {
  const previous = ['document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
  t.after(() => previous.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }));
  let records = [];
  const panel = createExportPanel({ exporter }, { getRecentHands: () => records });
  const [, label, actions, status, fallback] = panel.node.children;
  return { panel, toggle: label.children[0], buttons: actions.children, status, fallback, setRecords: value => { records = value; panel.refresh(); } };
}

test('copy controls disable without hands, choose latest one or ten, and respect redaction', async t => {
  const copied = [];
  const f = setup(t, async text => copied.push(text));
  assert.ok(f.buttons.every(button => button.disabled));
  const records = Array.from({ length: 12 }, (_, index) => ({ ...handFixture(), id: `hand-${index}`, timestamp: handFixture().timestamp + index }));
  f.setRecords(records);
  assert.ok(f.buttons.every(button => !button.disabled));
  await f.buttons[0].events.click();
  assert.match(copied[0], /Hand 1 of 1 \| id hand-11/);
  assert.match(copied[0], /\[Qs Qh\]/);
  f.toggle.checked = true;
  f.toggle.events.change();
  f.panel.refresh();
  await f.buttons[1].events.click();
  assert.equal(copied[1].match(/--- Hand /g).length, 10);
  assert.match(copied[1], /Hand 1 of 10 \| id hand-2/);
  assert.match(copied[1], /Hand 10 of 10 \| id hand-11/);
  assert.doesNotMatch(copied[1], /Qs|Qh|Pair of Queens/);
  assert.match(copied[1], /\[Ah Kd\]/);
  assert.equal(f.status.textContent, 'Copied 10 hands.');
});

test('clipboard rejection offers selectable text and toggle clears revealed fallback', async t => {
  const f = setup(t, async () => { throw new Error('blocked'); });
  f.setRecords([handFixture()]);
  await f.buttons[0].events.click();
  assert.equal(f.fallback.hidden, false);
  assert.equal(f.fallback.selected, true);
  assert.match(f.fallback.value, /POKER TRAINER EXPORT/);
  assert.match(f.status.textContent, /Clipboard unavailable/);
  f.toggle.checked = true;
  f.toggle.events.change();
  assert.equal(f.fallback.hidden, true);
  assert.equal(f.fallback.value, '');
});

test('copy in progress disables controls and prevents duplicate requests', async t => {
  let finish;
  let calls = 0;
  const f = setup(t, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.setRecords([handFixture()]);
  const pending = f.buttons[0].events.click();
  assert.ok(f.buttons.every(button => button.disabled));
  assert.equal(f.toggle.disabled, true);
  await f.buttons[1].events.click();
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(f.toggle.disabled, false);
  assert.ok(f.buttons.every(button => !button.disabled));
});

test('revealed rabbit cards are copied for their hand, retained for last ten, and pruned with old records', async t => {
  const copied = [];
  const f = setup(t, async text => copied.push(text));
  const first = { ...handFixture(), id: 'first', board: [] };
  const second = { ...handFixture(), id: 'second', timestamp: first.timestamp + 1 };
  f.setRecords([first]);
  await f.buttons[0].events.click();
  assert.doesNotMatch(copied.at(-1), /RABBIT HUNT/);
  const rabbit = ['2h', '3s', '4d', '5c', '6h'];
  f.panel.setRabbitCards(first.id, rabbit);
  rabbit[0] = 'Ah';
  await f.buttons[0].events.click();
  assert.match(copied.at(-1), /RABBIT HUNT.*Flop \[2h 3s 4d\]/);
  f.setRecords([second, first]);
  await f.buttons[0].events.click();
  assert.doesNotMatch(copied.at(-1), /RABBIT HUNT/);
  await f.buttons[1].events.click();
  assert.equal(copied.at(-1).match(/RABBIT HUNT/g).length, 1);
  f.setRecords([second]);
  f.setRecords([first]);
  await f.buttons[0].events.click();
  assert.doesNotMatch(copied.at(-1), /RABBIT HUNT/);
});
