import { STAKES, STATS_WINDOWS } from '../shared/schemas.js';
import { element } from './dom.js';

const number = value => value == null ? '—' : value.toFixed(1);
const signed = value => `${value >= 0 ? '+' : ''}${number(value)}`;
const percent = value => value == null ? '—' : `${Math.round(100 * value)}%`;
const evNet = record => record.heroEvNetBb ?? record.heroNetBb;
const windowName = value => typeof value === 'number' ? `Last ${value.toLocaleString('en-US')}` : value === 'session' ? 'Session' : 'All hands';

/** Coach patterns always receive a valid StakesId, even when the dashboard combines stakes. */
export function detectDashboardPatterns(coach, records, stakes) {
  if (!coach?.detectPatterns) return [];
  if (stakes) return coach.detectPatterns(records.filter(record => record.stakes === stakes), stakes);
  return Object.keys(STAKES).flatMap(id => {
    const group = records.filter(record => record.stakes === id);
    return group.length ? coach.detectPatterns(group, id) : [];
  });
}

export async function loadDashboardData(app, session, { window = 100, stakes } = {}) {
  const [stats, all] = await Promise.all([
    app.tracker.getStats(window, { stakes }), app.tracker.getRecentHands(Infinity),
  ]);
  const filtered = stakes ? all.filter(record => record.stakes === stakes) : all;
  const records = window === 'session' ? filtered.filter(record => record.sessionId === session.getSessionId?.())
    : typeof window === 'number' ? filtered.slice(0, window) : filtered;
  let patterns = [], patternError = '';
  try { patterns = detectDashboardPatterns(app.coach, filtered, stakes); }
  catch { patternError = 'Pattern analysis unavailable.'; }
  return { stats, records, patterns, patternError };
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** Cumulative results against hand count, with a shared scale and a visible zero line. */
export function renderTrendChart(records) {
  const figure = element('figure', 'trend-chart');
  figure.append(element('figcaption', '', 'Cumulative results · bb'));
  if (!records.length) { figure.append(element('p', '', 'Complete a hand to start your chart.')); return figure; }
  const chronological = [...records].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const series = [
    { name: 'Net (excluding bounties)', color: 'var(--gold)', get: record => record.heroNetBb },
    { name: 'All-in EV (excluding bounties)', color: '#78c7e8', get: evNet },
    { name: 'Net with bounties', color: '#bda0f5', get: record => record.heroNetBb + (record.heroBountyBb ?? 0) },
  ].map(item => {
    let total = 0;
    return { ...item, points: [0, ...chronological.map(record => total += item.get(record))] };
  });
  const values = series.flatMap(item => item.points);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const span = high - low || 1;
  const y = value => 185 - (value - low) / span * 155;
  const x = index => 55 + index / chronological.length * 525;
  const svg = svgElement('svg', { viewBox: '0 0 620 225', role: 'img', 'aria-label': `Cumulative net, all-in EV and bounty-inclusive results over ${chronological.length} hands` });
  svg.append(svgElement('line', { x1: 55, x2: 580, y1: y(0), y2: y(0), stroke: 'currentColor', opacity: '.35' }));
  for (const value of [high, low]) {
    const label = svgElement('text', { x: 4, y: y(value) + 4, fill: 'currentColor', 'font-size': 12 });
    label.textContent = number(value); svg.append(label);
  }
  for (const item of series) svg.append(svgElement('polyline', {
    points: item.points.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(' '),
    fill: 'none', stroke: item.color, 'stroke-width': 2, 'stroke-dasharray': item.name.startsWith('Net with') ? '5 4' : 'none',
  }));
  for (const [index, label] of [[0, '0'], [chronological.length, `${chronological.length} hands`]]) {
    const node = svgElement('text', { x: x(index), y: 212, fill: 'currentColor', 'font-size': 12, 'text-anchor': index ? 'end' : 'start' });
    node.textContent = label; svg.append(node);
  }
  figure.append(svg);
  const legend = element('div', 'chart-legend');
  for (const item of series) { const label = element('span', '', item.name); label.style.color = item.color; legend.append(label); }
  figure.append(legend);
  return figure;
}

export function renderDashboard({ stats, records, patterns, patternError }, explain) {
  const content = element('div', 'dashboard-content');
  content.append(element('p', 'dashboard-sample', `${windowName(stats.window)} · ${stats.hands.toLocaleString('en-US')} hands · ${STAKES[stats.stakes]?.label ?? 'Mixed stakes'}`));
  const cards = element('div', 'stat-grid');
  const items = [
    ['bb/100 · excluding bounties', signed(stats.bbPer100)], ['bb/100 · with bounties', signed(stats.bbPer100WithBounty)],
    ['Bounty bb/100', signed(stats.bountyPer100)], ['All-in EV bb/100', signed(stats.evAdjBbPer100)],
    ['EV loss/100', stats.coachedHands ? number(stats.evLossPer100) : '—'], ['Hero rake/100', number(stats.rakePer100)],
    ...Object.entries({ vpip: 'VPIP', pfr: 'PFR', threeBet: '3-bet', cbet: 'C-bet', foldToCbet: 'Fold to c-bet', foldToBet: 'Fold to bet', wtsd: 'WTSD', wsd: 'W$SD' }).map(([key, label]) => [label, percent(stats[key])]),
    ['Aggression factor', number(stats.af)],
  ];
  for (const [label, value] of items) {
    const card = element('article', 'stat-card'); card.append(element('span', '', label), element('strong', '', value)); cards.append(card);
  }
  content.append(cards, element('p', '', stats.hands > 1
    ? `All-in EV win rate 95% CI: ${stats.evAdjCi95.map(signed).join(' to ')} bb/100`
    : 'At least two hands are needed for a sample variance confidence interval.'), renderTrendChart(records));
  if (stats.trend) content.append(element('p', 'window-trend', `Versus previous ${stats.window} hands: bb/100 ${signed(stats.trend.bbPer100Delta)} · EV loss/100 ${signed(stats.trend.evLossPer100Delta)} · VPIP ${stats.trend.vpipDelta == null ? '—' : `${signed(stats.trend.vpipDelta * 100)} percentage points`}`));
  const leaks = element('section', 'panel dashboard-leaks'); leaks.append(element('h2', '', 'Top leaks'));
  if (!stats.topLeaks.length) leaks.append(element('p', '', stats.coachedHands ? 'No leaks flagged in this window.' : 'No coached hands in this window.'));
  for (const leak of stats.topLeaks) leaks.append(element('p', '', `${leak.flagId} · ${leak.count}× · ${number(leak.evLossBb)} bb total EV loss`));
  const flags = element('section', 'panel dashboard-patterns'); flags.append(element('h2', '', 'Pattern flags'));
  if (!patterns.length) flags.append(element('p', '', patternError || 'No pattern flags available.'));
  for (const flag of patterns) {
    const explanation = explain?.(flag);
    flags.append(element('h3', '', `${flag.severity} · ${explanation?.title ?? flag.id}`));
    if (explanation) flags.append(element('p', '', explanation.body), element('p', 'coach-tip', explanation.tip));
  }
  content.append(leaks, flags);
  const estimate = stats.profitability;
  const profitability = element('section', 'panel profitability'); profitability.append(element('h2', '', 'Profitability estimate'),
    element('p', 'profitability-verdict', `${estimate.verdict.replaceAll('_', ' ')} · Confidence: ${estimate.confidence}`),
    element('p', '', `${signed(estimate.estimateBbPer100)} bb/100 estimated · ${signed(estimate.modelBbPer100)} model · ${Math.round(estimate.observedWeight * 100)}% observed weight (excluding bounties)`),
    element('p', '', estimate.reasons.join('; ')), element('p', 'profitability-disclaimer', estimate.disclaimer));
  content.append(profitability);
  return content;
}

export function createDashboard(app, session) {
  const node = element('main', 'dashboard'); node.id = 'dashboard';
  const heading = element('div', 'panel dashboard-heading'); heading.append(element('h1', '', 'Your dashboard'));
  let window = 100, stakes = session.getState().stakes, version = 0, lastKey;
  const filters = element('div', 'dashboard-filters');
  const windowSelect = element('select'); windowSelect.setAttribute('aria-label', 'Stats window');
  for (const value of STATS_WINDOWS) { const option = element('option', '', windowName(value)); option.value = String(value); windowSelect.append(option); }
  windowSelect.value = '100';
  const stakesSelect = element('select'); stakesSelect.setAttribute('aria-label', 'Dashboard stakes');
  const all = element('option', '', 'All stakes'); all.value = ''; stakesSelect.append(all);
  for (const [id, config] of Object.entries(STAKES)) { const option = element('option', '', config.label); option.value = id; stakesSelect.append(option); }
  stakesSelect.value = stakes;
  windowSelect.addEventListener('change', () => { window = /^\d+$/.test(windowSelect.value) ? Number(windowSelect.value) : windowSelect.value; refresh(true); });
  stakesSelect.addEventListener('change', () => { stakes = stakesSelect.value || undefined; refresh(true); });
  filters.append(windowSelect, stakesSelect); heading.append(filters);
  if (app.storageMode === 'memory') heading.append(element('p', '', 'Storage is temporary in this browser. Download a JSON backup to keep your hands.'));
  const body = element('div'); node.append(heading, body);
  async function refresh(force = false) {
    const key = `${window}:${stakes}:${session.getRecentHands?.()[0]?.id ?? ''}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const current = ++version;
    body.replaceChildren(element('p', '', 'Loading stats…'));
    try {
      const data = await loadDashboardData(app, session, { window, stakes });
      if (version === current) body.replaceChildren(renderDashboard(data, app.explain?.explainFlag));
    } catch (error) {
      if (version === current) { lastKey = null; body.replaceChildren(element('p', 'error-message', `Could not load stats: ${error.message}`)); }
    }
  }
  return { node, refresh, getStakes: () => stakes, destroy() { version++; } };
}
