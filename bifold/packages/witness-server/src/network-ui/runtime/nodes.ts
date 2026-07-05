/**
 * Network Visualization Runtime - Node Management
 *
 * Handles creation, deletion, and styling of network nodes.
 */

import * as THREE from 'three';
import { COLOR_SCALE, RING_STYLES, COLORS } from './config';

// Ring colors by trust level
// Low trust: 0-1 attestations
// High trust: 2 attestations
const COLOR_LOW_TRUST = RING_STYLES.lowTrustColor;   // Violet
const COLOR_HIGH_TRUST = RING_STYLES.highTrustColor; // Mint

export interface NodeObject {
  /** The unique identifier for this node (same as the key in the nodes Map) */
  id: string
  mesh: THREE.Mesh
  /** Array of ring meshes + their data */
  rings: Array<{ mesh: THREE.Mesh; edgeId: string; attestationCount: number }>
  label: THREE.Sprite
  position: THREE.Vector3
  velocity: THREE.Vector3
  animProgress: number
  connectionCount: number
  nodeScore: number
  labelText: string
  /** Base emissive intensity (static brightness from nodeScore) */
  baseEmissiveIntensity: number
  /** Map of edgeId -> attestation count for tracking edges per node */
  edgeAttestations: Map<string, number>
}

/**
 * Node Score Interface
 *
 * Represents the visual styling for a node based on connected edges.
 * 
 * Visual mapping:
 * - rings: one ring per edge, max 10
 * - brightness: based on max attestation count
 */
export interface NodeScore {
  /** Sum of attestation counts from all connected edges */
  score: number
  /** Number of rings: one per edge, max 10 */
  rings: number
  /** Brightness: based on max attestation count */
  brightness: number
}

/**
 * Calculate the node score based on edge attestation counts connected to this node.
 * Uses linear color scale: 70% floor (matching violet rings) → 100% ceiling
 *
 * @param edgeAttestations - Map of edgeId -> attestation count
 * @returns NodeScore object with visual styling parameters
 */
export function nodeScore(edgeAttestations: Map<string, number>): NodeScore {
  const attestations = Array.from(edgeAttestations.values());
  // Each edge contributes its attestation count (0, 1, or 2) to the score
  const score = attestations.reduce((sum, a) => sum + a, 0);
  const rings = Math.min(RING_STYLES.maxRings, attestations.length);
  
  // Brightness based on max attestation count
  const maxAttestation = attestations.length > 0 ? Math.max(...attestations) : 0;
  // Normalize: 0 attestations → 70%, 1 attestation → 85%, 2 attestations → 100%
  // This matches the violet ring opacity for consistency
  const brightness = 0.7 + (COLOR_SCALE.ceiling - 0.7) * (maxAttestation / 2);

  return {
    score,
    rings,
    brightness,
  };
}

export function percentToBrightness(percent: number): number {
  const p = Math.max(0, Math.min(100, percent));
  return p / 100;
}

function makeTextSprite(text: string, color = '#ffffff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const maxWidth = 220;
  const lineHeight = 30;
  const fontSize = 24;
  
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';
  
  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  
  let maxLineWidth = 0;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxLineWidth) maxLineWidth = metrics.width;
  }
  
  canvas.width = Math.max(256, maxLineWidth + 40);
  canvas.height = lines.length * lineHeight + 20;
  
  ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, fontSize + i * lineHeight + 10));
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(Math.max(4, canvas.width * 0.015), lines.length * 0.5, 1);
  return sprite;
}

/**
 * Create a ring mesh at the specified position with attestation-based styling.
 * High trust (2 attestations) uses mint color, others use violet.
 */
function createRing(position: THREE.Vector3, camera: THREE.Camera, index: number, attestationCount: number, edgeId: string): { mesh: THREE.Mesh; edgeId: string; attestationCount: number } {
  const innerRadius = RING_STYLES.baseInnerRadius + (index * RING_STYLES.ringRadiusIncrement);
  const outerRadius = innerRadius + RING_STYLES.ringThickness;
  const isHighTrust = attestationCount === 2;
  const color = isHighTrust ? COLOR_HIGH_TRUST : COLOR_LOW_TRUST;
  
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerRadius, outerRadius, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.position.copy(position);
  ring.lookAt(camera.position);
  
  return { mesh: ring, edgeId, attestationCount };
}

/**
 * Update ring orientations to face the camera.
 */
function updateRingOrientations(rings: Array<{ mesh: THREE.Mesh }>, camera: THREE.Camera) {
  for (const { mesh } of rings) {
    mesh.lookAt(camera.position);
  }
}

