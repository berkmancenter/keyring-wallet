/**
 * Esbuild configuration for bundling the network visualization runtime.
 * 
 * Usage:
 *   node esbuild.config.mjs
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(__dirname, 'runtime/index.ts')],
  bundle: true,
  outfile: 'dist/network-runtime.js',
  format: 'iife',
  platform: 'browser',
  target: ['chrome90', 'firefox90', 'safari14'],
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  external: [],
  loader: {
    '.js': 'js',
    '.ts': 'ts',
  },
});

console.log('✓ Bundled network-runtime.js');
