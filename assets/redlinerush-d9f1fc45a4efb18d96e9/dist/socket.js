// Transport abstraction so GameClient is independent of the runtime: a browser
// uses the global WebSocket; the Node e2e test wraps the `ws` package.
/** Browser adapter over the global WebSocket (also works on Node 22+). */
export function browserSocket(url) {
    const ws = new WebSocket(url);
    return {
        send: (d) => ws.send(d),
        close: () => ws.close(),
        onMessage: (cb) => ws.addEventListener("message", (e) => cb(String(e.data))),
        onOpen: (cb) => ws.addEventListener("open", () => cb()),
        onClose: (cb) => ws.addEventListener("close", () => cb()),
    };
}
/**
 * Auto-reconnecting WebSocket: on an unexpected close it retries with capped
 * exponential backoff, rebinding handlers to each new socket. `onOpen` fires on
 * every (re)connect — the GameClient uses that to re-`resume` the live round.
 */
export function reconnectingSocket(url) {
    let ws;
    let closedByUs = false;
    let attempt = 0;
    const msgCbs = [];
    const openCbs = [];
    const closeCbs = [];
    function connect() {
        ws = new WebSocket(url);
        ws.addEventListener("message", (e) => { const d = String(e.data); for (const cb of msgCbs)
            cb(d); });
        ws.addEventListener("open", () => { attempt = 0; for (const cb of openCbs)
            cb(); });
        ws.addEventListener("close", () => {
            for (const cb of closeCbs)
                cb();
            if (!closedByUs) {
                attempt += 1;
                const delay = Math.min(8000, 400 * 2 ** (attempt - 1)); // 0.4s,0.8s,1.6s … cap 8s
                setTimeout(connect, delay);
            }
        });
    }
    connect();
    return {
        send: (d) => { try {
            if (ws.readyState === WebSocket.OPEN)
                ws.send(d);
        }
        catch { /* dropped while offline; resume reconciles */ } },
        close: () => { closedByUs = true; ws.close(); },
        onMessage: (cb) => { msgCbs.push(cb); },
        onOpen: (cb) => { openCbs.push(cb); },
        onClose: (cb) => { closeCbs.push(cb); },
    };
}
//# sourceMappingURL=socket.js.map