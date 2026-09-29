import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import { renderSettings } from '../../src/ui/settings.js';
import { renderTable } from '../../src/ui/table.js';
import { renderLog } from '../../src/ui/log.js';
import { formatHand } from '../../src/export/index.js';
import { loadStraddle, normalizeStraddle, saveStraddle } from '../../src/ui/straddle-settings.js';

class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.className = ''; this.style = {}; this.dataset = {};
    this.attributes = {}; this.events = {};
    this.classList = { add: name => { this.className += ` ${name}`; } };
  }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { this.events[event] = callback; }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1))
      : selector.startsWith('#') ? node.id === selector.slice(1) : node.tag === selector;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function setup(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
}

test('straddle settings persist a separate hero percentage and preserve saved preferences', () => {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  assert.deepEqual(loadStraddle(storage), { enabled: false, heroChancePercent: 33 });
  saved.set('felt-theory-straddle', JSON.stringify({ enabled: true, chancePercent: 75 }));
  assert.deepEqual(loadStraddle(storage), { enabled: true, heroChancePercent: 75 });
  for (const heroChancePercent of [0, 33, 100]) {
    saveStraddle({ enabled: true, heroChancePercent }, storage);
    assert.deepEqual(loadStraddle(storage), { enabled: true, heroChancePercent });
  }
  assert.deepEqual(loadStraddle({ getItem: () => '{' }), normalizeStraddle(null));
  assert.deepEqual(normalizeStraddle({ enabled: 'yes', heroChancePercent: 101 }), normalizeStraddle(null));
  assert.doesNotThrow(() => saveStraddle({}, { setItem() { throw Error('blocked'); } }));
});

test('settings offer straddles on/off and a validated hero chance, explicitly including bots', t => {
  setup(t);
  const settings = { stakes: 'micro', poolOverride: null, straddle: normalizeStraddle(null) };
  const changes = [];
  const panel = renderSettings(settings, next => { changes.push(next); Object.assign(settings, next); },
    { theme: 'felt', textSize: 'standard' }, () => {});
  const toggle = panel.querySelector('#straddle-enabled');
  const chance = panel.querySelector('#straddle-chance');
  assert.equal(toggle.checked, false);
  assert.equal(chance.value, '33');
  assert.equal(chance.disabled, true);
  assert.match(panel.querySelector('.straddle-help').textContent, /Bots straddle too/);
  toggle.checked = true;
  toggle.events.change();
  assert.equal(chance.disabled, false);
  for (const invalid of ['', '-1', '101', '33.3', 'bad']) {
    chance.value = invalid;
    chance.events.change();
    assert.equal(chance.value, '33');
  }
  for (const value of [0, 75, 100]) {
    chance.value = String(value);
    chance.events.change();
    assert.deepEqual(changes.at(-1).straddle, { enabled: true, heroChancePercent: value });
  }
  toggle.checked = false;
  toggle.events.change();
  assert.equal(chance.disabled, true);
  assert.deepEqual(changes.at(-1).straddle, { enabled: false, heroChancePercent: 100 });
});

for (const role of ['hero', 'bot']) test(`native ${role} straddle is rendered and exported without relabeling BB posts`, t => {
  setup(t);
  let state;
  for (let seed = 1; seed < 2000; seed++) {
    const scenario = engine.createScenario({ stakes: 'micro', seed, createdAt: 123456789,
      poolOverride: { fish: 1 }, straddle: { enabled: true, heroChance: role === 'hero' ? 1 : 0 } });
    if (scenario.straddleSeat !== null && (scenario.straddleSeat === scenario.heroSeat) === (role === 'hero')) {
      state = engine.createHand(scenario);
      break;
    }
  }
  assert.ok(state, 'find a native straddle scenario');
  const table = renderTable(state);
  const seat = table.querySelectorAll('.seat')[state.straddleSeat];
  assert.equal(seat.querySelector('.straddle-badge').textContent, 'Straddle · 2.0 bb');
  assert.equal(table.querySelectorAll('.straddle-badge').length, 1);
  const lines = renderLog(state).querySelectorAll('.event-item').map(node => node.children[1].textContent);
  assert.ok(lines.includes(`${state.players[state.straddleSeat].name} posts straddle · 2.0 bb`));
  assert.equal(lines.filter(line => line.includes('posts BB')).length, 1);
  while (!engine.isComplete(state)) {
    const legal = engine.getLegalActions(state);
    state = engine.applyAction(state, { type: legal.types.includes('check') ? 'check' : 'call' });
  }
  const record = engine.buildHandRecord(state, { sessionId: 'native', timestamp: 123456789 });
  assert.match(formatHand(record), /posts straddle 2.0bb/);
  const bbPost = { ...record, events: record.events.map(event => event.blind === 'straddle'
    ? { ...event, blind: 'BB' } : event) };
  assert.doesNotMatch(formatHand(bbPost), /posts straddle/, 'never infer straddles from BB seat/amount');
});
