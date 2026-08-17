import type { FightEvent } from "gladiator-engine";

export interface OpponentDto {
  name: string;
  id: number;
  power: number;
}

export interface OpenRoundResult {
  roundId: string;
  serverSeedHash: string;
  nonce: number;
  opponent: OpponentDto;
  bet: number;
  balance: number;
  event: FightEvent;
  ended: boolean; // true if the entry fight already busted
  serverSeed?: string; // revealed only once the round has ended
  realityCheckDue: boolean;
  starsGained?: number; // stars awarded this fight (1 or 2, level-boosted; 0 if not a star)
}

export interface FightResult {
  roundId: string;
  event: FightEvent;
  ended: boolean;
  serverSeed?: string;
  starsGained?: number;
}

export interface CashOutDto {
  roundId: string;
  payoutMult: number;
  payout: number;
  rounds: number;
  balance: number;
  serverSeed: string;
}
