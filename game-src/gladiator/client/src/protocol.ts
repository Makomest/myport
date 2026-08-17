import type { FightEvent } from "gladiator-engine";

// Wire contract with the server's wsServer (mirrors its DTOs + a `type` tag).
export type { FightEvent };

export interface Opponent {
  name: string;
  id: number;
  power: number;
}

export interface OpenedMsg {
  type: "opened";
  roundId: string;
  serverSeedHash: string;
  nonce: number;
  opponent: Opponent;
  bet: number;
  balance: number;
  event: FightEvent;
  ended: boolean;
  serverSeed?: string;
  realityCheckDue: boolean;
  starsGained?: number;
}
export interface FightMsg {
  type: "fight";
  roundId: string;
  event: FightEvent;
  ended: boolean;
  serverSeed?: string;
  starsGained?: number;
}
export interface CashoutMsg {
  type: "cashout";
  roundId: string;
  payoutMult: number;
  payout: number;
  rounds: number;
  balance: number;
  serverSeed: string;
}
export interface ErrorMsg {
  type: "error";
  error: string;
  message?: string;
}
export interface TopUpMsg { type: "topup"; balance: number }
export interface ResumeSlot { tier: number; count: number }
export interface ResumedMsg {
  type: "resumed";
  roundId: string | null; // null = no in-progress round to restore
  serverSeedHash?: string;
  nonce?: number;
  bet?: number;
  opponent?: Opponent;
  multiplier?: number;
  roundIndex?: number;
  slots?: ResumeSlot[];
  balance?: number;
}

// --- meta (mirrors the server's MetaService DTOs) ---
export type LeaderboardKind = "biggestMultiplier" | "biggestPayout" | "longestRun";

export interface MatchSummary {
  roundId: string;
  account: string;
  bet: number;
  rounds: number;
  payoutMult: number;
  payout: number;
  busted: boolean;
  net: number;
  ts: number;
}
export interface LeaderboardEntry {
  account: string;
  value: number;
  roundId: string;
  ts: number;
}
export interface PlayerStats {
  account: string;
  rounds: number;
  staked: number;
  returned: number;
  net: number;
  winRate: number;
  biggestMultiplier: number;
  biggestPayout: number;
  longestRun: number;
}

export interface PlayerSetLimits {
  maxBet?: number;
  maxLossPerSession?: number;
  maxRoundsPerSession?: number;
}

export interface RgStatus {
  netLoss: number;
  rounds: number;
  maxBet: number;
  maxLossPerSession: number;
  maxRoundsPerSession: number;
  realityCheckDue: boolean;
  selfExcludedUntil: number | null;
  pendingLimits: { changes: PlayerSetLimits; effectiveAt: number } | null;
}

export interface SessionSummary {
  start: number;
  end: number;
  rounds: number;
  staked: number;
  returned: number;
  net: number;
  wins: number;
  busts: number;
  biggestMultiplier: number;
}
export interface SeasonStats {
  name?: string;
  from: number;
  to: number;
  rounds: number;
  players: number;
  staked: number;
  returned: number;
  houseNet: number;
}
export interface SeasonView {
  leaderboard: LeaderboardEntry[];
  stats: SeasonStats | null;
}

export interface HistoryMsg { type: "history"; items: MatchSummary[] }
export interface LeaderboardMsg { type: "leaderboard"; kind: LeaderboardKind; items: LeaderboardEntry[] }
export interface StatsMsg { type: "stats"; stats: PlayerStats | null }
export interface RgStatusMsg { type: "rg-status"; status: RgStatus }
export interface SessionsMsg { type: "sessions"; items: SessionSummary[] }
export interface SeasonMsg { type: "season"; leaderboard: LeaderboardEntry[]; stats: SeasonStats | null }

export type TournamentMetric = "biggestMultiplier" | "biggestPayout" | "longestRun" | "netWin" | "stars";
export interface Tournament {
  id: string;
  name: string;
  from: number;
  to: number;
  metric: TournamentMetric;
  prizePool: number;
  payoutSplit: number[];
}
export interface Standing {
  rank: number;
  account: string;
  score: number;
  prize: number;
}
export interface TournamentsMsg { type: "tournaments"; items: Tournament[] }
export interface StandingsMsg { type: "standings"; id: string; items: Standing[] }

export type ServerMsg =
  | OpenedMsg | FightMsg | CashoutMsg | ErrorMsg | ResumedMsg | TopUpMsg
  | HistoryMsg | LeaderboardMsg | StatsMsg | RgStatusMsg | SessionsMsg | SeasonMsg
  | TournamentsMsg | StandingsMsg;

export type ClientMsg =
  | { type: "open"; bet: number; clientSeed: string; idemKey: string; level?: number }
  | { type: "continue"; roundId?: string; level?: number }
  | { type: "cashout"; idemKey: string; roundId?: string }
  | { type: "resume" }
  | { type: "topup" }
  | { type: "history" }
  | { type: "leaderboard"; kind?: LeaderboardKind }
  | { type: "stats" }
  | { type: "rg-status" }
  | { type: "ack-reality" }
  | { type: "self-exclude"; ms: number }
  | { type: "set-limits"; limits: PlayerSetLimits }
  | { type: "sessions" }
  | { type: "season"; from?: number; to?: number; kind?: LeaderboardKind }
  | { type: "tournaments" }
  | { type: "standings"; id: string };
