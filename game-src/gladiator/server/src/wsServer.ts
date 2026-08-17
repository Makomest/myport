import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { GameService } from "./gameService.js";
import { InMemoryWallet } from "./wallet.js";
import { ResponsibleGaming } from "./responsible.js";
import type { AuthProvider } from "./auth.js";
import type { MetaService, LeaderboardKind } from "./meta.js";
import type { SeasonsService } from "./seasons.js";
import type { PlayerSetLimits } from "./responsible.js";
import type { TournamentService } from "./tournaments.js";
import { validateFrame } from "./security/validate.js";
import { TokenBucket, ConnectionLimiter } from "./security/rateLimit.js";

interface ClientMsg {
  type:
    | "open" | "continue" | "cashout" | "resume" | "topup"
    | "history" | "leaderboard" | "stats"
    | "rg-status" | "ack-reality" | "self-exclude" | "set-limits"
    | "sessions" | "season"
    | "tournaments" | "standings";
  bet?: number;
  clientSeed?: string;
  idemKey?: string;
  roundId?: string;
  kind?: LeaderboardKind;
  ms?: number;
  from?: number;
  to?: number;
  limits?: PlayerSetLimits;
  id?: string;
  level?: number;
}

/**
 * Thin WebSocket adapter over GameService. One connection ≈ one player session;
 * the account would come from a validated auth token in production (here: query
 * param). All game logic stays in GameService — this layer only marshals JSON.
 */
export function startWsServer(opts: {
  port?: number;
  server?: import("node:http").Server | import("node:https").Server; // attach for WSS/shared-port
  service?: GameService;
  account?: string;
  auth?: AuthProvider;
  meta?: MetaService;
  seasons?: SeasonsService;
  tournaments?: TournamentService;
  maxPayload?: number;
  /** demo-only top-up; absent in production (operator owns deposits). Returns the new balance. */
  demoTopUp?: (account: string) => Promise<number>;
}): WebSocketServer {
  const service =
    opts.service ?? new GameService(new InMemoryWallet(), new ResponsibleGaming());
  const maxPayload = opts.maxPayload ?? 16 * 1024; // tiny game frames; reject oversized
  const wss = opts.server
    ? new WebSocketServer({ server: opts.server, maxPayload })
    : new WebSocketServer({ port: opts.port, maxPayload });
  const connLimiter = new ConnectionLimiter();

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0].trim()) || req.socket.remoteAddress || "?";
    if (!connLimiter.allow(ip)) { ws.close(4429, "too many connections"); return; }

    const url = new URL(req.url ?? "/", "http://localhost");
    let account: string;
    if (opts.auth) {
      const resolved = opts.auth.resolve(url.searchParams.get("token"));
      if (!resolved) {
        ws.close(4401, "unauthorized"); // reject before any game/money action
        return;
      }
      account = resolved;
    } else {
      account = (url.searchParams.get("account") ?? opts.account ?? "guest").slice(0, 64);
    }
    let current: string | undefined;
    const send = (o: unknown) => ws.send(JSON.stringify(o));
    const bucket = new TokenBucket();
    let strikes = 0;
    const strike = () => { if (++strikes >= 12) ws.close(4429, "rate limit"); };

    ws.on("message", async (data) => {
      if (!bucket.take()) { strike(); return send({ type: "error", error: "rate limited" }); }
      const v = validateFrame(typeof data === "string" ? data : data.toString());
      if (!v.ok) { strike(); return send({ type: "error", error: v.error }); }
      const msg = v.msg as ClientMsg;
      try {
        switch (msg.type) {
          case "open": {
            const r = await service.openRound(account, msg.bet ?? 0, msg.clientSeed ?? "", msg.idemKey ?? crypto.randomUUID());
            current = r.ended ? undefined : r.roundId;
            return send({ type: "opened", ...r });
          }
          case "continue": {
            const r = await service.continueRound(msg.roundId ?? current ?? "", account);
            if (r.ended) current = undefined;
            return send({ type: "fight", ...r });
          }
          case "cashout": {
            const r = await service.cashOut(msg.roundId ?? current ?? "", msg.idemKey ?? crypto.randomUUID(), account);
            current = undefined;
            return send({ type: "cashout", ...r });
          }
          case "topup": {
            if (!opts.demoTopUp) return send({ type: "error", error: "deposit-required", message: "Add funds at the cashier to keep playing." });
            return send({ type: "topup", balance: await opts.demoTopUp(account) });
          }
          case "resume": {
            // restore the player's in-progress round after a reconnect/reload;
            // even with no live round, return the balance so the HUD is correct before START
            const snap = await service.resume(account);
            current = snap?.roundId; // re-bind this socket to the live round
            return send(snap
              ? { type: "resumed", ...snap }
              : { type: "resumed", roundId: null, balance: await service.balance(account) });
          }
          case "history":
            return send({ type: "history", items: opts.meta ? opts.meta.history(account) : [] });
          case "leaderboard":
            return send({
              type: "leaderboard",
              kind: msg.kind ?? "biggestMultiplier",
              items: opts.meta ? opts.meta.leaderboard(msg.kind) : [],
            });
          case "stats":
            return send({ type: "stats", stats: opts.meta ? opts.meta.playerStats(account) : null });
          case "rg-status":
            return send({ type: "rg-status", status: service.rgStatus(account) });
          case "ack-reality":
            return send({ type: "rg-status", status: service.acknowledgeRealityCheck(account) });
          case "self-exclude":
            return send({ type: "rg-status", status: service.selfExclude(account, msg.ms ?? 0) });
          case "set-limits":
            return send({ type: "rg-status", status: service.setLimits(account, msg.limits ?? {}) });
          case "sessions":
            return send({ type: "sessions", items: opts.seasons ? opts.seasons.sessions(account) : [] });
          case "season": {
            const w = { from: msg.from ?? 0, to: msg.to ?? Date.now() + 1 };
            return send(
              opts.seasons
                ? { type: "season", leaderboard: opts.seasons.seasonLeaderboard(w, msg.kind), stats: opts.seasons.seasonStats(w) }
                : { type: "season", leaderboard: [], stats: null },
            );
          }
          case "tournaments":
            return send({ type: "tournaments", items: opts.tournaments ? opts.tournaments.list() : [] });
          case "standings":
            return send({
              type: "standings",
              id: msg.id ?? "",
              items: opts.tournaments && msg.id ? opts.tournaments.standings(msg.id) : [],
            });
          default:
            return send({ type: "error", error: "unknown message type" });
        }
      } catch (e) {
        send({ type: "error", error: (e as Error).name, message: (e as Error).message });
      }
    });
  });

  return wss;
}
