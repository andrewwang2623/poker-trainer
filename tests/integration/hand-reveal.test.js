import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApp } from '../../src/ui/index.js';
import { canRabbitHunt, renderTable } from '../../src/ui/table.js';
import * as engine from '../../src/engine/index.js';
import { createMockSession } from '../../src/ui/mock.js';
import { loadBotPacing, loadBotSpeed, loadOutBotSpeed } from '../../src/ui/bot-speed.js';

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

test('rabbit hunt is post-hand only, toggles independently of hole cards, and resets next hand', async t => {
  const session = setup(t);
  const root = new Node('div');
  const app = mountApp(root, { session });
  t.after(() => app.destroy());
  assert.equal(root.querySelector('.rabbit-hunt'), null);
  assert.equal(renderTable(session.getState(), [], false, true).querySelector('.rabbit-card'), null);
  session.act({ type: 'fold' });
  app.render();
  const before = structuredClone(session.getState());
  root.querySelector('.rabbit-hunt').events.click();
  assert.equal(root.querySelectorAll('.rabbit-card').length, 5);
  assert.equal(root.querySelector('.rabbit-hunt').attributes['aria-pressed'], 'true');
  assert.equal(root.querySelector('.rabbit-hunt').focused, true);
  assert.equal(root.querySelectorAll('.card-back').length, 10);
  assert.match(root.querySelector('.rabbit-note').textContent, /not dealt/);
  root.querySelector('.reveal-hands').events.click();
  assert.equal(root.querySelectorAll('.rabbit-card').length, 5);
  assert.equal(root.querySelectorAll('.card-back').length, 0);
  assert.deepEqual(session.getState(), before);
  root.querySelector('.rabbit-hunt').events.click();
  assert.equal(root.querySelectorAll('.rabbit-card').length, 0);
  root.querySelector('.rabbit-hunt').events.click();
  const staleRabbit = root.querySelector('.rabbit-hunt');
  root.querySelector('.next-hand').events.click();
  await Promise.resolve();
  staleRabbit.events.click();
  assert.equal(root.querySelector('.rabbit-hunt'), null);
  assert.equal(root.querySelectorAll('.rabbit-card').length, 0);
  session.act({ type: 'fold' });
  app.render();
  assert.equal(root.querySelector('.rabbit-hunt').attributes['aria-pressed'], 'false');
});

test('rabbit cards match the engine runout after preflop, flop, and turn folds without changing records', t => {
  setup(t);
  const scenario = {
    seed: 123, createdAt: 123456789, stakes: 'micro', numPlayers: 2, buttonSeat: 0, heroSeat: 0,
    seats: [0, 1].map(seat => ({ seat, isHero: seat === 0, stack: 10000,
      tier: seat === 0 ? null : 'fish', profile: null })),
  };
  const continueHand = state => engine.applyAction(state,
    { type: engine.getLegalActions(state).types.includes('check') ? 'check' : 'call' });
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    let state = engine.createHand(scenario);
    while (state.street !== street) state = continueHand(state);
    if (!engine.getLegalActions(state).types.includes('fold')) {
      state = engine.applyAction(state, { type: 'bet', amount: engine.getLegalActions(state).minTo });
    }
    const ended = engine.applyAction(state, { type: 'fold' });
    const before = structuredClone(ended);
    const meta = { sessionId: 'rabbit-test', timestamp: 123456789 };
    const record = engine.buildHandRecord(ended, meta);
    let runout = state;
    while (!engine.isComplete(runout)) runout = continueHand(runout);
    const table = renderTable(ended, [], false, true);
    const boardCards = table.querySelector('.board-cards').querySelectorAll('.card');
    assert.deepEqual(boardCards.map(card => card.textContent),
      runout.board.map(code => `${code[0]}${{ c: '♣', d: '♦', h: '♥', s: '♠' }[code[1]]}`));
    assert.equal(table.querySelectorAll('.rabbit-card').length, 5 - ended.board.length);
    assert.equal(canRabbitHunt(ended), street !== 'river');
    assert.deepEqual(ended, before);
    assert.deepEqual(engine.buildHandRecord(ended, meta), record);
    assert.equal(canRabbitHunt({ ...ended, deck: undefined }), false);
    assert.equal(canRabbitHunt({ ...ended, deck: [] }), false);
  }
});

test('check badges show hero and AI checks, replace later actions, and reset across hands', t => {
  const session = setup(t);
  session.act({ type: 'call' });
  const state = structuredClone(session.getState());
  // The mock checks the BB to hero on the flop.
  assert.match(renderTable(state).querySelector('.seat-check').attributes['aria-label'], /checks on the flop/);
  const check = { seq: state.events.length, type: 'action', street: 'flop', seat: state.heroSeat,
    action: 'check', amount: 0, to: 0, allIn: false, potBefore: state.potCollected, toCall: 0,
    stackBefore: state.players[state.heroSeat].stack };
  state.events.push(check);
  let table = renderTable(state);
  assert.equal(table.querySelectorAll('.seat-check').length, 2);
  assert.equal(table.querySelector('.seat-hero').querySelector('.seat-check').textContent, 'Check');
  state.events.push({ ...check, seq: check.seq + 1, action: 'bet', amount: 100, to: 100 });
  state.players[state.heroSeat].committedStreet = 100;
  table = renderTable(state);
  assert.equal(table.querySelector('.seat-hero').querySelector('.seat-check'), null);
  assert.equal(table.querySelector('.seat-hero').querySelector('.bet-chips').textContent, '1.0 bb');
  session.nextHand();
  assert.equal(renderTable(session.getState()).querySelector('.seat-check'), null);
});

