import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AuthProvider } from "./auth.js";
import type { FraudService } from "./fraud.js";
import type { TournamentService } from "./tournaments.js";
import type { OpsEvent } from "./scheduler.js";

// Operator-only channel, SEPARATE from the player WS. Requires operator auth
// (e.g. JwtAuth with requiredRole "operator"); a non-operator is closed with
// 4403. Exposes risk/anti-fraud reads and tournament resolution (money-moving),
// none of which is ever reachable from the player socket.

interface OpsMsg {
  type: "risk-scan" | "risk-account" | "tournament-list" | "tournament-resolve" | "notifications";
  account?: string;
  id?: string;
}

export function startOpsServer(opts: {
  port: number;
  auth: AuthProvider;
  fraud: FraudService;
  tournaments?: TournamentService;
  notifications?: { recent(limit?: number): OpsEvent[] };
}): WebSocketServer {
  const wss = new WebSocketServer({ port: opts.port });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const operator = opts.auth.resolve(url.searchParams.get("token"));
    if (!operator) {
      ws.close(4403, "forbidden"); // not an operator
      return;
    }
    const send = (o: unknown) => ws.send(JSON.stringify(o));

    ws.on("message", (data) => {
      let msg: OpsMsg;
      try {
        msg = JSON.parse(String(data)) as OpsMsg;
      } catch {
        return send({ type: "error", error: "bad json" });
      }
      try {
        switch (msg.type) {
          case "risk-scan":
            return send({ type: "risk", signals: opts.fraud.scanAll() });
          case "risk-account":
            return send({ type: "risk", account: msg.account ?? "", signals: msg.account ? opts.fraud.scanAccount(msg.account) : [] });
          case "tournament-list":
            return send({ type: "tournaments", items: opts.tournaments ? opts.tournaments.list() : [] });
          case "tournament-resolve":
            if (!opts.tournaments || !msg.id) return send({ type: "error", error: "no tournament" });
            return send({ type: "tournament-result", by: operator, result: opts.tournaments.resolve(msg.id) });
          case "notifications":
            return send({ type: "notifications", items: opts.notifications ? opts.notifications.recent() : [] });
          default:
            return send({ type: "error", error: "unknown ops message" });
        }
      } catch (e) {
        send({ type: "error", error: (e as Error).name, message: (e as Error).message });
      }
    });
  });

  return wss;
}
