// HandEvaluator: Ranks 7 cards down to best 5-card Texas Hold'em hand.
// Categories: 8=StraightFlush, 7=FourKind, 6=FullHouse, 5=Flush, 4=Straight, 3=ThreeKind, 2=TwoPair, 1=OnePair, 0=High
// Ranks: 2..14 (14 = Ace)

import type { Card } from '../types.js';

type RankResult = {
  category: number;
  tiebreak: number[]; // compare lexicographically
};

function countsByRank(cards: Card[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  return m;
}

function isStraight(ranks: number[]): number | null {
  // ranks must be unique & sorted desc
  const u = Array.from(new Set(ranks)).sort((a,b)=>b-a);
  // wheel: A-2-3-4-5 treat Ace as 1
  if (u.includes(14)) u.push(1);
  let run = 1, bestHigh = 0;
  for (let i=0;i<u.length-1;i++){
    if (u[i] === u[i+1]+1){ run++; if (run>=5) bestHigh = Math.max(bestHigh, u[i-3]); }
    else run = 1;
  }
  return bestHigh || null;
}

export const HandEvaluator = {
  rank7(cards: Card[]): RankResult {
    // Derive helper maps
    const byRank = countsByRank(cards);
    const ranksDesc = Array.from(byRank.keys()).sort((a,b)=>b-a);
    const suits = new Map<string, Card[]>();
    for (const c of cards) {
      const arr = suits.get(c.suit) ?? [];
      arr.push(c); suits.set(c.suit, arr);
    }

    // Flush / Straight Flush
    let flushSuit: string | null = null;
    for (const [s, arr] of suits) if (arr.length >= 5) flushSuit = s;
    if (flushSuit) {
      const flushCards = suits.get(flushSuit)!;
      const flushRanks = flushCards.map(c=>c.rank).sort((a,b)=>b-a);
      const sfHigh = isStraight(flushRanks);
      if (sfHigh) return { category: 8, tiebreak: [sfHigh] };
    }

    // Multiples
    const groups = Array.from(byRank.entries()).sort((a,b)=>{
      if (b[1] !== a[1]) return b[1]-a[1]; // by count desc
      return b[0]-a[0]; // then rank desc
    });
    // Four of a kind
    if (groups[0] && groups[0][1] === 4) {
      const quad = groups[0][0];
      const kickers = ranksDesc.filter(r=>r!==quad);
      return { category: 7, tiebreak: [quad, kickers[0]] };
    }
    // Full house (3+2)
    const threes = groups.filter(([_,c])=>c===3).map(([r])=>r).sort((a,b)=>b-a);
    const pairs = groups.filter(([_,c])=>c===2).map(([r])=>r).sort((a,b)=>b-a);
    if (threes.length >= 2 || (threes.length>=1 && pairs.length>=1)) {
      const top3 = threes[0];
      const top2 = threes.length>=2 ? threes[1] : pairs[0];
      return { category: 6, tiebreak: [top3, top2] };
    }
    // Flush (no straight flush)
    if (flushSuit) {
      const top5 = suits.get(flushSuit)!.map(c=>c.rank).sort((a,b)=>b-a).slice(0,5);
      return { category: 5, tiebreak: top5 };
    }
    // Straight
    const sHigh = isStraight(ranksDesc);
    if (sHigh) {
      return { category: 4, tiebreak: [sHigh] };
    }
    // Three of a kind
    if (threes.length >= 1) {
      const r3 = threes[0];
      const kick = ranksDesc.filter(r=>r!==r3).slice(0,2);
      return { category: 3, tiebreak: [r3, ...kick] };
    }
    // Two pair
    if (pairs.length >= 2) {
      const [p1,p2] = pairs.slice(0,2);
      const kick = ranksDesc.filter(r=>r!==p1 && r!==p2)[0];
      const hi = Math.max(p1,p2), lo = Math.min(p1,p2);
      return { category: 2, tiebreak: [hi, lo, kick] };
    }
    // One pair
    if (pairs.length === 1) {
      const p = pairs[0];
      const kick = ranksDesc.filter(r=>r!==p).slice(0,3);
      return { category: 1, tiebreak: [p, ...kick] };
    }
    // High card
    const top5 = ranksDesc.slice(0,5);
    return { category: 0, tiebreak: top5 };
  },

  compare(a: Card[], b: Card[]): number {
    const ra = this.rank7(a);
    const rb = this.rank7(b);
    if (ra.category !== rb.category) return ra.category - rb.category;
    for (let i=0;i<Math.max(ra.tiebreak.length, rb.tiebreak.length);i++){
      const va = ra.tiebreak[i] ?? 0;
      const vb = rb.tiebreak[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }
};
