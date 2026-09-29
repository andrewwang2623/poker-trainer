import { mountApp } from './ui/index.js';
import { createEngineSession } from './ui/session.js';

const load = path => import(path).catch(() => null);

/** Build the playable app. Optional milestones are loaded independently. */
export async function createApp(settings = { stakes: 'micro', poolOverride: null }, sessionOptions = {}) {
  const sessionId = sessionOptions.sessionId ??
    `session-${globalThis.crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}-${Date.now().toString(36)}`;
  const [engine, realBots, placeholderBots, coach, explain, exporter, data, trackerModule] = await Promise.all([
    load('./engine/index.js'), load('./bots/index.js'), load('./bots/placeholder.js'),
    load('./coach/index.js'), load('./explain/index.js'), load('./export/index.js'),
    load('./data/index.js'), load('./tracker/index.js'),
  ]);
  const bots = realBots?.decideAction && realBots?.createBotProfile ? realBots : placeholderBots;
  if (!engine?.createScenario || !engine?.createHand || !engine?.applyAction ||
      !engine?.getLegalActions || !engine?.getView || !engine?.isComplete ||
      !engine?.buildHandRecord || !bots?.decideAction || !bots?.createBotProfile) {
    throw new Error('The poker engine and placeholder bots are required to start the table.');
  }

  let tracker = null;
  if (data?.openHandStore && trackerModule?.createTracker) {
    try {
      const store = await data.openHandStore();
      tracker = trackerModule.createTracker(store, { sessionId });
    } catch { /* An unavailable store leaves the table playable. */ }
  }

  const activeCoach = coach?.analyzeHand ? coach : null;
  const activeExplain = explain?.explainFlag ? explain : null;
  const activeExporter = exporter?.formatHand ? exporter : null;
  const session = createEngineSession(engine, bots, settings, {
    ...sessionOptions, sessionId, coach: activeCoach, tracker,
  });
  return {
    engine, bots, coach: activeCoach, explain: activeExplain, exporter: activeExporter,
    tracker, session, settings,
    features: {
      realBots: bots === realBots, coach: Boolean(activeCoach), explain: Boolean(activeExplain),
      export: Boolean(activeExporter), tracker: Boolean(tracker), dashboard: Boolean(tracker),
    },
  };
}

if (typeof document !== 'undefined') {
  createApp().then(app => mountApp(document.getElementById('app'), app)).catch(error => {
    document.getElementById('app').textContent = error.message;
  });
}
