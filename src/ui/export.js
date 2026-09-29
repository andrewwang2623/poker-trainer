import { element } from './dom.js';

/** Keep clipboard access in the UI; the exporter only receives records and options. */
export function createExportPanel(app, session) {
  const node = element('section', 'panel export-panel');
  node.append(element('h2', '', 'Export hands'));
  const label = element('label', 'export-toggle');
  const toggle = element('input');
  toggle.type = 'checkbox';
  label.append(toggle, element('span', '', 'Hide opponent hole cards'));
  const buttons = element('div', 'export-actions');
  const status = element('p', 'export-status');
  status.setAttribute('role', 'status');
  const fallback = element('textarea', 'export-text');
  fallback.setAttribute('aria-label', 'Hand history text for manual copying');
  fallback.readOnly = true;
  fallback.rows = 10;
  fallback.hidden = true;
  let copying = false;
  const controls = [1, 10].map(count => {
    const button = element('button', 'button button-secondary', count === 1 ? 'Copy last hand' : 'Copy last 10 hands');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (copying) return;
      const records = [...(session.getRecentHands?.() ?? [])].sort((a, b) => b.timestamp - a.timestamp).slice(0, count);
      if (!records.length) return;
      copying = true;
      refresh();
      fallback.hidden = true;
      status.textContent = '';
      try {
        const options = { hideOpponentCards: toggle.checked, explain: app.explain?.explainFlag };
        const text = count === 1 ? app.exporter.formatHand(records[0], options) : app.exporter.formatHands(records, options);
        try {
          await globalThis.navigator.clipboard.writeText(text);
          status.textContent = `Copied ${records.length} hand${records.length === 1 ? '' : 's'}.`;
        } catch {
          fallback.value = text;
          fallback.hidden = false;
          fallback.focus();
          fallback.select();
          status.textContent = 'Clipboard unavailable. Copy the selected text below.';
        }
      } catch (error) {
        status.textContent = `Could not export: ${error.message}`;
      } finally {
        copying = false;
        refresh();
      }
    });
    buttons.append(button);
    return button;
  });
  // Do not leave previously revealed text visible after changing the privacy setting.
  toggle.addEventListener('change', () => { fallback.value = ''; fallback.hidden = true; status.textContent = ''; });
  node.append(label, buttons, status, fallback, element('small', '', 'Hand timestamps are UTC.'));
  function refresh() {
    const empty = !(session.getRecentHands?.().length);
    controls.forEach(button => { button.disabled = copying || empty; });
    toggle.disabled = copying;
  }
  refresh();
  return { node, refresh };
}
