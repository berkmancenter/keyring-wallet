#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, CommonJS like its siblings */

/**
 * Verifies the one-tree install the builds start from (docs/plans/single-codebase-plan.md, Phase 2): every
 * @bifold/* workspace the app depends on is linked into app/node_modules as a symlink to its folder under packages/,
 * each one's entry file exists (src/index.ts for the packages Metro bundles from source, the build output for the
 * Node-consumed ones), @bifold/core resolves from the app, and nothing is left of the earlier layouts (a bifold/
 * directory, which a checkout from before the move still has on disk; a nested install under it). Exit 1 with every
 * error listed otherwise. Run right after `yarn install --immutable` in the build workflows.
 *
 * Replaces verify-bifold-linking.js, which checked the portal: links into the submodule's own install and build.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const PACKAGES_DIR = path.join(ROOT, 'packages');

const errors = [];
const warnings = [];

function log(message, type = 'info') {
  const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅';
  console.log(`${prefix} ${message}`);
}

/** The @bifold/* dependencies app/package.json declares as workspaces. */
function appWorkspaceDeps() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const out = [];
  for (const [name, range] of Object.entries(all)) {
    if (!name.startsWith('@bifold/')) continue;
    if (!String(range).startsWith('workspace:')) {
      errors.push(`${name} is "${range}" in app/package.json; a framework package must be a workspace:* dependency`);
      continue;
    }
    out.push(name);
  }
  if (out.length === 0) errors.push('app/package.json declares no @bifold/* workspace dependency');
  return out;
}

function checkNoOldLayout() {
  log('Checking that nothing of the pre-move layout is on disk...');
  const bifold = path.join(ROOT, 'bifold');
  if (fs.existsSync(bifold)) {
    errors.push(
      'bifold/ exists: the framework lives at packages/ since Phase 2 of the fold, so this is a stale checkout ' +
        '(remove the folder, see README.md "Moving an existing checkout") or a build from before the move'
    );
    return;
  }
  log('no bifold/ directory', 'info');
}

function checkLinks(names) {
  log('Checking that the framework workspaces are linked into app/node_modules...');
  for (const name of names) {
    const linked = path.join(APP_DIR, 'node_modules', name);
    let stats;
    try {
      stats = fs.lstatSync(linked);
    } catch {
      errors.push(`${name} is not in app/node_modules (run yarn install at the repository root)`);
      continue;
    }
    if (!stats.isSymbolicLink()) {
      errors.push(`app/node_modules/${name} is not a symlink: a copy of the package, not the workspace`);
      continue;
    }
    const target = fs.realpathSync(linked);
    if (path.dirname(target) !== fs.realpathSync(PACKAGES_DIR)) {
      errors.push(`${name} links to ${target}, not a folder under packages/`);
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    } catch (e) {
      errors.push(`${name}: cannot read ${path.relative(ROOT, target)}/package.json: ${e.message}`);
      continue;
    }
    if (pkg.name !== name) {
      errors.push(`${name} links to ${path.relative(ROOT, target)}, whose package.json is named ${pkg.name}`);
      continue;
    }
    if (!pkg.main) {
      warnings.push(`${name} has no main field`);
    } else {
      const entry = path.join(target, pkg.main);
      if (!fs.existsSync(entry)) {
        errors.push(
          `${name}: its entry ${pkg.main} is missing` +
            (/^(src\/|\.\/src\/)/.test(pkg.main) ? '' : ' (a Node-consumed package: run its build, `yarn build:packages`)')
        );
        continue;
      }
      log(`${name} -> ${path.relative(ROOT, target)} (${pkg.main})`, 'info');
    }
    // A nested install under the package (packages/<x>/node_modules) is normal for a version only it asks for;
    // a nested COPY of a singleton is not, Metro pins those to the app's (singletonPrefixes in app/metro.config.js).
    for (const singleton of ['react', 'react-native', '@credo-ts/core']) {
      if (fs.existsSync(path.join(target, 'node_modules', singleton))) {
        errors.push(`${name} has its own copy of ${singleton} under packages/: two copies would load in one bundle`);
      }
    }
  }
}

function checkResolution() {
  log('Checking that @bifold/core resolves from the app...');
  try {
    const corePath = require.resolve('@bifold/core', { paths: [APP_DIR] });
    if (!fs.existsSync(corePath)) {
      errors.push(`@bifold/core resolved to ${corePath}, which does not exist`);
      return;
    }
    log(`@bifold/core resolves to ${path.relative(ROOT, corePath)}`, 'info');
  } catch (error) {
    errors.push(`@bifold/core does not resolve from app/: ${error.message}`);
  }
}

function checkTrustTasks() {
  // app/metro.config.js mirrors @openvtc/trust-tasks' exports map from one of these two bases.
  log('Checking where @openvtc/trust-tasks is installed...');
  const bases = [path.join(APP_DIR, 'node_modules'), path.join(ROOT, 'node_modules')];
  const found = bases.filter((b) => fs.existsSync(path.join(b, '@openvtc', 'trust-tasks', 'dist', 'index.js')));
  if (found.length === 0) {
    errors.push('@openvtc/trust-tasks (dist/index.js) is in neither app/node_modules nor node_modules');
    return;
  }
  log(`@openvtc/trust-tasks in ${found.map((b) => path.relative(ROOT, b)).join(' and ')}`, 'info');
}

function main() {
  console.log('🔍 Verifying the workspace install...\n');

  checkNoOldLayout();
  checkLinks(appWorkspaceDeps());
  checkResolution();
  checkTrustTasks();

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
  }
}

main();
