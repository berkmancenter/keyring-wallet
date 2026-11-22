#!/usr/bin/env node

/**
 * Installs and builds the bifold packages (bifold/) before the root yarn install.
 * This script runs as part of the preinstall lifecycle hook.
 *
 * bifold/ is part of this repository (it was a git submodule until the fold; its
 * history is on the history/bifold ref). It still has its own yarn install and
 * build here, so the root's `portal:` resolutions keep resolving to built
 * packages; one dependency tree is the next step of docs/plans/single-codebase-plan.md.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BIFOLD_DIR = path.join(__dirname, '..', 'bifold');
const BIFOLD_PACKAGES_DIR = path.join(BIFOLD_DIR, 'packages');

function log(message) {
  console.log(`[ensure-bifold-ready] ${message}`);
}

function exec(command, options = {}) {
  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: options.cwd || process.cwd(),
      ...options,
    });
    return true;
  } catch (error) {
    if (options.ignoreErrors) {
      return false;
    }
    throw error;
  }
}

function buildBifoldPackages() {
  if (!fs.existsSync(BIFOLD_PACKAGES_DIR)) {
    // Not a submodule any more: an absent bifold/packages is a broken checkout, not an uninitialised one.
    log('ERROR: bifold/packages not found; this checkout is incomplete');
    process.exit(1);
  }

  const bifoldNodeModules = path.join(BIFOLD_DIR, 'node_modules');
  const bifoldYarnLock = path.join(BIFOLD_DIR, 'yarn.lock');

  // Check if dependencies are already installed
  const needsInstall = !fs.existsSync(bifoldNodeModules) || !fs.existsSync(bifoldYarnLock);

  if (needsInstall) {
    log('Installing bifold dependencies...');
    // Don't use --immutable for bifold, as it may have lockfile updates
    const installSuccess = exec('yarn install', {
      cwd: BIFOLD_DIR,
      ignoreErrors: true,
    });

    if (!installSuccess) {
      log('WARNING: bifold yarn install failed, but continuing...');
      log('This may be due to existing node_modules. Attempting build anyway...');
    }
  } else {
    log('Bifold dependencies already installed, skipping install step');
  }

  log('Building bifold packages...');
  // Try to build, but don't fail if some packages fail (they might already be built)
  const buildSuccess = exec('yarn build', {
    cwd: BIFOLD_DIR,
    ignoreErrors: true,
  });

  if (!buildSuccess) {
    log('WARNING: Some bifold packages may have failed to build');
    log('Checking if critical packages are built...');

    // Check if at least core is built (most critical)
    const coreLibPath = path.join(BIFOLD_DIR, 'packages', 'core', 'lib');
    const coreBuildPath = path.join(BIFOLD_DIR, 'packages', 'core', 'build');
    const coreBuilt = fs.existsSync(coreLibPath) || fs.existsSync(coreBuildPath);

    if (!coreBuilt) {
      log('ERROR: @bifold/core is not built, which is required');
      process.exit(1);
    } else {
      log('Critical packages appear to be built, continuing...');
    }
  } else {
    log('Bifold packages built successfully');
  }
}

function main() {
  try {
    log('Starting bifold preparation...');
    // No submodule init and no core.hooksPath for bifold/: it shares this repository and the root .husky hooks.
    buildBifoldPackages();
    log('Bifold preparation complete');
  } catch (error) {
    console.error('[ensure-bifold-ready] Error:', error.message);
    process.exit(1);
  }
}

main();
