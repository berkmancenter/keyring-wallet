# Keyring over-the-air update server (deploy/keyring-ota). Node 20 on Debian
# slim: better-sqlite3 installs its prebuilt Linux binary, so no compiler.
FROM node:20.19-bookworm-slim

WORKDIR /srv/keyring-ota
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Dev dependencies stay: the hot-updater CLI creates and migrates the schema at start.
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# The SQLite database and the stored bundles; mount a volume here.
ENV OTA_DATA_DIR=/data
# Owned by `node` before the volume is declared, so a new named volume starts writable.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3080
# Create or migrate the schema, then serve. The migration is idempotent.
CMD ["sh", "-c", "npx hot-updater db migrate src/hotUpdater.mjs --yes && exec node src/server.mjs"]
