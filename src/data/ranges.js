import { CHART_ACTIONS, DEPTH_BANDS, POSITIONS_BY_SIZE, RANKS, TIERS } from '../shared/schemas.js';

// Solver-approximate 100bb charts for a typical single open. The response charts
// intentionally use one representative opener: actual solver ranges also depend
// on opener position, sizing, rake and antes, which RangeChart does not encode.
// Notation: 77+, A5s-A2s and AJo+ expand to hand classes; @0.5 mixes a fringe hand.
const MID_SPECS = {
  UTG: {
    open: '77+ ATs+ KTs+ QTs+ JTs T9s 98s AQo+ KQo A5s@0.5',
    call: '77-JJ AJs-AQs KQs QJs JTs AQo',
    threeBet: 'QQ+ AKs AKo A5s@0.4 A4s@0.3',
  },
  UTG1: {
    open: '66+ A9s+ KTs+ QTs+ JTs T9s 98s AJo+ KQo A5s-A4s@0.5',
    call: '66-JJ ATs-AQs KQs QJs JTs AQo',
    threeBet: 'QQ+ AKs AKo AQs@0.5 A5s@0.5 A4s@0.35',
  },
  UTG2: {
    open: '66+ A8s+ K9s+ QTs+ JTs T9s 98s 87s ATo+ KQo A5s-A4s@0.5',
    call: '55-JJ ATs-AQs KJs+ QJs JTs T9s AJo-AQo KQo',
    threeBet: 'JJ+ AQs+ AKo A5s-A4s@0.5 KQs@0.3',
  },
  LJ: {
    open: '55+ A7s+ K9s+ Q9s+ J9s+ T9s 98s 87s ATo+ KJo+ QJo A5s-A4s@0.5',
    call: '55-JJ A9s-AQs KTs+ QTs+ JTs T9s 98s AJo-AQo KQo',
    threeBet: 'JJ+ AQs+ AKo A5s-A4s@0.6 KQs@0.4',
  },
  HJ: {
    open: '44+ A5s+ K8s+ Q9s+ J9s+ T8s+ 98s 87s 76s A9o+ KTo+ QJo',
    call: '44-JJ A9s-AQs KTs+ QTs+ JTs T9s 98s 87s ATo-AQo KQo',
    threeBet: 'TT+ AJs+ AKo A5s-A2s@0.6 KQs@0.5',
  },
  CO: {
    open: '22+ A2s+ K5s+ Q8s+ J8s+ T7s+ 97s+ 86s+ 75s+ 65s 54s A8o+ K9o+ QTo+ JTo',
    call: '44-JJ A7s-AQs K9s+ QTs+ J9s+ T9s 98s 87s 76s ATo-AQo KJo+',
    threeBet: 'TT+ AJs+ AQo+ A5s-A2s@0.7 KQs@0.6 KJs@0.4',
  },
  BTN: {
    open: '22+ A2s+ K2s+ Q4s+ J6s+ T6s+ 96s+ 85s+ 74s+ 64s+ 53s+ A2o+ K7o+ Q9o+ J9o+ T9o',
    call: '22-JJ A2s-AQs K7s+ Q8s+ J8s+ T8s+ 97s+ 86s+ 76s 65s A8o-AQo KTo+ QTo+ JTo',
    threeBet: '99+ ATs+ AQo+ A5s-A2s@0.8 KTs+ QJs@0.5 JTs@0.35',
  },
  SB: {
    // The SB open chart covers a first-in raise or limp, per the shared contract.
    open: '22+ A2s+ K2s+ Q2s+ J4s+ T5s+ 95s+ 85s+ 74s+ 64s+ 53s+ A2o+ K5o+ Q7o+ J8o+ T8o+ 98o 87o',
    call: '22-TT A5s-AQs KTs+ QTs+ JTs T9s 98s AJo-AQo KQo',
    threeBet: '88+ ATs+ AQo+ A5s-A2s@0.8 KTs+ QTs+ JTs@0.5',
  },
  BB: {
    open: '',
    call: '22-JJ A2s-AQs K2s+ Q5s+ J7s+ T7s+ 96s+ 85s+ 74s+ 64s+ 54s A2o-AQo K8o+ Q9o+ J9o+ T9o',
    threeBet: '99+ AJs+ AQo+ A5s-A2s@0.8 KQs KJs@0.6 QJs@0.4',
  },
};

