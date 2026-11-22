/**
 * Network Visualization Runtime - Configuration
 *
 * Shared types and constants for the network visualization.
 * Used by both the HTML generator and the runtime JavaScript.
 */

// ─── Design System Colors ───────────────────────────────────────────────────────
// Color scales from ghost_balanced_floor35 palette:
// - Nodes: Boosted violet (#8F59D9) - violet #7828B4 lifted to match cyan luminance
// - Edges: Ghost cyan (#40D2FF) - unchanged, sets the luminance target
// Both use linear opacity scale: 35% floor → 100% ceiling
export const COLORS = {
  // Node color - boosted violet (linear scale floor to ceiling)
  nodeColor: 0x8f59d9,
  nodeColorHex: '#8F59D9',
  // Edge color - ghost cyan (linear scale floor to ceiling)
  edgeColor: 0x40d2ff,
  edgeColorHex: '#40D2FF',
  // Legacy aliases for backward compatibility
  violet: 0x8f59d9,
  mint: 0x40d2ff,
  violetHex: '#8F59D9',
  mintHex: '#40D2FF',
} as const;

// Color scale constants
export const COLOR_SCALE = {
  floor: 0.35,  // 35% - lowest score
  ceiling: 1.0, // 100% - highest score
} as const;

// Ring styling constants
export const RING_STYLES = {
  // Maximum rings per node
  maxRings: 10,
  // Ring radius increments
  ringRadiusIncrement: 0.3,
  ringThickness: 0.2,
  baseInnerRadius: 0.6,
  // Opacity by attestation count (0, 1, or 2)
  opacityByAttestation: [0.4, 0.7, 1.0] as const,
  // Colors for ring trust levels
  // Low trust: 0-1 attestations (violet)
  // High trust: 2 attestations (mint)
  lowTrustColor: 0xff6f55,   // Coral #FF6F55
  highTrustColor: 0x00e5a0,   // Mint #00E5A0
  // Breathing animation parameters
  // Base pulse amplitude for all rings (opacity variation)
  basePulseAmplitude: 0.1,
  // High trust rings get subtle scale breathing
  highTrustScaleBreathing: 0.024, // Scaled for subtle effect
  // Pulse frequency (same for all rings for synchronized breathing)
  pulseFrequency: 2.0,
} as const;

// ─── Configuration Interface ───────────────────────────────────────────────────
export interface NetworkConfig {
  name: string
  subtitle: string
  wsConnectMessage?: string
  actionControlsHTML: string
  initialStateHandler: string
  extraEventCases?: string
  extraWindowFunctions?: string
}

export const DEFAULT_WS_CONNECT_MESSAGE = 'Connected';

// ─── Physics Configuration ────────────────────────────────────────────────────
export interface PhysicsConfig {
  repulsionStrength: number
  attractionStrength: number
  damping: number
  centerPull: number
  boundary: number
  idealEdgeLength: number
  connectionYBoost: number
  maxYBoost: number
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  repulsionStrength: 2.0,
  attractionStrength: 0.01,
  damping: 0.92,
  centerPull: 0.008,
  boundary: 18,
  idealEdgeLength: 6,
  connectionYBoost: 0.3,
  maxYBoost: 2,
};

// ─── Node Data Structures ──────────────────────────────────────────────────────
export interface NodeData {
  id: string
  label: string
  tooltip: string
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
  connectionCount: number
  animProgress: number
}

export interface EdgeData {
  walletA: string
  walletB: string
  sessionId: string
  animProgress: number
  age: number
  /** Whether the exchange was witnessed by this server (default: true for exchange events) */
  witnessed?: boolean
  /** Number of parties with hardware attestation (0, 1, or 2) */
  attestationCount?: number
}

// ─── Network State ─────────────────────────────────────────────────────────────
export interface NetworkState {
  wallets: NodeData[]
  exchanges: EdgeData[]
  stats: {
    totalWallets: number
    totalExchanges: number
  }
}

// ─── Network Event Types ───────────────────────────────────────────────────────
export type NetworkEventType = 
  | 'initial-state'
  | 'wallet-connected'
  | 'exchange-started'
  | 'exchange-complete'

export interface NetworkEvent {
  type: NetworkEventType
  timestamp: number
  data: {
    wallet?: { id: string; label: string; tooltip: string }
    exchange?: { walletA: string; walletB: string; sessionId: string; labelA: string; labelB: string }
    wallets?: NodeData[]
    exchanges?: EdgeData[]
    labelA?: string
    labelB?: string
  }
}
