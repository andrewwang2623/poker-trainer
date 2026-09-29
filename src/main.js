import { mountApp } from './ui/index.js';
import { createMockSession } from './ui/mock.js';
import { createEngineSession } from './ui/session.js';

const settings = { stakes: 'micro', poolOverride: null };
const load = path => import(path).catch(() => null);
const [engine, realBots, placeholderBots] = await Promise.all([
  load('./engine/index.js'), load('./bots/index.js'), load('./bots/placeholder.js'),
]);
const bots = realBots ?? placeholderBots;
const canPlayEngine = Boolean(engine?.createScenario && engine?.createHand && engine?.applyAction &&
  engine?.getLegalActions && engine?.getView && engine?.isComplete && bots?.decideAction && bots?.createBotProfile);
const session = canPlayEngine ? createEngineSession(engine, bots, settings) : createMockSession(settings);
mountApp(document.getElementById('app'), {
  engine, bots, coach: null, explain: null, exporter: null, tracker: null, session,
  settings,
  features: { realBots: Boolean(realBots), coach: false, explain: false, export: false, tracker: false, dashboard: false },
});
