# syntax=docker/dockerfile:1
#
# The phones' wallet mailbox: Affinidi's messaging mediator
# (https://github.com/affinidi/affinidi-messaging-mediator), built from source
# at a pinned commit. A separate image from ../mediator/Dockerfile, which is
# the push gateway's closed mediator (an older release, in the older
# affinidi-tdk-rs repository) and does not change.
#
#   docker compose build mediator     # from this folder; needs ~4 GB RAM
#
# This mirrors upstream's docker/mediator.Dockerfile at the pinned commit
# (same toolchain, same builder base, same runtime contract), with these
# changes:
#   - it fetches the source itself, so the build context is this folder, and
#     asserts the checkout landed on MEDIATOR_COMMIT (a full 40-char SHA);
#   - the cargo features are a build argument (MEDIATOR_FEATURES), defaulting
#     to upstream's defaults plus secrets-gcp, so the mailbox reads its keys
#     from GCP Secret Manager (gcp_secrets://);
#   - mediator-setup is built with secrets-gcp only (no AWS, no VTA): the
#     mailbox's identity is a self-hosted did:webvh made by setup-identity.sh;
#   - no cargo-chef layer: this image is built rarely, in CI or on a large
#     machine, never on the 2 GB VM;
#   - no conf/ is baked in: mailbox.toml is mounted at run time.

# Upstream's rust-toolchain.toml pins 1.95.0 at this commit; the digest is the
# one upstream's own Dockerfile pins at v0.53.0.
ARG RUST_IMAGE=rust:1.95.0-slim-bookworm@sha256:d7482085ff5b415f84dba5647ae71606650bdef00db7aeb69f4b3d170c3e4082
# The runtime base the gateway's mediator image already uses.
ARG RUNTIME_IMAGE=debian:bookworm-20260918-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

FROM ${RUST_IMAGE} AS builder

ARG MEDIATOR_REPO=https://github.com/affinidi/affinidi-messaging-mediator.git
# affinidi-messaging-mediator v0.53.0.
ARG MEDIATOR_COMMIT=f6ed8159a761344a96b5256e09c10e36cd2359d7
# Features of the mediator crate: upstream's defaults (didcomm, tsp,
# redis-backend, jemalloc, vta) plus secrets-gcp. Comma-separated, no spaces.
ARG MEDIATOR_FEATURES=didcomm,tsp,redis-backend,jemalloc,vta,secrets-gcp
# Features of mediator-setup: only the GCP backend (file:// is always built in).
ARG SETUP_FEATURES=secrets-gcp

# As upstream: build-essential for jemalloc and openssl-sys, pkg-config and
# libdbus for the keyring secret store the TDK layer pulls in, libssl; git and
# ca-certificates to fetch the source.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config libdbus-1-dev libssl-dev git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN case "${MEDIATOR_COMMIT}" in \
      *[!0-9a-f]*|"") echo "MEDIATOR_COMMIT must be a full lower-case SHA" >&2; exit 1 ;; \
    esac \
 && test "${#MEDIATOR_COMMIT}" -eq 40 \
 && git init -q . \
 && git remote add origin "${MEDIATOR_REPO}" \
 && git fetch -q --depth 1 origin "${MEDIATOR_COMMIT}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${MEDIATOR_COMMIT}"

# Both binaries in one --locked invocation, as upstream does: the dependency
# graph is compiled once and resolves to exactly upstream's Cargo.lock.
# --no-default-features applies to both packages, so every feature is named
# per package.
RUN feats="$(printf '%s' "${MEDIATOR_FEATURES}" | tr ',' '\n' | sed '/^$/d; s#^#affinidi-messaging-mediator/#' | paste -sd, -)" \
 && setup="$(printf '%s' "${SETUP_FEATURES}" | tr ',' '\n' | sed '/^$/d; s#^#affinidi-messaging-mediator-setup/#' | paste -sd, -)" \
 && cargo build --release --locked \
      -p affinidi-messaging-mediator -p affinidi-messaging-mediator-setup \
      --no-default-features --features "${feats}${setup:+,${setup}}"

FROM ${RUNTIME_IMAGE}
ARG MEDIATOR_COMMIT=f6ed8159a761344a96b5256e09c10e36cd2359d7
LABEL org.opencontainers.image.source="https://github.com/affinidi/affinidi-messaging-mediator" \
      org.opencontainers.image.title="keyring-messaging mailbox mediator" \
      org.opencontainers.image.revision="${MEDIATOR_COMMIT}" \
      org.opencontainers.image.licenses="Apache-2.0"
# ca-certificates: TLS to Secret Manager, DID hosts and other mediators. No
# curl: the healthcheck is the binary's own `mediator healthcheck`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Upstream's fixed, numeric runtime identity (10001:10001).
RUN groupadd --system --gid 10001 mediator \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mediator
WORKDIR /app
COPY --from=builder /src/target/release/mediator /usr/local/bin/
COPY --from=builder /src/target/release/mediator-setup /usr/local/bin/
USER 10001:10001
EXPOSE 7037
ENTRYPOINT ["/usr/local/bin/mediator"]
