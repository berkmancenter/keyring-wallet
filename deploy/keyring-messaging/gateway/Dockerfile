# syntax=docker/dockerfile:1
#
# vti-push-gateway (https://github.com/OpenVTC/vti-push-gateway), built from
# source at a pinned commit: upstream publishes no image and no Dockerfile.
#
#   docker compose build gateway                      # the pinned commit
#   docker compose build --build-arg GATEWAY_COMMIT=<full 40-char sha> gateway
#
# GATEWAY_COMMIT must be a full SHA: GitHub serves `git fetch <sha>` only for
# full object names, and the build asserts it landed on exactly that commit.

# Builder and runtime share one Debian release so the dynamically linked
# libdbus/glibc match. Digests read from Docker Hub on 2026-09-26.
ARG RUST_IMAGE=rust:1.98.1-bookworm@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e
ARG RUNTIME_IMAGE=debian:bookworm-20260918-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

FROM ${RUST_IMAGE} AS builder

ARG GATEWAY_REPO=https://github.com/OpenVTC/vti-push-gateway.git
ARG GATEWAY_COMMIT=e542a9d77a7369f4f3da01d573107ea155c80691

# libdbus-1-dev + pkg-config: upstream CI installs them (libdbus-sys, pulled in
# by the keyring crates in the dependency tree). cmake + clang: build fallbacks
# for aws-lc-sys; harmless if unused.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libdbus-1-dev pkg-config cmake clang git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git init -q . \
 && git remote add origin "${GATEWAY_REPO}" \
 && git fetch -q --depth 1 origin "${GATEWAY_COMMIT}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${GATEWAY_COMMIT}"

# Keyring's patches on top of the pinned commit (patches/README.md), each a
# clean format-patch; the build fails if one no longer applies.
COPY patches/ /patches/
RUN for p in /patches/*.patch; do [ -e "$p" ] || continue; git apply --index "$p"; done

# --locked: build exactly the upstream Cargo.lock.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo build --release --locked \
 && install -m 0755 target/release/vti-push-gateway /vti-push-gateway \
 && strip /vti-push-gateway

FROM ${RUNTIME_IMAGE}

ARG GATEWAY_COMMIT=e542a9d77a7369f4f3da01d573107ea155c80691
LABEL org.opencontainers.image.title="vti-push-gateway" \
      org.opencontainers.image.source="https://github.com/OpenVTC/vti-push-gateway" \
      org.opencontainers.image.revision="${GATEWAY_COMMIT}" \
      org.opencontainers.image.licenses="Apache-2.0"

# ca-certificates: reqwest's rustls uses the platform verifier (system roots)
# for APNs / FCM / Web Push / did:webvh. libdbus-1-3: runtime half of
# libdbus-dev. curl: the compose healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libdbus-1-3 curl \
 && rm -rf /var/lib/apt/lists/*

# Fixed uid/gid so the host can chown ./data/gateway and ./secrets to match
# (GATEWAY_STRICT_KEY_PERMS=1 refuses secret files readable beyond the owner).
RUN groupadd --system --gid 10001 gateway \
 && useradd --system --uid 10001 --gid 10001 --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin gateway \
 && install -d -o 10001 -g 10001 -m 0700 /data

COPY --from=builder /vti-push-gateway /usr/local/bin/vti-push-gateway
COPY --chmod=0755 entrypoint.sh /usr/local/bin/gateway-entrypoint

USER 10001:10001
WORKDIR /data
ENV GATEWAY_BIND=0.0.0.0:8300
EXPOSE 8300

ENTRYPOINT ["/usr/local/bin/gateway-entrypoint"]
CMD ["vti-push-gateway"]
