# Gladiator — one image that builds engine -> server -> client and runs the
# WS game server (8790) + the web client static server (3000) in one process.
FROM node:20-slim
WORKDIR /app

# sources (file: deps need engine/ server/ client/ kept as siblings)
COPY engine ./engine
COPY server ./server
COPY client ./client

# build in dependency order: engine first (server + client link to it via file:)
RUN cd engine && npm install --no-audit --no-fund && npm run build
RUN cd server && npm install --no-audit --no-fund && npm run build
RUN cd client && npm install --no-audit --no-fund && npm run build

EXPOSE 8790 3000
CMD ["node", "server/serve.mjs"]
