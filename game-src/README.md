# game-src

Source for the playable demos, kept here so the server can build them from the
same repo it already pulls. Not part of the landing page — Caddy blocks
`/game-src/*` so nothing in here is reachable over the web.

## gladiator

Builds one image that runs the WS game server (8790) and the web client (3000)
in a single process, backed by Postgres and Redis.

On the server:

    cd /var/www/myport/game-src/gladiator
    docker build -t gladiator .
    echo "GLAD_DB_PASS=$(openssl rand -hex 16)" > .env
    docker compose -f docker-compose.server.yml up -d

`.env` holds the Postgres password and stays out of git.
Caddy proxies `play.ronigames.org` to both ports.
