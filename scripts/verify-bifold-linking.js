#!/usr/bin/env node

/**
 * Verifies that bifold packages are properly linked and accessible.
 * This script consolidates all verification checks into one place.
 */

const fs = require('fs');
const path = require('path');

const BIFOLD_DIR = path.join(__dirname, '..', 'bifold');
const APP_DIR = path.join(__dirname, '..', 'app');
const BIFOLD_PACKAGES = ['core', 'oca', 'verifier', 'react-native-attestation', 'remote-logs'];

let errors = [];
let warnings = [];

function log(message, type = 'info') {
  const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅';
  console.log(`${prefix} ${message}`);
}

function checkSubmoduleInitialized() {
  // bifold/ is a directory of this repository since the fold (no submodule); its absence is a broken checkout.
  log('Checking that bifold/ is present...');
  if (!fs.existsSync(BIFOLD_DIR)) {
    errors.push('bifold/ directory missing: the checkout is incomplete');
    return false;
  }
  log('bifold/ is present', 'info');
  return true;
}

function checkBifoldPackagesBuilt() {
  log('Checking if bifold packages are built...');
  let allBuilt = true;

  for (const pkg of BIFOLD_PACKAGES) {
    const pkgDir = path.join(BIFOLD_DIR, 'packages', pkg);

    if (!fs.existsSync(pkgDir)) {
      errors.push(`Package ${pkg} directory not found`);
      allBuilt = false;
      continue;
    }

    // Check package.json main entry point (some packages use lib/, others use build/)
    const packageJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      errors.push(`Package ${pkg} package.json not found`);
      allBuilt = false;
      continue;
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const mainFile = packageJson.main;
      if (mainFile) {
        const mainPath = path.join(pkgDir, mainFile);
        if (!fs.existsSync(mainPath)) {
          errors.push(`Package ${pkg} main entry point missing: ${mainFile}`);
          allBuilt = false;
        } else {
          log(`Package ${pkg} built correctly (main: ${mainFile})`, 'info');
        }
      } else {
        warnings.push(`Package ${pkg} has no main field in package.json`);
      }
    } catch (error) {
      errors.push(`Could not read package.json for ${pkg}: ${error.message}`);
      allBuilt = false;
    }
  }

  return allBuilt;
}

function checkWorkspaceLinking() {
  log('Checking if workspaces are linked correctly...');
  const appNodeModules = path.join(APP_DIR, 'node_modules', '@bifold');

  if (!fs.existsSync(appNodeModules)) {
    errors.push('@bifold packages not found in app/node_modules');
    return false;
  }

  let allLinked = true;
  for (const pkg of BIFOLD_PACKAGES) {
    const pkgPath = path.join(appNodeModules, pkg);
    if (!fs.existsSync(pkgPath)) {
      errors.push(`@bifold/${pkg} not found in app/node_modules`);
      allLinked = false;
      continue;
    }

    // Check if it's a symlink (workspace) or directory
    const stats = fs.lstatSync(pkgPath);
    if (stats.isSymbolicLink()) {
      const target = fs.readlinkSync(pkgPath);
      log(`@bifold/${pkg} is linked to: ${target}`, 'info');
    } else if (stats.isDirectory()) {
      // Could be a workspace link (workspaces can create directories too)
      log(`@bifold/${pkg} exists as directory (workspace link)`, 'info');
    } else {
      warnings.push(`@bifold/${pkg} exists but is not a symlink or directory`);
    }
  }

  return allLinked;
}

function checkCriticalFileAccessible() {
  log('Checking if MessageStack.js is accessible...');
  const messageStackPath = path.join(
    BIFOLD_DIR,
    'packages',
    'core',
    'lib',
    'commonjs',
    'navigators',
    'MessageStack.js'
  );

  if (!fs.existsSync(messageStackPath)) {
    errors.push('MessageStack.js not found in bifold/packages/core/lib/commonjs/navigators/');
    return false;
  }

  const stats = fs.statSync(messageStackPath);
  if (stats.size === 0) {
    warnings.push('MessageStack.js exists but is empty');
  } else {
    log(`MessageStack.js is accessible (${stats.size} bytes)`, 'info');
  }

  // Also check if it's accessible through workspace link
  const workspacePath = path.join(
    APP_DIR,
    'node_modules',
    '@bifold',
    'core',
    'lib',
    'commonjs',
    'navigators',
    'MessageStack.js'
  );

  if (fs.existsSync(workspacePath)) {
    log('MessageStack.js is accessible through workspace link', 'info');
  } else {
    warnings.push('MessageStack.js not accessible through workspace link (may be fine if using direct import)');
  }

  return true;
}

function checkPackageResolution() {
  log('Checking if packages can be resolved...');
  try {
    // Try to resolve @bifold/core
    const resolve = require.resolve;
    const corePath = resolve('@bifold/core', { paths: [APP_DIR] });
    log(`@bifold/core resolves to: ${corePath}`, 'info');

    // Verify the resolved path exists
    if (fs.existsSync(corePath)) {
      log('Package resolution works correctly', 'info');
      return true;
    } else {
      errors.push('Package resolution returned non-existent path');
      return false;
    }
  } catch (error) {
    errors.push(`Package resolution failed: ${error.message}`);
    return false;
  }
}

function main() {
  console.log('🔍 Verifying bifold linking and accessibility...\n');

  checkSubmoduleInitialized();
  checkBifoldPackagesBuilt();
  checkWorkspaceLinking();
  checkCriticalFileAccessible();
  checkPackageResolution();

  console.log('\n--- Verification Summary ---');
  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${warnings.length}):`);
    warnings.forEach((warning) => console.log(`   - ${warning}`));
  }

  if (errors.length > 0) {
    console.log(`\n❌ Errors (${errors.length}):`);
    errors.forEach((error) => console.log(`   - ${error}`));
    console.log('\n❌ Verification failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All checks passed!');
    process.exit(0);
  }
}

main();

