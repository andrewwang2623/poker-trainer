// M1 placeholder bots: check if legal, otherwise call. Same interface as bots/index.js.
export { createBotProfile } from './profiles.js';

/**
 * @param {import('../shared/schemas.js').SeatView} view
 * @param {import('../shared/schemas.js').BotProfile} [profile]
 * @param {import('../shared/schemas.js').BotContext} [ctx]
 * @returns {import('../shared/schemas.js').Action}
 */
export function decideAction(view, profile, ctx) {
  const legal = view?.legal;
  if (!legal) throw new RangeError('decideAction: this seat has no action pending');
  if (legal.types.includes('check')) return { type: 'check' };
  if (legal.types.includes('call')) return { type: 'call' };
  return { type: 'fold' };
}
