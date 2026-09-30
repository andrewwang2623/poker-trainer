import { element } from './dom.js';

/** Feedback belongs to the current completed hand, never the previous hand. */
export function renderReview(record, explain, error = '') {
  const panel = element('section', 'panel coach-panel');
  panel.id = 'coach-feedback';
  panel.append(element('h2', '', 'Coach feedback'));
  if (error) panel.append(element('p', 'error-message', error));
  if (!record?.coach) {
    panel.append(element('p', '', 'Coach feedback is unavailable for this hand.'));
    return panel;
  }
  const result = record.coach;
  panel.append(element('p', 'coach-grade', `${result.grade} · Estimated EV loss ${result.totalEvLossBb.toFixed(1)} bb`));
  if (!result.flags.length) panel.append(element('p', '', 'No leaks flagged in this hand.'));
  for (const flag of result.flags) {
    const item = element('article', `coach-flag severity-${flag.severity}`);
    const explanation = explain?.(flag);
    item.append(element('h3', '', explanation?.title ?? flag.id),
      element('small', '', `${flag.severity} · ${flag.street ?? 'pattern'}${flag.decisionIndex == null ? '' : ` · Decision #${flag.decisionIndex + 1}`} · ${(flag.evLossBb ?? 0).toFixed(1)} bb EV loss`));
    if (explanation) item.append(element('p', '', explanation.body), element('p', 'coach-tip', explanation.tip));
    panel.append(item);
  }
  for (const decision of result.decisions) {
    panel.append(element('p', 'coach-decision', `Decision #${decision.decisionIndex + 1} · Equity ${decision.equity == null ? '—' : `${Math.round(decision.equity * 100)}%`} · Pot odds ${decision.potOdds == null ? '—' : `${Math.round(decision.potOdds * 100)}%`} · Best ${decision.bestAction} · EV loss ${decision.evLossBb.toFixed(1)} bb`));
  }
  return panel;
}
