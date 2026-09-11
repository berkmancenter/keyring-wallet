#!/usr/bin/env node

/**
 * Ensures bifold submodule is initialized and built before yarn install.
 * This script runs as part of the preinstall lifecycle hook.
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

function ensureSubmoduleInitialized() {
  if (!fs.existsSync(BIFOLD_DIR)) {
    log('Bifold directory not found. Initializing submodule...');
    exec('git submodule update --init --recursive', {
      ignoreErrors: false,
    });
    log('Submodule initialized successfully');
  } else {
    log('Bifold directory exists, skipping submodule initialization');
  }
}

function buildBifoldPackages() {
  if (!fs.existsSync(BIFOLD_PACKAGES_DIR)) {
    log('WARNING: bifold/packages directory not found. Skipping build.');
    return;
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

function configureBifoldHooks() {
  // bifold has its own git directory (it's a submodule), so core.hooksPath
  // must be set here rather than inherited from the parent repo. .githooks
  // enforces DCO sign-off and signed commits — see bifold/CONTRIBUTING.
  exec('git config core.hooksPath .githooks', {
    cwd: BIFOLD_DIR,
    ignoreErrors: true,
  });
}

function main() {
  try {
    log('Starting bifold preparation...');
    ensureSubmoduleInitialized();
    configureBifoldHooks();
    buildBifoldPackages();
    log('Bifold preparation complete');
  } catch (error) {
    console.error('[ensure-bifold-ready] Error:', error.message);
    process.exit(1);
  }
}

main();

