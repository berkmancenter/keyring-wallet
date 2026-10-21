# Keyring short invitation links (deploy/keyring-links). No dependencies: Node's
# own http and crypto, and one file per link on a mounted volume.
FROM node:20.19-bookworm-slim

WORKDIR /srv/keyring-links
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src

# The link files; mount a volume here. Owned by `node` before the volume is
# declared, so a new named volume starts writable.
ENV LINKS_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
VOLUME ["/data"]

USER node
EXPOSE 3090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3090/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
