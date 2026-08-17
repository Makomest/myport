-- Production schema for the Gladiator backend (Postgres).
-- The PgWallet adapter (src/persistence/pgWallet.ts) targets these tables; the
-- same shape backs the audit log, player limits and tournaments in prod.
-- Money is NUMERIC(18,2) here (use exact decimals in production; the dev adapter
-- uses double precision for pg-mem simplicity).

CREATE TABLE IF NOT EXISTS accounts (
  account  text PRIMARY KEY,
  balance  numeric(18, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ledger (
  id            bigserial PRIMARY KEY,
  account       text NOT NULL REFERENCES accounts(account),
  kind          text NOT NULL CHECK (kind IN ('debit', 'credit')),
  amount        numeric(18, 2) NOT NULL,
  ref           text,
  idem_key      text UNIQUE NOT NULL,          -- idempotency: at most once
  balance_after numeric(18, 2) NOT NULL,
  ts            bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account_idx ON ledger(account, id);

-- One immutable row per settled round (compliance + provably-fair re-check).
CREATE TABLE IF NOT EXISTS audit (
  round_id        text PRIMARY KEY,
  account         text NOT NULL,
  bet             numeric(18, 2) NOT NULL,
  server_seed_hash text NOT NULL,
  server_seed     text NOT NULL,
  client_seed     text NOT NULL,
  nonce           bigint NOT NULL,
  rounds          int NOT NULL,
  payout_mult     numeric(12, 4) NOT NULL,
  payout          numeric(18, 2) NOT NULL,
  busted          boolean NOT NULL,
  ts              bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_account_ts_idx ON audit(account, ts);

-- Player-set responsible-gaming limits (JSON of effective + pending).
CREATE TABLE IF NOT EXISTS player_limits (
  account text PRIMARY KEY,
  state   jsonb NOT NULL
);

-- Tournament definitions + persisted results.
CREATE TABLE IF NOT EXISTS tournaments (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  from_ts      bigint NOT NULL,
  to_ts        bigint NOT NULL,
  metric       text NOT NULL,
  prize_pool   numeric(18, 2) NOT NULL,
  payout_split jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS tournament_results (
  id          text PRIMARY KEY REFERENCES tournaments(id),
  resolved_at bigint NOT NULL,
  paid        numeric(18, 2) NOT NULL,
  standings   jsonb NOT NULL
);
