import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../src/engine/index.js';
import * as bots from '../../src/bots/placeholder.js';
import { BOUNTY_DEFAULTS } from '../../src/shared/schemas.js';
import { normalizeBounty, loadBounty, saveBounty } from '../../src/ui/bounty-settings.js';
import { renderSettings } from '../../src/ui/settings.js';
import { renderTable } from '../../src/ui/table.js';
import { renderLog } from '../../src/ui/log.js';
import { renderControls } from '../../src/ui/controls.js';
import { createEngineSession } from '../../src/ui/session.js';
import { mountApp } from '../../src/ui/index.js';
import { createMockSession } from '../../src/ui/mock.js';
import { createApp } from '../../src/main.js';
import { Node, setup, text } from './bounty-dom.js';
import { bountyHand, finish } from './bounty-fixtures.js';

test('bounty preferences use schema defaults, persist independently, and recover invalid storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(loadBounty(storage), BOUNTY_DEFAULTS);
  const bounty = normalizeBounty({ hand: { enabled: true, chance: 0, amountBb: 3.5 }, card: { enabled: true, chance: 1, amountBb: 0.5 }, paysOn: 'showdownOnly' });
  saveBounty(bounty, storage);
  assert.deepEqual(loadBounty(storage), bounty);
  assert.deepEqual(loadBounty({ getItem: () => '{' }), BOUNTY_DEFAULTS);
  assert.deepEqual(normalizeBounty({ hand: { enabled: 'yes', chance: -1, amountBb: Infinity }, card: { chance: 1.01, amountBb: 0 }, paysOn: 'never' }), BOUNTY_DEFAULTS);
  assert.doesNotThrow(() => saveBounty(bounty, { setItem() { throw Error('unavailable'); } }));
});

test('settings expose each bounty toggle, validated percentages and amounts, and global payout choice', t => {
  setup(t);
  let settings = { stakes: 'micro', bounty: normalizeBounty() };
  const panel = renderSettings(settings, next => { settings = next; }, { theme: 'felt', textSize: 'standard' }, () => {});
  for (const type of ['hand', 'card']) {
    const toggle = panel.querySelector(`#bounty-${type}-enabled`);
    const chance = panel.querySelector(`#bounty-${type}-chance`);
    const amount = panel.querySelector(`#bounty-${type}-amountBb`);
    assert.equal(toggle.checked, BOUNTY_DEFAULTS[type].enabled);
    assert.equal(chance.value, String(BOUNTY_DEFAULTS[type].chance * 100));
    assert.equal(amount.value, String(BOUNTY_DEFAULTS[type].amountBb));
    assert.equal(chance.disabled, true);
    toggle.checked = true; toggle.events.change();
    assert.equal(chance.disabled, false);
    assert.equal(amount.disabled, false);
    for (const [input, invalids] of [[chance, ['', '-1', '101', 'no']], [amount, ['', '0', '-2', 'Infinity', '0.001']]]) {
      const before = input.value;
      for (const invalid of invalids) {
        input.value = invalid; input.events.change();
        assert.equal(input.value, before);
      }
    }
    for (const percent of [0, 37.5, 100]) {
      chance.value = String(percent); chance.events.change();
      assert.equal(settings.bounty[type].chance, percent / 100);
    }
    amount.value = '3.25'; amount.events.change();
    assert.equal(settings.bounty[type].amountBb, 3.25);
    toggle.checked = false; toggle.events.change();
    assert.equal(amount.disabled, true);
    assert.equal(settings.bounty[type].enabled, false);
  }
  const paysOn = panel.querySelector('#bounty-pays-on');
  paysOn.value = 'showdownOnly'; paysOn.events.change();
  assert.equal(settings.bounty.paysOn, 'showdownOnly');
  assert.equal(settings.bounty.hand.amountBb, 3.25, 'editing card settings preserves hand settings');
});

test('mounted settings save bounty changes and restore them on remount', t => {
  const storage = setup(t);
  const root = new Node('div');
  const first = mountApp(root, { session: createMockSession() });
  const toggle = root.querySelector('#bounty-hand-enabled');
  toggle.checked = true; toggle.events.change();
  const chance = root.querySelector('#bounty-hand-chance');
  chance.value = '80'; chance.events.change();
  assert.equal(loadBounty(storage).hand.chance, 0.8);
  first.destroy();
  const second = mountApp(root, { session: createMockSession() });
  t.after(() => second.destroy());
  assert.equal(root.querySelector('#bounty-hand-enabled').checked, true);
  assert.equal(root.querySelector('#bounty-hand-chance').value, '80');
});

