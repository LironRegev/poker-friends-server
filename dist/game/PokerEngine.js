import { HandEvaluator } from './HandEvaluator.js';
const SUITS = ['♣', '♦', '♥', '♠'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J,12=Q,13=K,14=A
const MAX_PLAYERS = 9;
const LOG_LIMIT = 200;
const CATEGORY_NAMES = [
    'High Card', // 0
    'One Pair', // 1
    'Two Pair', // 2
    'Three of a Kind', // 3
    'Straight', // 4
    'Flush', // 5
    'Full House', // 6
    'Four of a Kind', // 7
    'Straight Flush' // 8
];
function catName(cat) {
    if (cat === null || cat === undefined)
        return 'Uncontested';
    return CATEGORY_NAMES[cat] ?? `Cat ${cat}`;
}
function makeDeck() {
    const d = [];
    for (const s of SUITS)
        for (const r of RANKS)
            d.push({ rank: r, suit: s });
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}
function nextSeat(state, from) {
    for (let i = 1; i <= state.players.length; i++) {
        const seat = (from + i) % state.players.length;
        if (state.players[seat].inHand && !state.players[seat].isAllIn)
            return seat;
    }
    return from;
}
export class PokerEngine {
    state;
    // תרומות סיבוב נוכחי
    streetBets = [];
    // תרומות מצטברות לכל היד (נדרש לקופות צד)
    totalBets = [];
    // חשיפות ציבוריות + מי רשאי לבחור Show/Muck
    publicReveals = {}; // key: seat
    revealSeats = new Set();
    // יומן
    actionLog = [];
    constructor(code) {
        this.state = {
            code,
            stage: 'waiting',
            players: [],
            dealerSeat: 0,
            smallBlind: 1,
            bigBlind: 2,
            currentBet: 0,
            minRaise: 2,
            pot: 0,
            community: [],
            turnSeat: 0,
            deck: [],
            lastAggressorSeat: null,
            message: '',
            lastWinners: [],
            actionLog: [],
            pots: []
        };
    }
    // ===== עזר ליומן =====
    log(text) {
        const item = { ts: Date.now(), text };
        this.actionLog.push(item);
        if (this.actionLog.length > LOG_LIMIT)
            this.actionLog.splice(0, this.actionLog.length - LOG_LIMIT);
    }
    // ===== עזר לחשיפות =====
    resetReveals() {
        this.publicReveals = {};
        this.revealSeats.clear();
    }
    // ===== עזר לצ'יפים/תרומות =====
    /** רישום תשלום לקופה: מעדכן stack, flags, streetBets ו-totalBets */
    commitChips(seat, amount) {
        const p = this.state.players[seat];
        const pay = Math.max(0, Math.min(amount, p.stack));
        if (pay <= 0)
            return 0;
        p.stack -= pay;
        if (p.stack === 0)
            p.isAllIn = true;
        this.state.pot += pay;
        this.streetBets[seat] = (this.streetBets[seat] || 0) + pay;
        this.totalBets[seat] = (this.totalBets[seat] || 0) + pay;
        return pay;
    }
    /** בניית קופות צד מתוך totalBets לפי שכבות all-in */
    buildSidePots() {
        const n = this.state.players.length;
        if (n === 0)
            return [];
        // עותק לעבודת שכבות
        const remain = this.totalBets.map(x => Math.max(0, Math.floor(x || 0)));
        const pots = [];
        const stillHasMoney = () => remain.some(v => v > 0);
        while (stillHasMoney()) {
            let layer = Infinity;
            const contributors = [];
            for (let i = 0; i < n; i++) {
                if (remain[i] > 0) {
                    layer = Math.min(layer, remain[i]);
                    contributors.push(i);
                }
            }
            if (!contributors.length || !Number.isFinite(layer) || layer <= 0)
                break;
            const amount = layer * contributors.length;
            // הפחתה מכל מי שתורם בשכבה הנוכחית
            for (const i of contributors)
                remain[i] -= layer;
            // זכאים לקופה: רק שחקנים שלא פרשו (inHand), מתוך התורמים לשכבה
            const eligibleSeats = contributors.filter(i => this.state.players[i]?.inHand);
            if (amount > 0)
                pots.push({ amount, eligibleSeats });
        }
        return pots;
    }
    // ===== API =====
    setBlinds(sb, bb) {
        const s = Math.max(1, Math.floor(Number(sb) || 1));
        const b = Math.max(s, Math.floor(Number(bb) || 2));
        this.state.smallBlind = s;
        this.state.bigBlind = b;
        this.state.minRaise = b;
    }
    isOwner(id) {
        return this.state.players.find(p => p.id === id)?.isOwner ?? false;
    }
    hasPlayer(id) {
        return !!this.state.players.find(p => p.id === id);
    }
    addPlayer(id, name, stack, owner) {
        if (this.state.players.length >= MAX_PLAYERS)
            return false;
        if (this.state.players.some(p => p.name === name))
            return false;
        const seat = this.state.players.length;
        this.state.players.push({
            id, name, stack: Math.max(1, Math.floor(stack)),
            seat, inHand: true, hasActedThisRound: false, isAllIn: false,
            isOwner: owner
        });
        // שמירה על סינכרון מערכי התרומות
        this.streetBets.splice(seat, 0, 0);
        this.totalBets.splice(seat, 0, 0);
        this.log(`Joined: ${name} (Seat ${seat + 1}, Stack ${stack})`);
        return true;
    }
    removePlayer(id) {
        const idx = this.state.players.findIndex(p => p.id === id);
        if (idx === -1)
            return;
        const p = this.state.players[idx];
        this.state.players.splice(idx, 1);
        this.streetBets.splice(idx, 1);
        this.totalBets.splice(idx, 1);
        this.state.players.forEach((pp, i) => pp.seat = i);
        this.log(`Left: ${p.name}`);
        if (this.state.players.length === 0)
            this.state.stage = 'waiting';
    }
    kick(id) {
        this.removePlayer(id);
    }
    // === Views: מוסיפים publicHole/revealSeats/log/winners/pots לסטייט ===
    getBroadcastView() {
        const { deck, players, ...rest } = this.state;
        const pots = this.buildSidePots();
        return {
            ...rest,
            pots,
            players: players.map(p => ({
                id: p.id, name: p.name, stack: p.stack, seat: p.seat,
                inHand: p.inHand, hasActedThisRound: p.hasActedThisRound,
                isAllIn: p.isAllIn, isOwner: p.isOwner,
                holeCount: p.hole ? p.hole.length : 0,
                publicHole: this.publicReveals[p.seat]
            })),
            revealSeats: Array.from(this.revealSeats),
            lastWinners: this.state.lastWinners ?? [],
            actionLog: [...this.actionLog],
        };
    }
    getClientView(requestorId) {
        const pv = this.getBroadcastView();
        const me = this.state.players.find(p => p.id === requestorId);
        if (me?.hole) {
            pv.players = pv.players.map((p) => p.id === requestorId ? { ...p, hole: me.hole } : p);
        }
        return pv;
    }
    // ===== משחק =====
    startHand() {
        if (this.state.players.length < 2) {
            this.state.message = 'Need 2+ players';
            return;
        }
        this.state.deck = makeDeck();
        this.state.community = [];
        this.state.pot = 0;
        this.state.stage = 'preflop';
        this.state.currentBet = 0;
        this.state.minRaise = this.state.bigBlind;
        this.state.players.forEach(p => {
            p.inHand = p.stack > 0;
            p.isAllIn = false;
            p.hasActedThisRound = false;
            p.hole = undefined;
        });
        this.resetReveals();
        this.state.lastWinners = []; // מנקים תצוגת מנצחים קודמת
        this.streetBets = new Array(this.state.players.length).fill(0);
        this.totalBets = new Array(this.state.players.length).fill(0);
        this.state.pots = [];
        // Rotate dealer
        this.state.dealerSeat = (this.state.dealerSeat + 1) % this.state.players.length;
        // Deal 2 to each
        for (const p of this.state.players) {
            if (!p.inHand)
                continue;
            p.hole = [this.state.deck.pop(), this.state.deck.pop()];
        }
        // Blinds
        const sbSeat = (this.state.dealerSeat + 1) % this.state.players.length;
        const bbSeat = (this.state.dealerSeat + 2) % this.state.players.length;
        this.postBlind(sbSeat, this.state.smallBlind);
        this.postBlind(bbSeat, this.state.bigBlind);
        this.state.currentBet = this.state.bigBlind;
        // First action: UTG
        this.state.turnSeat = (this.state.dealerSeat + 3) % this.state.players.length;
        this.state.lastAggressorSeat = bbSeat;
        this.state.message = 'New hand';
        const dealer = this.state.players[this.state.dealerSeat]?.name ?? 'Dealer';
        const sb = this.state.players[sbSeat]?.name ?? 'SB';
        const bb = this.state.players[bbSeat]?.name ?? 'BB';
        this.log(`New hand — Dealer: ${dealer}, SB: ${sb} (${this.state.smallBlind}), BB: ${bb} (${this.state.bigBlind})`);
    }
    postBlind(seat, amount) {
        const paid = this.commitChips(seat, amount);
        const p = this.state.players[seat];
        this.log(`${p.name} posts ${paid}`);
    }
    everyoneActedOrAllIn() {
        for (const p of this.state.players) {
            if (!p.inHand || p.isAllIn)
                continue;
            if (!p.hasActedThisRound)
                return false;
            const contributed = this.streetBets[p.seat] || 0;
            if (contributed < this.state.currentBet)
                return false;
        }
        return true;
    }
    advanceStage() {
        this.state.players.forEach(p => p.hasActedThisRound = false);
        this.state.currentBet = 0;
        this.state.minRaise = this.state.bigBlind;
        this.streetBets = new Array(this.state.players.length).fill(0);
        if (this.state.stage === 'preflop') {
            this.state.deck.pop(); // burn
            const f1 = this.state.deck.pop(), f2 = this.state.deck.pop(), f3 = this.state.deck.pop();
            this.state.community.push(f1, f2, f3);
            this.state.stage = 'flop';
            this.state.turnSeat = nextSeat(this.state, this.state.dealerSeat);
            this.log(`Flop: ${this.cardStr(f1)} ${this.cardStr(f2)} ${this.cardStr(f3)}`);
        }
        else if (this.state.stage === 'flop') {
            this.state.deck.pop(); // burn
            const t = this.state.deck.pop();
            this.state.community.push(t);
            this.state.stage = 'turn';
            this.state.turnSeat = nextSeat(this.state, this.state.dealerSeat);
            this.log(`Turn: ${this.cardStr(t)}`);
        }
        else if (this.state.stage === 'turn') {
            this.state.deck.pop(); // burn
            const r = this.state.deck.pop();
            this.state.community.push(r);
            this.state.stage = 'river';
            this.state.turnSeat = nextSeat(this.state, this.state.dealerSeat);
            this.log(`River: ${this.cardStr(r)}`);
        }
        else if (this.state.stage === 'river') {
            this.state.stage = 'showdown';
            this.resolveShowdown();
            return;
        }
        this.state.message = 'Next street';
    }
    activeCount() {
        return this.state.players.filter(p => p.inHand).length;
    }
    resolveShowdown() {
        const board = this.state.community;
        const contenders = this.state.players.filter(p => p.inHand && p.hole);
        this.resetReveals();
        const winnersInfo = [];
        // נשאר אחד פעיל (כל השאר קיפלו) — לוקח הכול, יכול לבחור לחשוף/לא
        if (contenders.length === 1) {
            const winner = contenders[0];
            const amount = this.state.pot;
            winner.stack += amount;
            this.state.pot = 0;
            this.state.message = `${winner.name} wins (everyone folded) — may show or muck`;
            this.state.stage = 'showdown';
            this.state.turnSeat = -1;
            this.revealSeats.add(winner.seat);
            winnersInfo.push({ seat: winner.seat, name: winner.name, amount, category: null, categoryName: catName(null) });
            this.log(`Win (uncontested): ${winner.name} +${amount}`);
            this.state.lastWinners = winnersInfo;
            this.state.pots = this.buildSidePots();
            return;
        }
        // 2+ מתמודדים — שואודאון מלא עם קופות צד
        // ניקוד לכל מתמודד פעם אחת
        const rankBySeat = new Map();
        for (const p of contenders) {
            const seven = [...board, ...p.hole];
            const r = HandEvaluator.rank7(seven);
            rankBySeat.set(p.seat, r);
        }
        const pots = this.buildSidePots();
        const wonBySeat = new Map();
        for (const pot of pots) {
            // שחקנים זכאים לקופה זו: לא פרשו + ניקוד קיים
            const elig = pot.eligibleSeats.filter(seat => rankBySeat.has(seat));
            if (elig.length === 0)
                continue;
            // מצא(י) את היד(יים) הטובה/ות
            let bestSeats = [];
            let bestR = null;
            for (const s of elig) {
                const r = rankBySeat.get(s);
                if (!bestR || r.category > bestR.category) {
                    bestR = r;
                    bestSeats = [s];
                }
                else if (r.category === bestR.category) {
                    // השוואת Tie-break
                    let cmp = 0;
                    const len = Math.max(r.tiebreak.length, bestR.tiebreak.length);
                    for (let i = 0; i < len; i++) {
                        const a = r.tiebreak[i] ?? 0, b = bestR.tiebreak[i] ?? 0;
                        if (a !== b) {
                            cmp = a - b;
                            break;
                        }
                    }
                    if (cmp > 0) {
                        bestR = r;
                        bestSeats = [s];
                    }
                    else if (cmp === 0)
                        bestSeats.push(s);
                }
            }
            // חלוקה (split) + שאריות הוגנות לפי סדר מושבים
            const share = Math.floor(pot.amount / bestSeats.length);
            let remainder = pot.amount - share * bestSeats.length;
            for (const s of bestSeats) {
                wonBySeat.set(s, (wonBySeat.get(s) || 0) + share);
            }
            bestSeats.sort((a, b) => a - b);
            let idx = 0;
            while (remainder > 0) {
                const s = bestSeats[idx % bestSeats.length];
                wonBySeat.set(s, (wonBySeat.get(s) || 0) + 1);
                remainder--;
                idx++;
            }
        }
        // הפקדת הזכיות לשחקנים
        for (const [seat, amt] of wonBySeat) {
            const p = this.state.players[seat];
            p.stack += amt;
        }
        // עיבוד רשימת מנצחים להצגה
        const winnersList = [...wonBySeat.entries()]
            .map(([seat, amount]) => {
            const p = this.state.players[seat];
            const r = rankBySeat.get(seat);
            return {
                seat,
                name: p.name,
                amount,
                category: r.category,
                categoryName: catName(r.category)
            };
        })
            .sort((a, b) => b.amount - a.amount || a.seat - b.seat);
        // חשיפה אוטומטית למנצחים; מפסידים יכולים לבחור
        const winnerSeats = new Set(winnersList.map(w => w.seat));
        for (const w of winnersList) {
            const pl = this.state.players[w.seat];
            if (pl.hole)
                this.publicReveals[w.seat] = [...pl.hole];
        }
        for (const p of contenders) {
            if (!winnerSeats.has(p.seat))
                this.revealSeats.add(p.seat);
        }
        this.log(`Showdown — ${winnersList.map(w => `${w.name} +${w.amount}`).join(', ')}`);
        this.state.message = winnersList.length === 1
            ? `Winner: ${winnersList[0].name} ${winnersList[0].amount}`
            : `Winners: ${winnersList.map(w => w.name).join(', ')}`;
        this.state.lastWinners = winnersList;
        this.state.stage = 'showdown';
        this.state.turnSeat = -1;
        this.state.pot = 0;
        this.state.pots = pots;
    }
    canReveal(id) {
        const p = this.state.players.find(pp => pp.id === id);
        if (!p)
            return false;
        if (this.state.stage !== 'showdown')
            return false;
        return this.revealSeats.has(p.seat);
    }
    doShow(id) {
        const p = this.state.players.find(pp => pp.id === id);
        if (!p || !this.canReveal(id))
            return false;
        if (p.hole)
            this.publicReveals[p.seat] = [...p.hole];
        this.revealSeats.delete(p.seat);
        this.log(`${p.name} shows`);
        return true;
    }
    doMuck(id) {
        const p = this.state.players.find(pp => pp.id === id);
        if (!p || !this.canReveal(id))
            return false;
        this.publicReveals[p.seat] = undefined;
        this.revealSeats.delete(p.seat);
        this.log(`${p.name} mucks`);
        return true;
    }
    cardStr(c) {
        const r = c.rank <= 10 ? String(c.rank) : (c.rank === 11 ? 'J' : c.rank === 12 ? 'Q' : c.rank === 13 ? 'K' : 'A');
        return `${r}${c.suit}`;
    }
    playerAction(id, kind, amount) {
        if (!['preflop', 'flop', 'turn', 'river'].includes(this.state.stage))
            return false;
        const actor = this.state.players[this.state.turnSeat];
        if (!actor || actor.id !== id || !actor.inHand || actor.isAllIn)
            return false;
        const seat = actor.seat;
        const contributed = this.streetBets[seat] || 0;
        const toCall = Math.max(0, this.state.currentBet - contributed);
        const minRaise = Math.max(this.state.minRaise, this.state.bigBlind);
        if (kind === 'fold') {
            actor.inHand = false;
            actor.hasActedThisRound = true;
            this.log(`${actor.name}: Fold`);
            if (this.activeCount() === 1) {
                const winner = this.state.players.find(p => p.inHand);
                const amount = this.state.pot;
                winner.stack += amount;
                this.state.pot = 0;
                this.state.message = `${winner.name} wins (everyone folded) — may show or muck`;
                this.state.stage = 'showdown';
                this.state.turnSeat = -1;
                this.resetReveals();
                this.revealSeats.add(winner.seat);
                this.state.lastWinners = [{ seat: winner.seat, name: winner.name, amount, category: null, categoryName: catName(null) }];
                this.log(`Win (uncontested): ${winner.name} +${amount}`);
                this.state.pots = this.buildSidePots();
                return true;
            }
        }
        else if (kind === 'check') {
            if (toCall !== 0)
                return false;
            actor.hasActedThisRound = true;
            this.log(`${actor.name}: Check`);
        }
        else if (kind === 'call') {
            if (toCall <= 0)
                return false;
            const pay = this.commitChips(seat, toCall);
            if (pay <= 0)
                return false;
            actor.hasActedThisRound = true;
            this.log(`${actor.name}: Call ${pay}`);
        }
        else if (kind === 'bet') {
            if (this.state.currentBet !== 0)
                return false;
            const desired = Math.max(this.state.bigBlind, Math.floor(amount ?? 0));
            if (desired <= 0)
                return false;
            const need = Math.max(0, desired - contributed);
            const pay = this.commitChips(seat, need);
            if (pay <= 0)
                return false;
            const prev = this.state.currentBet;
            this.state.currentBet = Math.max(prev, this.streetBets[seat]);
            this.state.minRaise = this.state.currentBet;
            this.state.lastAggressorSeat = actor.seat;
            this.state.players.forEach(p => { if (p.seat !== actor.seat && p.inHand && !p.isAllIn)
                p.hasActedThisRound = false; });
            actor.hasActedThisRound = true;
            this.log(`${actor.name}: Bet ${this.state.currentBet}`);
        }
        else if (kind === 'raise') {
            const raiseTo = Math.max(this.state.currentBet + minRaise, Math.floor(amount ?? 0));
            if (raiseTo <= this.state.currentBet)
                return false;
            const need = Math.max(0, raiseTo - contributed);
            const pay = this.commitChips(seat, need);
            if (pay <= 0)
                return false;
            const prev = this.state.currentBet;
            if (this.streetBets[seat] > prev) {
                this.state.currentBet = this.streetBets[seat];
                this.state.minRaise = Math.max(this.state.minRaise, this.state.currentBet - prev);
                this.state.lastAggressorSeat = actor.seat;
                this.state.players.forEach(p => { if (p.seat !== actor.seat && p.inHand && !p.isAllIn)
                    p.hasActedThisRound = false; });
            }
            actor.hasActedThisRound = true;
            this.log(`${actor.name}: Raise to ${this.state.currentBet}`);
        }
        // Move turn / advance street
        if (['preflop', 'flop', 'turn', 'river'].includes(this.state.stage)) {
            if (this.everyoneActedOrAllIn()) {
                this.advanceStage();
            }
            else {
                this.state.turnSeat = nextSeat(this.state, this.state.turnSeat);
            }
        }
        return true;
    }
}
