import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionTimer, loadTimer, normalizeTimer, saveTimer } from '../../src/ui/action-timer.js';
import { mountApp } from '../../src/ui/index.js';

function clock() {
  let time = 0;
  let id = 0;
  const pending = new Map();
  return {
    now: () => time,
    schedule(callback, ms) { pending.set(++id, { callback, at: time + ms }); return id; },
    cancel(handle) { pending.delete(handle); },
    advance(ms) {
      time += ms;
      for (const [handle, task] of [...pending]) {
        if (task.at <= time) { pending.delete(handle); task.callback(); }
      }
    },
    pending,
  };
}

test('timer keeps deadlines across renders, catches delayed ticks, and expires only once', () => {
  const time = clock();
  const ticks = [];
  let expired = 0;
  const timer = createActionTimer(value => ticks.push(value), () => expired++, time);
  timer.sync('hand:turn:1', 5);
  assert.equal(ticks.at(-1), 5);
  time.advance(2100);
  timer.sync('hand:turn:1', 5);
  assert.equal(ticks.at(-1), 3);
  time.advance(10000);
  assert.equal(expired, 1);
  timer.sync('hand:turn:1', 5);
  time.advance(10000);
  assert.equal(expired, 1);
  assert.equal(time.pending.size, 0);
});

test('new decisions and changed durations reset; disabling and cleanup cancel stale callbacks', () => {
  const time = clock();
  let remaining;
  let expired = 0;
  const timer = createActionTimer(value => { remaining = value; }, () => expired++, time);
  timer.sync('one', 5);
  const stale = [...time.pending.values()][0].callback;
  time.advance(4000);
  timer.sync('two', 5);
  assert.equal(remaining, 5);
  stale();
  time.advance(4000);
  assert.equal(expired, 0);
  timer.sync('two', 10);
  assert.equal(remaining, 10);
  time.advance(6000);
  assert.equal(expired, 0);
  timer.sync(null, 10);
  assert.equal(remaining, null);
  time.advance(10000);
  assert.equal(expired, 0);
  timer.sync('three', 5);
  timer.stop();
  time.advance(10000);
  assert.equal(expired, 0);
  assert.equal(time.pending.size, 0);
});

