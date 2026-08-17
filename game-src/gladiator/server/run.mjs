// Dev launcher for the WebSocket game server (for the browser client).
import { startWsServer } from "./dist/wsServer.js";
import { InMemoryWallet } from "./dist/wallet.js";
import { ResponsibleGaming } from "./dist/responsible.js";
import { GameService } from "./dist/gameService.js";
import { SeedManager } from "./dist/seeds.js";
import { InMemoryAudit } from "./dist/audit.js";
import { MetaService } from "./dist/meta.js";
import { SeasonsService } from "./dist/seasons.js";
import { TournamentService, InMemoryTournamentStore } from "./dist/tournaments.js";
import { TournamentScheduler, InMemoryNotifications } from "./dist/scheduler.js";

const wallet = new InMemoryWallet();
wallet.fund("web", 1000); // demo account the browser view connects as

const audit = new InMemoryAudit();
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager(), undefined, audit);

// a live demo tournament + auto-resolution on a timer
const tStore = new InMemoryTournamentStore();
const now = Date.now();
tStore.add({ id: "daily", name: "Daily Arena", from: now - 3_600_000, to: now + 24 * 3_600_000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [0.5, 0.3, 0.2] });
const tournaments = new TournamentService(audit, wallet, tStore);
const scheduler = new TournamentScheduler(tournaments, tStore, new InMemoryNotifications());
setInterval(() => scheduler.tick(), 60_000).unref();

const port = Number(process.env.PORT) || 8790;
startWsServer({
  port,
  service: svc,
  account: "web",
  meta: new MetaService(audit),
  seasons: new SeasonsService(audit),
  tournaments,
});

console.log(`Gladiator WS server -> ws://localhost:${port}  (demo "web" funded $1000, tournament "daily" live)`);
