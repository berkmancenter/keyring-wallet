# Node 20.19 or later: the witness require()s @openvtc/vti-tsp-js, an ES module (tsp-esm-preload.cjs).
FROM node:20
WORKDIR /usr/src/app

# Enable Corepack to use the correct Yarn version
RUN corepack enable

# Copy root package files from bifold level
COPY package.json yarn.lock .yarnrc.yml tsconfig-base.json ./
COPY .yarn ./.yarn

# Copy noop directory (required for file: dependencies)
COPY noop ./noop

# Copy ONLY package.json files from workspace packages first.
# This allows Docker to cache the yarn install layer separately from source code —
# yarn install only re-runs when package.json or yarn.lock changes, not on source edits.
COPY packages/vrc-contexts/package.json ./packages/vrc-contexts/package.json
COPY packages/vrc-shared/package.json ./packages/vrc-shared/package.json
# trust-tasks and credo-tsp-adapter are witness dependencies too (its TSP and Trust Task paths); trust-tasks installs
# @openvtc/vti-tsp-js from its vendored tarball (a file: dependency), so the tarball is needed at install time.
COPY packages/trust-tasks/package.json ./packages/trust-tasks/package.json
COPY packages/trust-tasks/vendor ./packages/trust-tasks/vendor
COPY packages/credo-tsp-adapter/package.json ./packages/credo-tsp-adapter/package.json
COPY packages/witness-server/package.json ./packages/witness-server/package.json

# Install dependencies — this layer is cached unless package.json or yarn.lock changes
RUN yarn install

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
