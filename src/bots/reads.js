// Session reads on hero, for exploiting bots when the tracker isn't wired. Feed it each finished
// HandRecord; summary() returns the StatsSummary fields the exploits use, plus `foldToBet`
// (SPEC §9: hands hero folded to a postflop bet or raise / hands hero faced one), for BotContext.heroStats.

/**
 * @returns {{observe(record: import('../shared/schemas.js').HandRecord): void, summary(): Object}}
 */
export function createHeroReads() {
  const n = {
    hands: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0, cbetOpp: 0, cbet: 0,
    foldToCbetOpp: 0, foldToCbet: 0, sawFlop: 0, wtsd: 0, wsd: 0,
    bets: 0, raises: 0, calls: 0, facingBet: 0, foldedToBet: 0,
  };
  return {
    observe(record) {
      const f = record?.statFlags;
      if (!f) return;
      n.hands++;
      if (f.vpip) n.vpip++;
      if (f.pfr) n.pfr++;
      if (f.threeBetOpp) n.threeBetOpp++;
      if (f.threeBet) n.threeBet++;
      if (f.cbetOpp) n.cbetOpp++;
      if (f.cbet) n.cbet++;
      if (f.foldToCbetOpp) n.foldToCbetOpp++;
      if (f.foldToCbet) n.foldToCbet++;
      if (f.sawFlop) n.sawFlop++;
      if (f.wentToShowdown) n.wtsd++;
      if (f.wonAtShowdown) n.wsd++;
      n.bets += f.postflopBets;
      n.raises += f.postflopRaises;
      n.calls += f.postflopCalls;
      const { faced, folded } = postflopBetFlags(record);
      if (faced) n.facingBet++;
      if (folded) n.foldedToBet++;
    },
    summary() {
      const rate = (x, d) => (d > 0 ? x / d : null);
      return {
        window: 'session',
        hands: n.hands,
        vpip: rate(n.vpip, n.hands),
        pfr: rate(n.pfr, n.hands),
        threeBet: rate(n.threeBet, n.threeBetOpp),
        cbet: rate(n.cbet, n.cbetOpp),
        foldToCbet: rate(n.foldToCbet, n.foldToCbetOpp),
        wtsd: rate(n.wtsd, n.sawFlop),
        wsd: rate(n.wsd, n.wtsd),
        af: rate(n.bets + n.raises, n.calls),
        foldToBet: rate(n.foldedToBet, n.facingBet),
        opportunities: {
          vpip: n.hands, threeBet: n.threeBetOpp, cbet: n.cbetOpp, foldToCbet: n.foldToCbetOpp,
          wtsd: n.sawFlop, wsd: n.wtsd, foldToBet: n.facingBet,
        },
      };
    },
  };
}

/**
 * Per-hand fold-to-bet flags: HeroStatFlags.facedPostflopBet / foldedToPostflopBet, derived from
 * hero's postflop actions for records made before those flags existed.
 */
function postflopBetFlags(record) {
  const f = record.statFlags;
  if (typeof f.facedPostflopBet === 'boolean') {
    return { faced: f.facedPostflopBet, folded: f.foldedToPostflopBet === true };
  }
  const facing = record.events.filter((e) => e.type === 'action' && e.seat === record.heroSeat &&
    e.street !== 'preflop' && e.toCall > 0);
  return { faced: facing.length > 0, folded: facing.some((e) => e.action === 'fold') };
}
