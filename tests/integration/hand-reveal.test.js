import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../../src/ui/index.js';
import { renderTable } from '../../src/ui/table.js';
import { createMockSession } from '../../src/ui/mock.js';
import { loadBotPacing, loadBotSpeed } from '../../src/ui/bot-speed.js';

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
  focus() { this.focused = true; }
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

function setup(t) {
  const previous = ['document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => new Node(tag), documentElement: new Node('html'),
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => previous.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }));
  return createMockSession();
}

test('post-hand button reveals folded hands, toggles, and resets for the next hand', async t => {
  const session = setup(t);
  const root = new Node('div');
  const app = mountApp(root, { session });
  t.after(() => app.destroy());
  assert.equal(root.querySelector('.reveal-hands'), null);
  assert.equal(root.querySelectorAll('.card-back').length, 10);
  session.act({ type: 'fold' });
  app.render();
  const before = structuredClone(session.getState());
  assert.equal(root.querySelector('.reveal-hands').attributes['aria-pressed'], 'false');
  root.querySelector('.reveal-hands').events.click();
  assert.equal(root.querySelectorAll('.card-back').length, 0);
  assert.equal(root.querySelector('.reveal-hands').attributes['aria-pressed'], 'true');
  assert.equal(root.querySelector('.reveal-hands').focused, true);
  const holes = root.querySelectorAll('.hole-cards');
  assert.equal(holes.flatMap(hole => hole.children).length, 12);
  for (const player of before.players) {
    assert.ok(holes[player.seat].children.every(card => card.attributes['aria-label'] !== 'Face-down card'));
  }
  assert.deepEqual(session.getState(), before);
  app.render();
  assert.equal(root.querySelectorAll('.card-back').length, 0);
  root.querySelector('.reveal-hands').events.click();
  assert.equal(root.querySelectorAll('.card-back').length, 10);
  root.querySelector('.reveal-hands').events.click();
  const staleReveal = root.querySelector('.reveal-hands');
  root.querySelector('.next-hand').events.click();
  await Promise.resolve();
  assert.equal(root.querySelector('.reveal-hands'), null);
  assert.equal(root.querySelectorAll('.card-back').length, 10);
  staleReveal.events.click();
  assert.equal(root.querySelectorAll('.card-back').length, 10);
  session.act({ type: 'fold' });
  app.render();
  assert.equal(root.querySelector('.reveal-hands').attributes['aria-pressed'], 'false');
  assert.equal(root.querySelectorAll('.card-back').length, 10);
});

test('table refuses early reveal and preserves showdown cards when reveal is off', t => {
  const session = setup(t);
  assert.equal(renderTable(session.getState(), [], true).querySelectorAll('.card-back').length, 10);
  session.act({ type: 'call' });
  while (session.getState().street !== 'complete') session.act({ type: 'check' });
  const state = session.getState();
  assert.equal(renderTable(state).querySelectorAll('.card-back').length, 8);
  assert.equal(renderTable(state, [], true).querySelectorAll('.card-back').length, 0);
  assert.equal(renderTable(state, [], false).querySelectorAll('.card-back').length, 8);
});

test('AI speed control loads, applies during a hand, and persists its selection', t => {
  const session = setup(t);
  const saved = new Map([['felt-theory-bot-speed', 'slow']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value),
  } });
  const speeds = [];
  const pacing = [];
  session.setBotSpeed = value => speeds.push(value);
  session.setBotPacing = value => pacing.push(value);
  const root = new Node('div');
  const app = mountApp(root, { session });
  t.after(() => app.destroy());
  const select = root.querySelector('#bot-speed');
  assert.equal(select.value, 'slow');
  assert.equal(select.children.length, 5);
  assert.deepEqual(speeds, ['slow']);
  select.value = 'study';
  select.events.change();
  assert.deepEqual(speeds, ['slow', 'study']);
  assert.equal(loadBotSpeed(), 'study');
  app.render();
  assert.equal(root.querySelector('#bot-speed').value, 'study');
  const toggle = root.querySelector('#bot-pacing');
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  toggle.events.change();
  assert.equal(root.querySelector('#bot-speed').disabled, true);
  assert.equal(loadBotPacing(), false);
  assert.deepEqual(pacing, [true, false]);
  app.render();
  assert.equal(root.querySelector('#bot-pacing').checked, false);
  assert.equal(root.querySelector('#bot-speed').value, 'study');
  const enabledToggle = root.querySelector('#bot-pacing');
  enabledToggle.checked = true;
  enabledToggle.events.change();
  assert.equal(root.querySelector('#bot-speed').disabled, false);
  assert.equal(loadBotPacing(), true);
});