const RANK_ORDER = RANKS.join('');
const POSITIONS = POSITIONS_BY_SIZE[9];
const DEEP_EXTRAS = {
  open: 'A5s-A2s@0.5 76s@0.5 65s@0.5 54s@0.4',
  call: '22-66@0.5 A5s-A2s@0.45 98s@0.5 87s@0.5 76s@0.5 65s@0.4',
  threeBet: 'A5s-A2s@0.55 KTs@0.25 QJs@0.25',
};
const SHORT_EXTRAS = {
  open: 'AJo@0.4 KQo@0.4 KJo@0.25',
  call: 'AJo@0.3 KQo@0.3',
  threeBet: 'JJ+ AQs+ AKo',
};

function rankIndex(rank) { return RANK_ORDER.indexOf(rank); }

function expandToken(token) {
  let match = /^([2-9TJQKA])\1\+$/.exec(token);
  if (match) return RANK_ORDER.slice(rankIndex(match[1])).split('').map(rank => rank + rank);
  match = /^([2-9TJQKA])\1-([2-9TJQKA])\2$/.exec(token);
  if (match) {
    const lo = rankIndex(match[1]);
    const hi = rankIndex(match[2]);
    if (lo > hi) throw new RangeError(`Invalid pair range: ${token}`);
    return RANK_ORDER.slice(lo, hi + 1).split('').map(rank => rank + rank);
  }
  match = /^([2-9TJQKA])([2-9TJQKA])([so])\+$/.exec(token);
  if (match) {
    const high = rankIndex(match[1]);
    const low = rankIndex(match[2]);
    if (low >= high) throw new RangeError(`Invalid hand range: ${token}`);
    return RANK_ORDER.slice(low, high).split('').map(rank => match[1] + rank + match[3]);
  }
  match = /^([2-9TJQKA])([2-9TJQKA])([so])-([2-9TJQKA])([2-9TJQKA])([so])$/.exec(token);
  if (match) {
    const lo = rankIndex(match[2]);
    const hi = rankIndex(match[5]);
    if (match[1] !== match[4] || match[3] !== match[6] || Math.max(lo, hi) >= rankIndex(match[1])) {
      throw new RangeError(`Invalid hand range: ${token}`);
    }
    return RANK_ORDER.slice(Math.min(lo, hi), Math.max(lo, hi) + 1)
      .split('').map(rank => match[1] + rank + match[3]);
  }
  if (/^([2-9TJQKA])\1$/.test(token)) return [token];
  match = /^([2-9TJQKA])([2-9TJQKA])([so])$/.exec(token);
  if (match && rankIndex(match[1]) > rankIndex(match[2])) return [token];
  throw new RangeError(`Invalid hand class token: ${token}`);
}

function addSpec(range, spec) {
  for (const raw of spec.split(/\s+/).filter(Boolean)) {
    const [token, weight] = raw.split('@');
    const frequency = weight === undefined ? 1 : Number(weight);
    if (!(frequency > 0 && frequency <= 1)) throw new RangeError(`Invalid frequency: ${raw}`);
    for (const hand of expandToken(token)) range[hand] = Math.max(range[hand] ?? 0, frequency);
  }
  return range;
}

function speculative(hand) {
  if (!hand.endsWith('s')) return false;
  const high = rankIndex(hand[0]);
  const low = rankIndex(hand[1]);
  return (hand[0] === 'A' && low <= rankIndex('5')) ||
    (high <= rankIndex('J') && high - low <= 2);
}

function adjustForDepth(base, band, action, position) {
  if (band === 'mid' || (position === 'BB' && action === 'open')) return { ...base };
  const range = { ...base };
  if (band === 'short') {
    for (const [hand, frequency] of Object.entries(range)) {
      const smallPair = hand.length === 2 && rankIndex(hand[0]) <= rankIndex('5');
      const factor = speculative(hand) ? (action === 'threeBet' ? 0.5 : 0.65)
        : smallPair && action === 'call' ? 0.7 : 1;
      range[hand] = Math.round(frequency * factor * 100) / 100;
    }
    addSpec(range, SHORT_EXTRAS[action]);
  } else {
    for (const [hand, frequency] of Object.entries(range)) {
      const factor = speculative(hand) ? 1.15 : hand.endsWith('o') && action !== 'threeBet' ? 0.9 : 1;
      range[hand] = Math.min(1, Math.round(frequency * factor * 100) / 100);
    }
    addSpec(range, DEEP_EXTRAS[action]);
  }
  return range;
}