// Minimal DOM for behavior tests; no layout or appearance assertions.
class Node {
  constructor(tag) {
    this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
    this.className = ''; this.events = {}; this.attributes = {};
    this.classList = {
      add: name => { this.className += ` ${name}`; },
      toggle: (name, on) => {
        this.className = this.className.split(' ').filter(value => value !== name).join(' ');
        if (on) this.classList.add(name);
      },
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { this.events[event] = callback; }
  querySelectorAll(selector) {
    const matches = node => selector.split(',').some(part => {
      const value = part.trim();
      return value.startsWith('.') ? node.className.split(' ').includes(value.slice(1))
        : value.startsWith('#') ? node.id === value.slice(1) : node.tag === value;
    });
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function fixture(t, { enabled = true, types = ['check', 'bet'] } = {}) {
  const time = clock();
  t.mock.method(globalThis, 'setTimeout', time.schedule);
  t.mock.method(globalThis, 'clearTimeout', time.cancel);
  t.mock.method(performance, 'now', time.now);
  const saved = new Map([['felt-theory-action-timer', JSON.stringify({ enabled, seconds: 5 })]]);
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => new Node(tag), documentElement: new Node('html'),
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value),
  } });
  t.after(() => {
    for (const [key, descriptor] of [['document', priorDocument], ['localStorage', priorStorage]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const state = {
    handId: 'test-hand', stakes: 'micro', numPlayers: 2, heroSeat: 0, actingSeat: 0,
    street: 'flop', board: [], events: [], potCollected: 200,
    players: [0, 1].map(seat => ({ seat, isHero: seat === 0, name: `Player ${seat}`,
      position: 'BB', stack: 1000, committedStreet: 0, holeCards: ['As', 'Kd'] })),
  };
  const actions = [];
  let listener;
  const root = new Node('div');
  const session = {
    getState: () => state,
    getLegalActions: () => state.actingSeat === 0 && !state.result
      ? { types, minTo: 100, maxTo: 1000, toCall: types.includes('call') ? 100 : 0 } : null,
    subscribe(callback) { listener = callback; return () => { listener = null; }; },
    async act(action) { actions.push(action); state.actingSeat = 1; listener?.(); },
  };
  const app = mountApp(root, { session });
  t.after(() => app.destroy());
  const toggle = () => root.querySelectorAll('input').find(node => node.type === 'checkbox');
  return { time, root, state, actions, app, saved, toggle };
}

test('mounted timer checks for free, preserves entered bet amounts, and survives rerenders', async t => {
  const f = fixture(t);
  const amount = f.root.querySelector('#bet-amount');
  amount.value = '7.25';
  f.time.advance(2000);
  assert.equal(f.root.querySelector('#bet-amount'), amount);
  assert.equal(amount.value, '7.25');
  f.app.render();
  assert.equal(f.root.querySelector('.action-timer').textContent, '3s left');
  f.time.advance(3000);
  await Promise.resolve();
  assert.deepEqual(f.actions, [{ type: 'check' }]);
  f.time.advance(10000);
  assert.equal(f.actions.length, 1);
});

test('mounted timer folds when facing a bet and starts afresh for the next player turn', async t => {
  const f = fixture(t, { types: ['fold', 'call', 'raise'] });
  f.time.advance(5000);
  await Promise.resolve();
  assert.deepEqual(f.actions, [{ type: 'fold' }]);
  f.time.advance(50000);
  assert.equal(f.actions.length, 1);
  f.state.actingSeat = 0;
  f.state.events.push({ type: 'action', seat: 1, action: 'check', seq: 0 });
  f.app.render();
  assert.equal(f.root.querySelector('.action-timer').textContent, '5s left');
  f.time.advance(5000);
  await Promise.resolve();
  assert.equal(f.actions.length, 2);
});

test('timer is optional; settings validate, persist, reset the deadline and disable immediately', t => {
  const f = fixture(t, { enabled: false });
  f.time.advance(100000);
  assert.equal(f.actions.length, 0);
  assert.equal(f.root.querySelector('#action-timer-seconds').disabled, true);
  f.toggle().checked = true;
  f.toggle().events.change();
  const input = f.root.querySelector('#action-timer-seconds');
  for (const value of ['', '0', '4', '301', '7.5', 'bad']) {
    input.value = value;
    input.events.change();
    assert.equal(input.value, '5');
  }
  input.value = '12';
  input.events.change();
  assert.deepEqual(loadTimer(), { enabled: true, seconds: 12 });
  f.time.advance(5000);
  assert.equal(f.actions.length, 0);
  f.toggle().checked = false;
  f.toggle().events.change();
  f.time.advance(100000);
  assert.equal(f.actions.length, 0);
  assert.deepEqual(loadTimer(), { enabled: false, seconds: 12 });
});

test('manual actions cancel the timer and cannot race into a second action', async t => {
  const f = fixture(t);
  f.time.advance(4900);
  const check = f.root.querySelectorAll('button').find(node => node.textContent === 'Check');
  check.events.click();
  f.time.advance(1000);
  await Promise.resolve();
  assert.deepEqual(f.actions, [{ type: 'check' }]);
  assert.equal(f.time.pending.size, 0);
  f.state.actingSeat = 0;
  f.state.handId = 'next-hand';
  f.app.render();
  assert.equal(f.root.querySelector('.action-timer').textContent, '5s left');
});

test('no timer during bot turns, finished hands, or after unmount', t => {
  const f = fixture(t);
  f.state.actingSeat = 1;
  f.app.render();
  f.time.advance(50000);
  assert.equal(f.actions.length, 0);
  f.state.actingSeat = 0;
  f.state.street = 'complete';
  f.state.result = { netChips: [0, 0] };
  f.app.render();
  f.time.advance(50000);
  assert.equal(f.actions.length, 0);
  f.state.street = 'flop';
  f.state.result = null;
  f.app.render();
  f.app.destroy();
  f.time.advance(50000);
  assert.equal(f.actions.length, 0);
  assert.equal(f.time.pending.size, 0);
});

test('invalid saved settings and blocked storage use safe defaults', t => {
  assert.deepEqual(normalizeTimer(null), { enabled: false, seconds: 30 });
  assert.deepEqual(normalizeTimer({ enabled: 'true', seconds: -1 }), { enabled: false, seconds: 30 });
  assert.deepEqual(loadTimer({ getItem: () => '{' }), { enabled: false, seconds: 30 });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked'); } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  assert.deepEqual(loadTimer(), { enabled: false, seconds: 30 });
  assert.doesNotThrow(() => saveTimer({ enabled: true, seconds: 10 }));
});
