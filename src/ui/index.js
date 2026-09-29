import { STAKES } from '../shared/schemas.js';
import { createMockSession } from './mock.js';
import { element } from './dom.js';
import { renderTable } from './table.js';
import { renderControls } from './controls.js';
import { renderLog } from './log.js';
import { renderSettings } from './settings.js';
import { applyAppearance, loadAppearance, saveAppearance } from './appearance.js';

/** Mounts the table UI against a session adapter exposing state, legal actions, act and nextHand. */
export function mountApp(rootEl, app = {}) {
  let settings = { stakes: 'micro', poolOverride: null, ...app.settings };
  let appearance = loadAppearance();
  applyAppearance(appearance);
  const session = app.session ?? createMockSession(settings);
  let busy = false;
  let error = '';

  function render() {
    const state = session.getState();
    const legal = session.getLegalActions();
    const shell = element('div', 'app-shell');
    const masthead = element('header', 'masthead');
    const title = element('div', 'brand');
    title.append(element('span', 'brand-mark', '♠'), element('span', '', 'Felt Theory'));
    const meta = element('div', 'masthead-meta');
    meta.append(element('span', 'stake-pill', STAKES[state.stakes]?.label ?? state.stakes));
    const dashboardLink = element('a', 'dashboard-link', 'Dashboard ↗');
    dashboardLink.href = '#dashboard';
    dashboardLink.hidden = !app.features?.dashboard;
    meta.append(dashboardLink);
    masthead.append(title, meta);
    const intro = element('div', 'intro-row');
    intro.append(element('div', '', 'Practice table'), element('span', '', `${state.numPlayers} players · No-Limit Hold’em${state.handId.startsWith('mock-') ? ' · Sample hand' : ''}`));
    const layout = element('main', 'game-layout');
    const left = element('div', 'game-column');
    left.append(renderTable(state));
    const controls = renderControls(state, legal, handleAction, handleNextHand);
    if (busy) controls.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
    left.append(controls);
    if (error) left.append(element('p', 'error-message', error));
    const right = element('aside', 'sidebar');
    right.append(renderLog(state), renderSettings(settings, next => {
      const stakeChanged = next.stakes !== settings.stakes;
      Object.assign(settings, next);
      app.settings = settings;
      if (stakeChanged) render();
    }, appearance, next => {
      appearance = next;
      applyAppearance(appearance);
      saveAppearance(appearance);
      render();
    }));
    const coachPanel = element('section', 'panel coach-panel');
    coachPanel.id = 'coach-feedback';
    coachPanel.hidden = !app.features?.coach || !state.result;
    coachPanel.append(element('h2', '', 'Coach feedback'), element('p', '', 'Feedback appears after the coach is connected.'));
    right.append(coachPanel);
    const dashboardPanel = element('section', 'panel dashboard-panel');
    dashboardPanel.id = 'dashboard';
    dashboardPanel.hidden = !app.features?.dashboard;
    dashboardPanel.append(element('h2', '', 'Dashboard'), element('p', '', 'Your long-term stats will appear here.'));
    right.append(dashboardPanel);
    layout.append(left, right);
    shell.append(masthead, intro, layout);
    rootEl.replaceChildren(shell);
    const list = rootEl.querySelector('.event-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  async function handleAction(action) {
    if (busy || !action) return;
    busy = true;
    error = '';
    render();
    try { await session.act(action); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; render(); }
  }

  async function handleNextHand() {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try { await session.nextHand(settings); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; render(); }
  }

  const unsubscribe = session.subscribe?.(render);
  render();
  return { render, destroy: () => { unsubscribe?.(); rootEl.replaceChildren(); } };
}
