/**
 * Network HTML Generator - Main Entry Point
 *
 * Generates thin HTML shell that loads the bundled runtime JS.
 * This approach uses proper ES modules that are bundled with esbuild.
 *
 * Benefits:
 * - Full TypeScript type safety
 * - Testable modules
 * - Debuggable code
 * - Tree-shakeable bundles
 */

import { NetworkConfig, DEFAULT_WS_CONNECT_MESSAGE } from './runtime/config';
import { generateStyles } from './styles';

// Re-export types
export type { NetworkConfig } from './runtime/config';

// ─── HTML Generator ─────────────────────────────────────────────────────────────

/**
 * Generates the complete HTML document for the network dashboard.
 * Loads the bundled runtime JS from the configured path.
 *
 * @param config - Configuration for the network visualization
 * @param options.runtimePath - Path to the bundled runtime JS (default: '/network-runtime.js')
 * @returns Complete HTML string
 */
export function generateNetworkHTML(
  config: NetworkConfig,
  runtimePath = '/network-runtime.js'
): string {
  const {
    name,
    subtitle,
    wsConnectMessage = DEFAULT_WS_CONNECT_MESSAGE,
    actionControlsHTML,
    initialStateHandler = '',
    extraEventCases = '',
    extraWindowFunctions = '',
  } = config;

  const styles = generateStyles();
  const configJson = JSON.stringify({ wsConnectMessage });

  // Inject initial state handler and extra event cases into the page
  // These are executed by the runtime when processing WebSocket events
  const eventHandlersScript = `
    // Initial state handler - called when WebSocket sends initial state
    window.__networkInitialStateHandler = function(event) {
      ${initialStateHandler}
    };
    // Extra event cases - appended to the switch statement in handleEvent
    window.__networkExtraEventCases = function(event) {
      switch (event.type) {
        ${extraEventCases}
      }
    };
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)}</title>
  <style>
    ${styles}
  </style>
</head>
<body>
  <div id="hud">
    <div>
      <div class="hud-title"><span id="status-dot"></span>${escapeHtml(name)}</div>
      <div class="hud-subtitle">${escapeHtml(subtitle)}</div>
    </div>
    <div class="hud-stats">
      <div class="stat">
        <div class="stat-value" id="wallet-count">0</div>
        <div class="stat-label">Wallets</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="exchange-count">0</div>
        <div class="stat-label">Exchanges</div>
      </div>
    </div>
  </div>

  <div id="network-canvas" data-config='${configJson}'></div>

  <div id="controls">
    ${actionControlsHTML}
    <button class="ctrl-btn mode-2d" id="btn-2d" onclick="window.toggle2DMode()">2D Mode (2)</button>
    <button class="ctrl-btn cinema" id="btn-cinema" onclick="window.toggleCinema()">Cinema Mode (F)</button>
  </div>

  <div id="zoom-controls">
    <button class="zoom-btn active" id="btn-auto-cam" onclick="window.toggleAutoCamera()" title="Auto zoom (A)">A</button>
    <button class="zoom-btn" id="btn-zoom-in" onclick="window.zoomIn()" title="Zoom in (+)">+</button>
    <button class="zoom-btn" id="btn-zoom-out" onclick="window.zoomOut()" title="Zoom out (-)">−</button>
  </div>

  <div id="event-log"></div>
  <div id="tooltip"></div>

  <script src="${runtimePath}"></script>
  <script>
    ${eventHandlersScript}
    ${extraWindowFunctions}
  </script>
</body>
</html>`;
}

/**
 * Simple HTML entity escaping for security.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}
