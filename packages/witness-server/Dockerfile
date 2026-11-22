# Node 20.19 or later: the witness require()s @openvtc/vti-tsp-js, an ES module (tsp-esm-preload.cjs).
FROM node:20
WORKDIR /usr/src/app

# Enable Corepack to use the correct Yarn version
RUN corepack enable

# The root manifests of the repository (the witness is one workspace of the one install at its root since Phase 2
# of docs/plans/single-codebase-plan.md), yarn's patches, and the framework's shared tsconfig under packages/.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/patches ./.yarn/patches
COPY packages/tsconfig-base.json ./packages/tsconfig-base.json

# Every workspace's package.json, and ONLY those, first: yarn refuses a project whose package.json names a
# workspace that is not on disk, and copying the manifests alone lets Docker cache the install layer separately
# from source code (the install re-runs when a manifest or yarn.lock changes, not on a source edit). The list is
# the root package.json's workspaces (app, packages/*): a new package needs a line here.
COPY app/package.json ./app/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/credo-tsp-adapter/package.json ./packages/credo-tsp-adapter/package.json
COPY packages/dtg-vocab/package.json ./packages/dtg-vocab/package.json
COPY packages/mediator-server/package.json ./packages/mediator-server/package.json
COPY packages/oca/package.json ./packages/oca/package.json
COPY packages/react-hooks/package.json ./packages/react-hooks/package.json
COPY packages/react-native-attestation/package.json ./packages/react-native-attestation/package.json
COPY packages/react-native-locality-peripheral/package.json ./packages/react-native-locality-peripheral/package.json
COPY packages/remote-logs/package.json ./packages/remote-logs/package.json
COPY packages/trust-tasks/package.json ./packages/trust-tasks/package.json
# trust-tasks installs @openvtc/vti-tsp-js from its vendored tarball (a file: dependency): needed at install time.
COPY packages/trust-tasks/vendor ./packages/trust-tasks/vendor
COPY packages/verifier/package.json ./packages/verifier/package.json
COPY packages/vrc-contexts/package.json ./packages/vrc-contexts/package.json
COPY packages/vrc-reference/package.json ./packages/vrc-reference/package.json
COPY packages/vrc-shared/package.json ./packages/vrc-shared/package.json
COPY packages/witness-server/package.json ./packages/witness-server/package.json

# Install the witness and what it depends on, nothing of the app's React Native tree (yarn's workspace-tools
# `focus`, built into Yarn 4). Cached unless a manifest or yarn.lock changes.
RUN yarn workspaces focus @bifold/witness-server

# Now copy full source for all workspace packages
COPY packages/vrc-contexts ./packages/vrc-contexts
COPY packages/vrc-shared ./packages/vrc-shared
COPY packages/trust-tasks ./packages/trust-tasks
COPY packages/credo-tsp-adapter ./packages/credo-tsp-adapter
COPY packages/witness-server ./packages/witness-server

# Build workspace packages in dependency order
RUN yarn workspace @bifold/vrc-contexts build && \
    yarn workspace @bifold/vrc-shared build && \
    yarn workspace @bifold/trust-tasks build && \
    yarn workspace @bifold/credo-tsp-adapter build && \
    yarn workspace @bifold/witness-server build:all

# Set working directory to witness-server
WORKDIR /usr/src/app/packages/witness-server

# Expose the port
EXPOSE 9003

# Start the witness server using compiled output
CMD ["yarn", "start:prod"]
