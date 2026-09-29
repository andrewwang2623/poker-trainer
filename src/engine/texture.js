// Board texture classification (SPEC §2).
import { parseCard } from './cards.js';

/**
 * @param {string[]} board 3 to 5 cards
 * @returns {import('../shared/schemas.js').Texture|null} null before the flop
 */
export function boardTexture(board) {
  if (!Array.isArray(board) || board.length < 3) return null;
  const cards = board.map(parseCard);
  const suitCounts = [0, 0, 0, 0];
  const rankCounts = new Array(13).fill(0);
  for (const { rank, suit } of cards) {
    suitCounts[suit]++;
    rankCounts[rank]++;
  }
  const maxSuit = Math.max(...suitCounts);
  if (maxSuit >= 3) return 'monotone';
  if (rankCounts.some((n) => n >= 2)) return 'paired';
  const twoTone = maxSuit === 2;
  const connected = isConnected(rankCounts);
  if (twoTone && connected) return 'wet';
  if (twoTone || connected) return 'semiwet';
  return 'dry';
}

/** Any 3 distinct ranks within a 4-rank span (ace plays high or low). */
function isConnected(rankCounts) {
  const values = [];
  if (rankCounts[12]) values.push(1);
  for (let r = 0; r < 13; r++) if (rankCounts[r]) values.push(r + 2);
  for (let i = 0; i + 2 < values.length; i++) {
    if (values[i + 2] - values[i] <= 3) return true;
  }
  return false;
}
