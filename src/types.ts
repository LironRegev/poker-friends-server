export type Stage = 'waiting'|'preflop'|'flop'|'turn'|'river'|'showdown';

export type Card = { rank: number; suit: '♣'|'♦'|'♥'|'♠' };
export type Player = {
  id: string;
  name: string;
  stack: number;
  seat: number;
  hole?: Card[];
  inHand: boolean;
  hasActedThisRound: boolean;
  isAllIn: boolean;
  isOwner?: boolean;
};
export type Pot = { amount: number };

export type WinnerInfo = {
  seat: number;
  name: string;
  amount: number;
  category: number | null;     // null במצב ניצחון בקיפול (בלי שואודאון)
  categoryName: string;        // High Card/Pair/... או "Uncontested"
};

export type ActionLogItem = {
  ts: number;
  text: string;
};

/** תוספת: קופות צד מלאות (Side Pots) לשואודאון מרובה-אול-אין */
export type SidePot = {
  amount: number;
  /** מי זכאי להתחרות על הקופה הזו (מושבים שלא פרשו וששילמו לשכבה הזו) */
  eligibleSeats: number[];
};

export type RoomState = {
  code: string;
  stage: Stage;
  players: Player[];
  dealerSeat: number; // rotates
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  pot: number;
  community: Card[];
  turnSeat: number; // who acts
  deck: Card[];
  lastAggressorSeat: number | null;
  message?: string;

  // חדשים
  lastWinners?: WinnerInfo[];
  actionLog?: ActionLogItem[];

  /** תוספת: פירוט קופות צד (לביצוע חלוקה מדויקת בשואודאון) */
  pots?: SidePot[];
};

export type ClientRoomView = Omit<RoomState,'deck'> & {
  players: (Omit<Player,'hole'> & {
    holeCount?: number;
    publicHole?: Card[]; // קלפים שחשופים לציבור עבור שחקן זה
  })[];
  revealSeats?: number[]; // אילו מושבים רשאים לבחור Show/Muck כרגע
};
