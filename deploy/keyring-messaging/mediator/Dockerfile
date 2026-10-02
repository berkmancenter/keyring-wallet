# syntax=docker/dockerfile:1
#
# The DIDComm v2 mediator the push gateway receives its wake-ups through:
# Affinidi's messaging mediator (https://github.com/affinidi/affinidi-tdk-rs),
# the mediator the VTI stack runs. Built from source at a pinned commit because
# the newest published image (ghcr.io/affinidi/messaging-mediator) is far behind
# the release the gateway was tested against.
#
#   docker compose build mediator
#
# This mirrors upstream's own docker/mediator.Dockerfile at the pinned commit
# (same toolchain, same cargo features, same runtime base), with four changes:
#   - it fetches the source itself, so the build context is this folder;
#   - it also builds account-tool/ (mediator-account), which registers the
#     gateway's account on the closed mediator, as a member of the same
#     workspace so it shares the pinned dependencies;
#   - curl is installed, for the container healthcheck;
#   - the runtime user has a fixed uid (10002), so secrets can be owned by it.
#
# MEDIATOR_COMMIT must be a full SHA; the build asserts it landed on it.

# Upstream's rust-toolchain.toml pins 1.95.0 at this commit.
ARG RUST_IMAGE=rust:1.95.0-slim-bookworm@sha256:d7482085ff5b415f84dba5647ae71606650bdef00db7aeb69f4b3d170c3e4082
ARG RUNTIME_IMAGE=debian:bookworm-20260918-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

FROM ${RUST_IMAGE} AS builder

ARG MEDIATOR_REPO=https://github.com/affinidi/affinidi-tdk-rs.git
# affinidi-messaging-mediator v0.33.1, the release the VTI lab runs.
ARG MEDIATOR_COMMIT=555806151b30a4ba2085a29384c8e048307e0083

# As upstream: build-essential for jemalloc and openssl-sys, pkg-config and
# libdbus for the keyring secret store the TDK layer pulls in, libssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config libdbus-1-dev libssl-dev git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git init -q . \
 && git remote add origin "${MEDIATOR_REPO}" \
 && git fetch -q --depth 1 origin "${MEDIATOR_COMMIT}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${MEDIATOR_COMMIT}"

# The same features as upstream's published image: DIDComm, Redis and jemalloc
# come from the defaults; tsp adds the Trust Spanning Protocol, which the
# gateway serves on the same connection.
RUN cargo build --release --locked -p affinidi-messaging-mediator --features tsp,secrets-aws
RUN cargo build --release --locked -p affinidi-messaging-mediator-setup \
      --no-default-features --features secrets-aws,publish-aws

# Keyring's account tool, added to the workspace's member list. Not --locked:
# the lock file gains this one package; every dependency it shares with the
# mediator crates resolves to the version already pinned there.
COPY account-tool/ /src/keyring/mediator-account/
RUN sed -i 's|^members = \[|members = [\n  "keyring/mediator-account",|' Cargo.toml \
 && cargo build --release -p keyring-mediator-account

FROM ${RUNTIME_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/affinidi/affinidi-tdk-rs" \
      org.opencontainers.image.title="keyring-messaging mediator" \
      org.opencontainers.image.licenses="Apache-2.0"
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The template assets (atm-functions.lua and friends). Our mediator.toml is
# mounted at run time; it points at /app/conf/atm-functions.lua.
COPY --from=builder /src/crates/messaging/affinidi-messaging-mediator/conf conf
COPY --from=builder /src/target/release/mediator /usr/local/bin/
COPY --from=builder /src/target/release/mediator-setup /usr/local/bin/
COPY --from=builder /src/target/release/mediator-account /usr/local/bin/
RUN groupadd -r -g 10002 mediator && useradd -r -u 10002 -g mediator mediator
USER 10002:10002
EXPOSE 7037
ENTRYPOINT ["/usr/local/bin/mediator"]
