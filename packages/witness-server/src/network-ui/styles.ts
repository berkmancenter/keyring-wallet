/**
 * Network HTML Generator - Styles Module
 *
 * Generates all CSS for the network visualization dashboard.
 */

/**
 * Generates the complete CSS stylesheet for the network dashboard.
 */
export function generateStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #network-canvas { width: 100vw; height: 100vh; }
    canvas { display: block; }

    /* ─── HUD Styles ─────────────────────────────────────────────────────────── */
    #hud {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 24px 32px; pointer-events: none; z-index: 10;
    }
    #hud > * { pointer-events: auto; }
    .hud-title {
      color: #fff; font-size: 18px; font-weight: 600;
      text-shadow: 0 0 20px rgba(160,110,255,0.5);
    }
    .hud-subtitle { color: #8F59D9; font-size: 12px; margin-top: 2px; }
    .hud-stats { display: flex; gap: 32px; }
    .stat { text-align: center; }
    .stat-value {
      font-size: 42px; font-weight: 700; color: #8F59D9;
      text-shadow: 0 0 30px rgba(143,89,217,0.6); line-height: 1;
    }
    .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }

    /* ─── Control Button Styles ──────────────────────────────────────────────── */
    #controls {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 12px; z-index: 10;
    }
    /* 2D mode disabled - button hidden but code preserved for future use */
    .ctrl-btn.mode-2d { display: none; }
    .ctrl-btn {
      background: rgba(143,89,217,0.15); border: 1px solid rgba(143,89,217,0.4);
      color: #8F59D9; padding: 10px 24px; border-radius: 8px; font-size: 13px;
      cursor: pointer; transition: all 0.2s; backdrop-filter: blur(8px);
    }
    .ctrl-btn:hover { background: rgba(143,89,217,0.3); border-color: #8F59D9; }
    .ctrl-btn.active { background: #8F59D9; color: #fff; }
    .ctrl-btn.danger { border-color: rgba(234,102,102,0.4); color: #ea6666; }
    .ctrl-btn.danger:hover { background: rgba(234,102,102,0.3); }
    .ctrl-btn.cinema { border-color: rgba(80,255,210,0.4); color: #50FFD2; }
    .ctrl-btn.cinema:hover { background: rgba(80,255,210,0.3); }
    .ctrl-btn.cinema.active { background: #50FFD2; color: #000; }

    /* ─── Cinema Mode ────────────────────────────────────────────────────────── */
    body.cinema-mode #hud,
    body.cinema-mode #event-log { opacity: 0; pointer-events: none; }
    body.cinema-mode #controls { opacity: 0 !important; pointer-events: none !important; }
    body.cinema-mode #zoom-controls { opacity: 0 !important; pointer-events: none !important; }
    #hud, #event-log, #controls, #zoom-controls { transition: opacity 0.4s ease; }

    /* ─── Zoom Controls ─────────────────────────────────────────────────────── */
    #zoom-controls {
      position: fixed; left: 24px; top: 50%; transform: translateY(-50%);
      display: flex; flex-direction: column; gap: 8px; z-index: 10;
    }
    .zoom-btn {
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(143,89,217,0.15); border: 1px solid rgba(143,89,217,0.4);
      color: #8F59D9; font-size: 24px; font-weight: 300;
      cursor: pointer; transition: all 0.2s; backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
    }
    .zoom-btn:hover { background: rgba(143,89,217,0.3); border-color: #8F59D9; }
    .zoom-btn.active { background: #50FFD2; border-color: #50FFD2; color: #000; }

    /* ─── Status Indicator ──────────────────────────────────────────────────── */
    #status-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      display: inline-block; margin-right: 8px; transition: background 0.3s;
    }
    #status-dot.connected { background: #22c55e; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

    /* ─── Event Log ─────────────────────────────────────────────────────────── */
    #event-log {
      position: fixed; bottom: 80px; right: 24px; width: 320px; max-height: 300px;
      overflow-y: auto; z-index: 10; pointer-events: auto;
    }
    .log-entry {
      background: rgba(0,0,0,0.7); border-left: 3px solid #8F59D9;
      padding: 8px 12px; margin-bottom: 4px; font-size: 12px; color: #ccc;
      border-radius: 0 4px 4px 0; backdrop-filter: blur(4px);
      animation: slideIn 0.3s ease-out;
    }
    .log-entry.exchange { border-left-color: #50FFD2; }
    .log-entry .time { color: #555; font-size: 10px; }
    @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }

    /* ─── Tooltip ───────────────────────────────────────────────────────────── */
    #tooltip {
      position: fixed;
      background: rgba(0,0,0,0.9); color: #fff;
      padding: 8px 12px; border-radius: 6px; font-size: 12px;
      pointer-events: none; opacity: 0; transition: opacity 0.2s;
      z-index: 100; border: 1px solid #8F59D9;
      max-width: 300px; word-break: break-all;
    }
  `;
}
