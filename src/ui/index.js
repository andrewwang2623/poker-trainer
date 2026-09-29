import { createActionTimer, loadTimer, saveTimer } from './action-timer.js';
import { STAKES } from '../shared/schemas.js';
import { createMockSession } from './mock.js';
import { element } from './dom.js';
import { createBoardReveal, renderTable } from './table.js';
import { renderControls } from './controls.js';
import { renderLog } from './log.js';
import { renderSettings } from './settings.js';
import { applyAppearance, loadAppearance, saveAppearance } from './appearance.js';
import { createExportPanel } from './export.js';
import { loadBotSpeed, normalizeBotSpeed, saveBotSpeed } from './bot-speed.js';

/** Mounts the table UI against a session adapter exposing state, legal actions, act and nextHand. */
export function mountApp(rootEl, app = {}) {
  let settings = { stakes: 'micro', poolOverride: null, ...app.settings };
  settings.botSpeed = normalizeBotSpeed(settings.botSpeed ?? loadBotSpeed());
  let appearance = loadAppearance();
  applyAppearance(appearance);
  const session = app.session ?? createMockSession(settings);
  session.setBotSpeed?.(settings.botSpeed);
  const boardReveal = createBoardReveal();
  const exportPanel = app.features?.export && app.exporter ? createExportPanel(app, session) : null;
  let timerSettings = loadTimer();
  let timerNode = null;
  let destroyed = false;
  const timer = createActionTimer(remaining => {
    if (!timerNode) return;
    timerNode.hidden = remaining === null;
    timerNode.textContent = remaining === null ? '' : `${remaining}s left`;
    timerNode.classList.toggle('timer-urgent', remaining !== null && remaining <= 5);
  }, () => {
    const state = session.getState();
    const legal = session.getLegalActions();
    if (destroyed || busy || state.actingSeat !== state.heroSeat || !legal) return;
    const type = legal.types.includes('check') ? 'check' : legal.types.includes('fold') ? 'fold' : null;
    if (type) handleAction({ type });
  });
  let busy = false;
  let error = '';
  let revealedHandId = null;

  function render() {
    if (destroyed) return;
    const state = session.getState();
    if (state.handId !== revealedHandId || state.street !== 'complete') revealedHandId = null;
    const revealHands = revealedHandId === state.handId;
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
    left.append(renderTable(state, boardReveal(state), revealHands));
    const controls = renderControls(state, legal, handleAction, handleNextHand);
    if (state.street === 'complete') {
      const reveal = element('button', 'button button-secondary reveal-hands',
        revealHands ? 'Hide unshown hands' : 'Show everyone’s hands');
      reveal.type = 'button';
      reveal.setAttribute('aria-pressed', String(revealHands));
      reveal.addEventListener('click', () => {
        if (busy || session.getState().street !== 'complete' || session.getState().handId !== state.handId) return;
        revealedHandId = revealHands ? null : state.handId;
        render();
        rootEl.querySelector('.reveal-hands')?.focus();
      });
      controls.append(reveal);
    }
    if (busy) controls.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
    timerNode = element('span', 'action-timer');
    timerNode.setAttribute('role', 'timer');
    timerNode.setAttribute('aria-label', 'Time remaining for your action');
    controls.querySelector('.panel-heading').append(timerNode);
    left.append(controls);
    if (error) left.append(element('p', 'error-message', error));
    const right = element('aside', 'sidebar');
    right.append(renderLog(state), renderSettings(settings, next => {
      const stakeChanged = next.stakes !== settings.stakes;
      if (next.botSpeed !== settings.botSpeed) {
        next.botSpeed = normalizeBotSpeed(next.botSpeed);
        session.setBotSpeed?.(next.botSpeed);
        saveBotSpeed(next.botSpeed);
      }
      Object.assign(settings, next);
      app.settings = settings;
      if (stakeChanged) render();
    }, appearance, next => {
      appearance = next;
      applyAppearance(appearance);
      saveAppearance(appearance);
      render();
    }, timerSettings, next => {
      timerSettings = next;
      saveTimer(next);
      render();
    }));
    const coachPanel = element('section', 'panel coach-panel');
    coachPanel.id = 'coach-feedback';
    coachPanel.hidden = !app.features?.coach || !state.result;
    coachPanel.append(element('h2', '', 'Coach feedback'), element('p', '', 'Feedback appears after the coach is connected.'));
    right.append(coachPanel);
    if (exportPanel) {
      exportPanel.refresh();
      right.append(exportPanel.node);
    }
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
    const timedTurn = timerSettings.enabled && !busy && legal &&
      state.actingSeat === state.heroSeat && !state.result;
    timer.sync(timedTurn ? `${state.handId}:${state.street}:${state.events.length}` : null, timerSettings.seconds);
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
  return { render, destroy: () => { destroyed = true; timer.stop(); unsubscribe?.(); rootEl.replaceChildren(); } };
}