function resolveResponses(call, threeBet) {
  for (const [hand, frequency] of Object.entries(call)) {
    const available = Math.max(0, Math.round((1 - (threeBet[hand] ?? 0)) * 100) / 100);
    call[hand] = Math.min(frequency, available);
    if (!call[hand]) delete call[hand];
  }
}

function freezeChart(chart) {
  for (const position of POSITIONS) {
    for (const band of DEPTH_BANDS) {
      for (const action of CHART_ACTIONS) Object.freeze(chart[position][band][action]);
      Object.freeze(chart[position][band]);
    }
    Object.freeze(chart[position]);
  }
  return Object.freeze(chart);
}

function buildBaseChart() {
  const chart = {};
  for (const position of POSITIONS) {
    chart[position] = {};
    for (const band of DEPTH_BANDS) {
      const actions = Object.fromEntries(CHART_ACTIONS.map(action => [
        action, adjustForDepth(addSpec({}, MID_SPECS[position][action]), band, action, position),
      ]));
      resolveResponses(actions.call, actions.threeBet);
      chart[position][band] = actions;
    }
  }
  return freezeChart(chart);
}

/** @type {import('../shared/schemas.js').RangeChart} */
export const RANGE_CHART = buildBaseChart();

function addFishFringe(range, action, position) {
  if (position === 'BB' && action === 'open') return;
  const extra = action === 'open'
    ? 'A2o+ K2o+ Q5o+ J7o+ T7o+ 98o 87o 76o K2s+ Q2s+ J4s+ T5s+ 95s+ 85s+ 74s+ 64s+ 53s+ 22+'
    : 'A2o+ K7o+ Q9o+ J9o+ T9o 22+ A2s+ K2s+ Q6s+ J7s+ T7s+';
  const additions = addSpec({}, extra);
  for (const hand of Object.keys(additions)) range[hand] = Math.max(range[hand] ?? 0, 0.35);
}

function buildTierChart(tier) {
  const chart = {};
  for (const position of POSITIONS) {
    chart[position] = {};
    for (const band of DEPTH_BANDS) {
      const source = RANGE_CHART[position][band];
      const actions = {};
      for (const action of CHART_ACTIONS) {
        const range = {};
        for (const [hand, frequency] of Object.entries(source[action])) {
          let factor;
          if (tier === 'fish') factor = action === 'threeBet' ? 0.6 : action === 'call' ? 1.18 : 1.08;
          else factor = action === 'threeBet' ? 0.82 : action === 'call' ? 0.8 : 0.88;
          const premium = ['AA', 'KK', 'QQ', 'AKs', 'AKo'].includes(hand);
          range[hand] = premium && action !== 'call' && tier === 'lowReg'
            ? frequency : Math.min(1, Math.round(frequency * factor * 100) / 100);
        }
        if (tier === 'fish' && action !== 'threeBet') addFishFringe(range, action, position);
        actions[action] = range;
      }
      resolveResponses(actions.call, actions.threeBet);
      chart[position][band] = actions;
    }
  }
  return freezeChart(chart);
}

// Fish play more hands, especially by calling, but 3-bet less often. Low-stakes
// regs use a tighter version of the base chart. Mid/tough regs use the base.
export const TIER_RANGE_CHARTS = Object.freeze({
  fish: buildTierChart('fish'),
  lowReg: buildTierChart('lowReg'),
  midReg: RANGE_CHART,
  toughReg: RANGE_CHART,
});

/** Return the base HandRange. Missing hand classes have frequency zero. */
export function getChartRange(position, band, action) {
  if (!Object.hasOwn(RANGE_CHART, position) || !DEPTH_BANDS.includes(band) || !CHART_ACTIONS.includes(action)) {
    throw new RangeError(`Unknown chart key: ${position}/${band}/${action}`);
  }
  return RANGE_CHART[position][band][action];
}

/** Return a tier variant; midReg and toughReg use the base chart. */
export function getTierChartRange(tier, position, band, action) {
  if (!TIERS.includes(tier)) throw new RangeError(`Unknown tier: ${tier}`);
  getChartRange(position, band, action);
  return TIER_RANGE_CHARTS[tier][position][band][action];
}