/**
 * Rebuild rings for a node when edges change.
 * Sorts edges by attestation count so high trust rings (2 attestations) are always outermost.
 */
export function rebuildNodeRings(scene: THREE.Scene, camera: THREE.Camera, node: NodeObject): void {
  for (const ringData of node.rings) {
    scene.remove(ringData.mesh);
    ringData.mesh.geometry.dispose();
    (ringData.mesh.material as THREE.Material).dispose();
  }
  node.rings = [];
  
  const entries = Array.from(node.edgeAttestations.entries())
    .sort((a, b) => a[1] - b[1]);
  
  for (let i = 0; i < entries.length && i < RING_STYLES.maxRings; i++) {
    const [edgeId, attestationCount] = entries[i];
    const innerRadius = RING_STYLES.baseInnerRadius + (i * RING_STYLES.ringRadiusIncrement);
    const outerRadius = innerRadius + RING_STYLES.ringThickness;
    const isHighTrust = attestationCount === 2;
    const color = isHighTrust ? COLOR_HIGH_TRUST : COLOR_LOW_TRUST;
    
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(innerRadius, outerRadius, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ring.position.copy(node.position);
    ring.lookAt(camera.position);
    ring.scale.setScalar(node.animProgress > 0 ? 1 : 0);
    scene.add(ring);
    node.rings.push({ mesh: ring, edgeId, attestationCount });
  }
}

export function createNodesManager(scene: THREE.Scene, camera: THREE.Camera, is2DMode: () => boolean) {
  const nodes = new Map<string, NodeObject>();
  let walletCount = 0;

  function addNode(id: string, label: string, tooltip: string, skipAnimation = false) {
    if (nodes.has(id)) return;
    
    const angle = Math.random() * Math.PI * 2;
    const radius = 5 + Math.random() * 10;
    const yOffset = is2DMode() ? 0 : (Math.random() - 0.5) * 6;
    const pos = new THREE.Vector3(Math.cos(angle) * radius, yOffset, Math.sin(angle) * radius);
    
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 24, 24),
      new THREE.MeshBasicMaterial({ color: COLORS.nodeColor, transparent: true, opacity: 0.9 })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    
    const rings: Array<{ mesh: THREE.Mesh; edgeId: string; attestationCount: number }> = [];
    
    const sprite = makeTextSprite(label, '#aabbee');
    sprite.position.copy(pos);
    sprite.position.y += 1;
    sprite.userData = { tooltip };
    scene.add(sprite);
    
    if (skipAnimation) {
      mesh.scale.setScalar(1);
      const canvasWidth = (sprite.material.map as THREE.CanvasTexture)?.image?.width || 256;
      const canvasHeight = (sprite.material.map as THREE.CanvasTexture)?.image?.height || 30;
      const lineCount = Math.max(1, canvasHeight / 30);
      const baseScaleX = Math.max(4, canvasWidth * 0.015);
      sprite.scale.set(baseScaleX, lineCount * 0.5, 1);
    } else {
      mesh.scale.set(0, 0, 0);
      sprite.scale.set(0, 0, 0);
    }
    
    nodes.set(id, { 
      id,
      mesh, 
      rings, 
      label: sprite, 
      position: pos, 
      velocity: new THREE.Vector3(), 
      animProgress: skipAnimation ? 1 : 0, 
      connectionCount: 0, 
      nodeScore: 0,
      labelText: label,
      baseEmissiveIntensity: 0,
      edgeAttestations: new Map(),
    });
    
    walletCount++;
    document.getElementById('wallet-count')!.textContent = walletCount.toString();
  }

  function updateNodeStyleFromConnections(nodeId: string) {
    const node = nodes.get(nodeId);
    if (!node) return;
    
    const ns = nodeScore(node.edgeAttestations);
    node.nodeScore = ns.score;
    node.baseEmissiveIntensity = ns.brightness;
    node.mesh.material.opacity = ns.brightness;
    
    const targetRingCount = Math.min(ns.rings, RING_STYLES.maxRings);
    const currentRingCount = node.rings.length;
    
    if (targetRingCount !== currentRingCount) {
      rebuildRings(node.id);
    }
    
    node.mesh.renderOrder = node.connectionCount * 10;
    for (let i = 0; i < node.rings.length; i++) {
      node.rings[i].mesh.renderOrder = node.connectionCount * 10 + 1 + i;
    }
    node.label.renderOrder = node.connectionCount * 10 + 100;
    
    if (is2DMode()) {
      const yBoost = Math.min(node.connectionCount * 0.3, 2);
      node.mesh.position.y = yBoost;
      for (const ringData of node.rings) {
        ringData.mesh.position.y = yBoost;
      }
      node.label.position.y = yBoost;
    }
    
    updateRingOrientations(node.rings, camera);
  }

  function clearScene() {
    for (const node of nodes.values()) {
      scene.remove(node.mesh);
      node.mesh.geometry.dispose();
      (node.mesh.material as THREE.Material).dispose();
      
      for (const ringData of node.rings) {
        scene.remove(ringData.mesh);
        ringData.mesh.geometry.dispose();
        (ringData.mesh.material as THREE.Material).dispose();
      }
      
      scene.remove(node.label);
      (node.label.material as THREE.SpriteMaterial).map?.dispose();
      (node.label.material as THREE.Material).dispose();
    }
    nodes.clear();
    walletCount = 0;
    document.getElementById('wallet-count')!.textContent = '0';
    document.getElementById('exchange-count')!.textContent = '0';
  }

  function addEdgeToNode(nodeId: string, edgeId: string, attestationCount: number) {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (node.edgeAttestations.has(edgeId)) return;
    
    node.connectionCount++;
    node.edgeAttestations.set(edgeId, attestationCount);
    rebuildRings(nodeId);
    updateNodeStyleFromConnections(nodeId);
  }

  function removeEdgeFromNode(nodeId: string, edgeId: string) {
    const node = nodes.get(nodeId);
    if (!node) return;
    if (!node.edgeAttestations.has(edgeId)) return;
    
    node.edgeAttestations.delete(edgeId);
    node.connectionCount = Math.max(0, node.connectionCount - 1);
    
    const ringIndex = node.rings.findIndex(r => r.edgeId === edgeId);
    if (ringIndex !== -1) {
      const ringData = node.rings[ringIndex];
      scene.remove(ringData.mesh);
      ringData.mesh.geometry.dispose();
      (ringData.mesh.material as THREE.Material).dispose();
      node.rings.splice(ringIndex, 1);
    }
    
    rebuildRings(nodeId);
    updateNodeStyleFromConnections(nodeId);
  }

  function rebuildRingsInternal(node: NodeObject) {
    for (const ringData of node.rings) {
      scene.remove(ringData.mesh);
      ringData.mesh.geometry.dispose();
      (ringData.mesh.material as THREE.Material).dispose();
    }
    node.rings = [];
    
    const entries = Array.from(node.edgeAttestations.entries())
      .sort((a, b) => a[1] - b[1]);
    
    for (let i = 0; i < entries.length && i < RING_STYLES.maxRings; i++) {
      const [edgeId, attestationCount] = entries[i];
      const ringData = createRing(node.position, camera, i, attestationCount, edgeId);
      ringData.mesh.scale.setScalar(node.animProgress > 0 ? 1 : 0);
      scene.add(ringData.mesh);
      node.rings.push(ringData);
    }
  }

  function rebuildRings(nodeId: string) {
    const node = nodes.get(nodeId);
    if (!node) return;
    rebuildRingsInternal(node);
  }

  function updateRingPositions() {
    for (const node of nodes.values()) {
      for (const ringData of node.rings) {
        ringData.mesh.position.copy(node.position);
      }
      updateRingOrientations(node.rings, camera);
    }
  }

  function updateBreathing(t: number) {
    for (const node of nodes.values()) {
      if (node.animProgress < 1) continue;
      
      // Synchronized breathing for opacity
      const breathe = Math.sin(t * RING_STYLES.pulseFrequency) * 0.2;
      
      // Node: opacity breathing for matching effect with rings
      node.mesh.material.opacity = Math.min(1, 0.7 + breathe);
      
      for (const ringData of node.rings) {
        // All rings use the same opacity cycle
        const ringOpacity = 0.7 + breathe;
        ringData.mesh.material.opacity = Math.min(1, ringOpacity);
        
        // High trust rings get subtle thickness pulsing
        if (ringData.attestationCount === 2) {
          const scaleBreath = 1 + Math.sin(t * RING_STYLES.pulseFrequency) * RING_STYLES.highTrustScaleBreathing;
          ringData.mesh.scale.setScalar(scaleBreath);
        } else {
          ringData.mesh.scale.setScalar(1);
        }
      }
    }
  }

  return {
    nodes,
    addNode,
    clearScene,
    updateNodeStyleFromConnections,
    addEdgeToNode,
    removeEdgeFromNode,
    rebuildRings,
    updateRingPositions,
    updateBreathing,
    getWalletCount: () => walletCount,
  };
}
