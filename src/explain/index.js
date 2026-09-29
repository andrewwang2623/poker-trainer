import { templates } from './templates.js';

/**
 * Render a CoachFlag without reading application state or mutating the flag.
 * Pattern flags always use the default; absent tier variants fall back to it.
 * @param {import('../shared/schemas.js').CoachFlag} flag
 * @returns {import('../shared/schemas.js').Explanation}
 */
export function explainFlag(flag) {
  const variants = Object.hasOwn(templates, flag?.id) ? templates[flag.id] : null;
  if (!variants) {
    return {
      title: 'Coach note',
      body: `No explanation template is available for ${flag?.id ?? 'this flag'}.`,
      tip: 'Review the decision and its coach data.',
    };
  }
  const group = flag.id.startsWith('PAT_') ? 'default'
    : flag.oppTier === 'fish' ? 'fish'
      : flag.oppTier === 'lowReg' || flag.oppTier === 'midReg' ? 'reg'
        : flag.oppTier === 'toughReg' ? 'tough' : 'default';
  return (variants[group] ?? variants.default)(flag.data ?? {});
}
