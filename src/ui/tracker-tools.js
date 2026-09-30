import { STATS_WINDOWS } from '../shared/schemas.js';
import { detectDashboardPatterns } from './dashboard.js';
import { element } from './dom.js';

/** Browser-only clipboard, file download, and file selection around the pure tracker API. */
export function createTrackerTools(app, session, { getStakes = () => session.getState().stakes, onRestore = () => {} } = {}) {
  const node = element('section', 'panel tracker-tools'); node.append(element('h2', '', 'History & backups'));
  const actions = element('div', 'export-actions');
  const status = element('p', 'tracker-status'); status.setAttribute('role', 'status');
  const fallback = element('textarea', 'export-text tracker-text'); fallback.readOnly = true; fallback.hidden = true; fallback.rows = 10;
  fallback.setAttribute('aria-label', 'Summary or JSON backup for manual copying');
  const mode = element('select', 'restore-mode'); mode.setAttribute('aria-label', 'JSON restore mode');
  for (const [value, label] of [['merge', 'Merge · keep existing hands'], ['replace', 'Replace · overwrite all saved hands']]) {
    const option = element('option', '', label); option.value = value; mode.append(option);
  }
  mode.value = 'merge';
  const file = element('input', 'restore-file'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  let busy = false;
  const buttons = [];
  const showText = text => { fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select(); };
  const run = async operation => {
    if (busy) return;
    busy = true; buttons.forEach(button => { button.disabled = true; }); mode.disabled = true;
    status.textContent = ''; fallback.hidden = true;
    try { await operation(); } catch (error) { status.textContent = `Could not complete operation: ${error.message}`; }
    finally { busy = false; buttons.forEach(button => { button.disabled = false; }); mode.disabled = false; }
  };
  function button(label, className, operation) {
    const control = element('button', `button button-secondary ${className}`, label); control.type = 'button';
    control.addEventListener('click', operation); buttons.push(control); actions.append(control); return control;
  }
  if (app.features?.export && app.exporter?.formatSummary) button('Copy summary', 'copy-summary', () => run(async () => {
    const stakes = getStakes();
    const stats = await Promise.all(STATS_WINDOWS.map(window => app.tracker.getStats(window, { stakes })));
    const records = await app.tracker.getRecentHands(Infinity);
    let patterns = [];
    try { patterns = detectDashboardPatterns(app.coach, records, stakes); } catch { /* Summary stats remain useful. */ }
    const text = app.exporter.formatSummary({ stats, patterns, stakes: stakes ?? 'mixed' });
    try { await globalThis.navigator.clipboard.writeText(text); status.textContent = 'Copied summary.'; }
    catch { showText(text); status.textContent = 'Clipboard unavailable. Copy the selected summary below.'; }
  }));
  button('Download JSON backup', 'backup-json', () => run(async () => {
    const text = await app.tracker.exportJSON();
    let url;
    try {
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = element('a'); link.href = url; link.download = 'poker-trainer-backup.json'; link.click();
      status.textContent = 'JSON backup downloaded.';
    } catch { showText(text); status.textContent = 'Download unavailable. Copy the selected JSON below.'; }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }));
  button('Restore JSON', 'restore-json', () => { if (!busy) file.click(); });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (!selected) return;
    const selectedMode = mode.value;
    file.value = '';
    return run(async () => {
      const result = await app.tracker.importJSON(await selected.text(), { mode: selectedMode });
      await session.refreshHeroStats?.();
      await onRestore();
      status.textContent = `Restored ${result.added} hands; skipped ${result.skipped} duplicates (${selectedMode}).`;
    });
  });
  node.append(actions, element('label', '', 'Restore mode'), mode, file, status, fallback);
  return { node };
}