test('street-closing checks remain visible until the next action, including the final river check', t => {
  const session = setup(t);
  session.act({ type: 'call' });
  const state = structuredClone(session.getState());
  const closingCheck = { ...state.events.at(-1), seq: state.events.length, seat: state.heroSeat };
  state.events.push(closingCheck, { seq: state.events.length + 1, type: 'board', street: 'turn', cards: ['9s'] });
  state.street = 'turn';
  state.board.push('9s');
  assert.equal(renderTable(state).querySelector('.seat-hero').querySelector('.seat-check').textContent, 'Check · flop');
  state.events.push({ ...closingCheck, seq: state.events.length, seat: 5, street: 'turn' });
  assert.equal(renderTable(state).querySelector('.seat-hero').querySelector('.seat-check'), null);
  while (session.getState().street !== 'complete') session.act({ type: 'check' });
  const checks = renderTable(session.getState()).querySelectorAll('.seat-check');
  assert.equal(checks.length, 2);
  assert.ok(checks.every(node => node.attributes['aria-label'].endsWith('river')));
});

test('table shows current stakes rake during play and actual rake after the hand', t => {
  const session = setup(t);
  const state = session.getState();
  for (const [stakes, policy] of [
    ['micro', 'Rake 5% · Cap 4.0 bb'], ['low', 'Rake 5% · Cap 3.0 bb'],
    ['mid', 'Rake 4.5% · Cap 3.0 bb'], ['high', 'Rake 3.5% · Cap 0.6 bb'],
  ]) {
    const table = renderTable({ ...state, stakes });
    assert.equal(table.querySelector('.rake-policy').textContent, policy);
    assert.equal(table.querySelector('.rake-rule').textContent, 'No flop, no drop');
    assert.equal(table.querySelector('.rake-taken'), null);
  }
  session.act({ type: 'fold' });
  assert.equal(renderTable(session.getState()).querySelector('.rake-taken').textContent, 'Rake taken: 0.0 bb');
  session.nextHand();
  session.act({ type: 'call' });
  assert.equal(renderTable(session.getState()).querySelector('.rake-taken'), null);
  while (session.getState().street !== 'complete') session.act({ type: 'check' });
  const finished = session.getState();
  assert.ok(finished.result.rakeChips > 0);
  assert.equal(renderTable(finished).querySelector('.rake-taken').textContent,
    `Rake taken: ${(finished.result.rakeChips / 100).toFixed(1)} bb`);
});

test('header displays actual blinds for the current hand rather than next-hand settings', t => {
  const session = setup(t);
  const root = new Node('div');
  const app = mountApp(root, { session, settings: { stakes: 'high' } });
  t.after(() => app.destroy());
  assert.equal(root.querySelector('.stake-pill').textContent, 'Micro (NL5) · $0.02/$0.05');
  for (const [stakes, label] of [
    ['low', 'Low (NL25) · $0.10/$0.25'], ['mid', 'Mid (NL100) · $0.50/$1.00'],
    ['high', 'High (NL500) · $2.50/$5.00'],
  ]) {
    session.nextHand({ stakes });
    app.render();
    assert.equal(root.querySelector('.stake-pill').textContent, label);
  }
});

test('AI speed control loads, applies during a hand, and persists its selection', t => {
  const session = setup(t);
  const saved = new Map([['felt-theory-bot-speed', 'slow']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value),
  } });
  const speeds = [];
  const pacing = [];
  const outSpeeds = [];
  session.setBotSpeed = value => speeds.push(value);
  session.setBotPacing = value => pacing.push(value);
  session.setOutBotSpeed = value => outSpeeds.push(value);
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
  const outSelect = root.querySelector('#bot-speed-out');
  assert.equal(outSelect.value, 'normal');
  assert.notEqual(outSelect.disabled, true);
  outSelect.value = 'instant';
  outSelect.events.change();
  assert.deepEqual(outSpeeds, ['normal', 'instant']);
  assert.equal(loadOutBotSpeed(), 'instant');
  assert.equal(loadBotSpeed(), 'study');
  assert.deepEqual(pacing, [true, false]);
  app.render();
  assert.equal(root.querySelector('#bot-pacing').checked, false);
  assert.equal(root.querySelector('#bot-speed-out').value, 'instant');
  assert.equal(root.querySelector('#bot-speed').value, 'study');
  const enabledToggle = root.querySelector('#bot-pacing');
  enabledToggle.checked = true;
  enabledToggle.events.change();
  assert.equal(root.querySelector('#bot-speed').disabled, false);
  assert.equal(loadBotPacing(), true);
});
