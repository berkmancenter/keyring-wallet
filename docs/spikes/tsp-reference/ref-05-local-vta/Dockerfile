# Local-dev VTA image — build once, run the whole stack with `docker compose up`.
#
# Not a production image: it uses the plaintext seed backend and a debug build.
# The point is a repeatable, disposable VTA for integration testing (and the
# missing piece the upstream `sysop/local-dev.md` stub says is "to be
# documented"). Production images should use `config_seed` or a cloud/Vault
# secrets backend, `--release`, and the `[hardened]` block.
#
#   docker build -f Dockerfile -t vti-local-vta ../../../../external/verifiable-trust-infrastructure
#
# The build context is the VTI workspace root.

FROM rust:1.97-slim-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

# `setup` implies `webvh`, which is what lets the VTA host and serve its own
# did:webvh — that is what removes the separate DID-hosting service from a
# local stack. `tsp` is additive and OFF upstream by default; we want it on.
RUN cargo build --release --package vta-service --features tsp,setup \
    && cargo build --release --package pnm-cli

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/vta /usr/local/bin/vta
COPY --from=build /src/target/release/pnm /usr/local/bin/pnm
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 8100 = VTA REST + the self-hosted did:webvh document
EXPOSE 8100
VOLUME ["/data"]

HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
    CMD curl -sf http://localhost:8100/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
