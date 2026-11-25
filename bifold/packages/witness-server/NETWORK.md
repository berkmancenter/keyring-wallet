# Live 3D Witness Dashboard

A real-time Three.js visualization of wallet connections and witnessed exchanges. Wallets appear as glowing nodes and exchanges render as animated edges in a force-directed 3D graph.

## Running

### Standalone Mock Dashboard

Generates fake wallet connections and exchanges for testing without a witness server.

```bash
cd packages/witness-server
yarn dashboard
```

Opens on `http://localhost:9003` by default. Override with `DASHBOARD_PORT` env var.

Mock data generation starts automatically — wallets connect and exchanges fire in real time so you can see the graph build itself.

### Standalone Reporting Dashboard

Visualizes the reporting graph from a witness server's database. Wallets are labeled with deterministic pseudonyms instead of full DIDs.

```bash
cd packages/witness-server
yarn dashboard:reporting
```

Opens on `http://localhost:9003` by default. Loads all wallet connections and exchanges from the local ReportingGraph database.

**Pseudonym Labels**: Each wallet (reporting DID) is assigned a deterministic, human-readable pseudonym based on its DID. Hover over any wallet node to see the full DID in a tooltip.

### Integrated with Witness Server

```bash
cd packages/witness-server
yarn dev
```

Navigate to `http://localhost:9003/dashboard`. Real wallet connections and exchanges show up live as they happen.

When the witness server is running with the ReportingGraph enabled, the dashboard automatically loads historical wallet connections on startup and updates in real-time as new exchanges complete.

## Controls

| Button | What it does |
|--------|-------------|
| Start Mock | Generates fake wallet connections and exchanges |
| Stop Mock | Pauses mock generation |
| Reset | Clears all nodes and edges |

You can orbit, zoom, and pan the 3D scene with your mouse.

## Architecture

- **`DashboardBroadcaster.ts`** — Tracks wallets and exchanges, emits events over WebSocket
- **`dashboard-standalone.ts`** — Lightweight HTTP + WebSocket server that serves the dashboard without the full Credo agent
- **`WebServer.ts`** (`/dashboard` route) — Serves the same Three.js page as part of the full witness server