test('session passes bounty settings into native generation and changes them next hand', async () => {
  let seed = 100;
  const options = [];
  const wrapped = { ...engine, createScenario(input) { options.push(input); return engine.createScenario(input); } };
  const bounty = normalizeBounty({ hand: { enabled: true, chance: 1, amountBb: 3 }, card: { enabled: true, chance: 1, amountBb: 1 }, paysOn: 'showdownOnly' });
  const session = createEngineSession(wrapped, bots, { bounty }, { seedSource: () => seed++, delay: async () => {} });
  assert.deepEqual(options[0].bounty, bounty);
  assert.deepEqual(session.getState().bounties.map(b => [b.type, b.amountChips, b.paysOn]),
    [['hand', 300, 'showdownOnly'], ['card', 100, 'showdownOnly']]);
  await session.ready;
  while (!engine.isComplete(session.getState())) {
    await session.act({ type: session.getLegalActions().toCall ? 'call' : 'check' });
  }
  await session.nextHand({ bounty: normalizeBounty() });
  assert.deepEqual(session.getState().bounties, []);
});

test('app startup loads persisted bounties before generating the first hand', async t => {
  const storage = setup(t);
  const bounty = normalizeBounty({ hand: { enabled: true, chance: 1, amountBb: 4 } });
  saveBounty(bounty, storage);
  const app = await createApp({ stakes: 'micro' }, { seedSource: () => 456, delay: async () => {} });
  await app.session.ready;
  assert.deepEqual(app.settings.bounty, bounty);
  assert.equal(app.session.getState().bounties.length, 1);
  assert.equal(app.session.getState().bounties[0].amountChips, 400);
});

test('display uses actual stack-limited bounty transfers rather than advertised prize amounts', t => {
  setup(t);
  const state = finish(bountyHand({ targets: ['J4o'], stacks: [10000, 250] }));
  assert.equal(state.result.bountyNetChips[0], 150);
  assert.match(text(renderLog(state)), /receives bounty 1.5 bb/);
  assert.match(text(renderControls(state, null, () => {}, () => {})), /receives 1.5 bb/);
  assert.equal(state.players[1].stack, 0);
});

test('both live bounties appear before the first action without revealing opponent cards', t => {
  setup(t);
  const state = bountyHand();
  const table = renderTable(state);
  const labels = table.querySelectorAll('.bounty-readout').map(text);
  assert.equal(labels.length, 2);
  assert.match(labels[0], /Bounty: J4o · 2.0 bb from each player.*showdown or fold/);
  assert.match(labels[1], /Bounty: 4c/);
  assert.equal(table.querySelectorAll('.card-back').length, 2);
  assert.match(text(renderTable(bountyHand({ paysOn: 'showdownOnly' }))), /Pays on showdown only/);
});

for (const hero of [0, 1]) test(`bounty log, final result, and native final stacks agree for hero seat ${hero}`, t => {
  setup(t);
  const state = finish(bountyHand({ hero }));
  const before = structuredClone(state);
  const lines = renderLog(state).querySelectorAll('.event-item').map(text);
  assert.equal(lines.filter(line => line.includes('receives bounty')).length, 2);
  assert.ok(lines.some(line => line.includes('2.0 bb') && line.includes('hand J4o')));
  assert.ok(lines.some(line => line.includes('card 4c')));
  const controls = renderControls(state, null, () => {}, () => {});
  assert.equal(controls.querySelectorAll('.bounty-result').length, 2);
  assert.match(text(controls), hero === 0 ? /Hero wins 4.9 bb net/ : /Hero loses 5.0 bb net/);
  const table = renderTable(state);
  for (const [seat, node] of table.querySelectorAll('.seat').entries()) {
    const player = state.players[seat];
    const final = player.startStack + state.result.netChips[seat] + state.result.bountyNetChips[seat];
    assert.equal(player.stack, final);
    assert.equal(node.querySelector('.seat-stack').textContent, `${(final / 100).toFixed(1)} bb`);
  }
  assert.deepEqual(state, before, 'rendering never reapplies side payments');
});

test('unclaimed bounties are explicit at hand end; missing/off bounty fields leave old UI unchanged', t => {
  setup(t);
  const denied = finish(bountyHand({ paysOn: 'showdownOnly' }), true);
  assert.ok(renderControls(denied, null, () => {}, () => {}).querySelectorAll('.bounty-result').every(node => /unclaimed/.test(text(node))));
  assert.doesNotMatch(text(renderLog(denied)), /receives bounty/);
  const off = finish(bountyHand({ live: false }));
  for (const legacy of [false, true]) {
    if (legacy) { delete off.bounties; delete off.result.bountyNetChips; }
    assert.equal(renderTable(off).querySelectorAll('.bounty-readout').length, 0);
    assert.equal(renderControls(off, null, () => {}, () => {}).querySelectorAll('.bounty-result').length, 0);
    assert.doesNotMatch(text(renderLog(off)), /bounty/i);
  }
});
