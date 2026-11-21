/**
 * Network Visualization Runtime - Edge Management
 *
 * Handles creation of edges (connections/exchanges) between nodes.
 */

import * as THREE from 'three';
import { COLORS } from './config';
import { percentToBrightness, rebuildNodeRings } from './nodes';
import type { NodeObject } from './nodes';

const COLOR_MINT = COLORS.edgeColor; // Ghost cyan #40D2FF

export interface EdgeObject {
  // Continuous tube for all edges (no dashed styling)
  tube: {
    core: THREE.Mesh
    glow: THREE.Mesh
  }
  nodeA: NodeObject
  nodeB: NodeObject
  burst?: THREE.Points
  burstVel: THREE.Vector3[]
  animProgress: number
  age: number
  /** Edge ID for ring tracking */
  edgeId: string
  /** Number of attestations (0, 1, or 2) */
  attestationCount: number
}

// Node radius for edge termination calculation
const NODE_RADIUS = 0.4

function createTubeBetween(a: THREE.Vector3, b: THREE.Vector3, scene: THREE.Scene) {
  const dir = b.clone().sub(a);
  const normalizedDir = dir.clone().normalize();
  const len = dir.length() - NODE_RADIUS * 2; // Subtract node radii from total length
  
  // Start and end positions (offset from node centers by node radius)
  const startPos = a.clone().add(normalizedDir.clone().multiplyScalar(NODE_RADIUS))
  const endPos = b.clone().sub(normalizedDir.clone().multiplyScalar(NODE_RADIUS))
  const mid = startPos.clone().add(endPos).multiplyScalar(0.5)
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalizedDir);
  
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, len, 6, 1),
    new THREE.MeshBasicMaterial({ color: COLOR_MINT, transparent: true, opacity: 0 })
  );
  core.position.copy(mid);
  core.quaternion.copy(quat);
  scene.add(core);
  
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, len, 6, 1),
    new THREE.MeshBasicMaterial({ color: COLOR_MINT, transparent: true, opacity: 0 })
  );
  glow.position.copy(mid);
  glow.quaternion.copy(quat);
  scene.add(glow);
  
  return { core, glow, startPos, endPos };
}

export function createEdgesManager(
  scene: THREE.Scene, 
  camera: THREE.Camera,
  nodes: Map<string, NodeObject>,
  _incrementConnection: (id: string, edgeScore?: number) => void,
  _decrementConnection: (id: string, edgeScore?: number) => void
) {
  const edges: EdgeObject[] = [];
  let exchangeCount = 0;
  let edgeIdCounter = 0;

  /**
   * Remove an edge and clean up all its THREE.js meshes from the scene.
   */
  function removeEdge(edge: EdgeObject) {
    // Remove continuous tube meshes
    if (edge.tube) {
      scene.remove(edge.tube.core);
      scene.remove(edge.tube.glow);
      edge.tube.core.geometry.dispose();
      edge.tube.glow.geometry.dispose();
    }
    // Remove particle burst
    if (edge.burst) {
      scene.remove(edge.burst);
      edge.burst.geometry.dispose();
    }
  }

  /**
   * Find an existing edge between two nodes (in either direction).
   * Returns the edge index if found, -1 otherwise.
   */
  function findEdgeIndex(walletAId: string, walletBId: string): number {
    return edges.findIndex(e => 
      (e.nodeA.id === walletAId && e.nodeB.id === walletBId) ||
      (e.nodeA.id === walletBId && e.nodeB.id === walletAId)
    );
  }

  /**
   * Get attestation count for edge styling.
   * Witnessed with 2 attestations = highest visibility.
   */
  function getAttestationCount(witnessed: boolean, attestationCount: number): number {
    if (!witnessed) return 0;
    return attestationCount; // 0, 1, or 2
  }

  function addEdge(walletAId: string, walletBId: string, _sessionId: string, attestationCount: number = 0, witnessed: boolean = true) {
    const nodeA = nodes.get(walletAId);
    const nodeB = nodes.get(walletBId);
    if (!nodeA || !nodeB) return;
    
    // Generate unique edge ID
    const edgeId = `edge_${edgeIdCounter++}`;
    
    // Check if this edge already exists (same pair of nodes, regardless of direction)
    // If so, remove the old edge first to prevent double-display
    const existingIndex = findEdgeIndex(walletAId, walletBId);
    if (existingIndex !== -1) {
      const existingEdge = edges[existingIndex];
      // Remove the old edge's rings from both nodes
      nodeA.edgeAttestations.delete(existingEdge.edgeId);
      nodeB.edgeAttestations.delete(existingEdge.edgeId);
      removeEdge(existingEdge);
      edges.splice(existingIndex, 1);
      console.log(`[Edges] Removed existing edge ${existingEdge.edgeId} between ${walletAId} and ${walletBId}`);
    }
    
    const tube = createTubeBetween(nodeA.position, nodeB.position, scene);
    const mid = nodeA.position.clone().add(nodeB.position).multiplyScalar(0.5);
    
    // Create particle burst effect
    const burstGeom = new THREE.BufferGeometry();
    const burstCount = 40;
    const burstPos = new Float32Array(burstCount * 3);
    const burstVel: THREE.Vector3[] = [];
    
    for (let i = 0; i < burstCount; i++) {
      burstPos[i * 3] = mid.x;
      burstPos[i * 3 + 1] = mid.y;
      burstPos[i * 3 + 2] = mid.z;
      burstVel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4
      ));
    }
    
    burstGeom.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
    const burst = new THREE.Points(
      burstGeom,
      new THREE.PointsMaterial({ color: COLOR_MINT, size: 0.2, transparent: true, opacity: 1 })
    );
    scene.add(burst);
    
    // Get final attestation count
    const finalAttestationCount = getAttestationCount(witnessed, attestationCount);
    
    const edgeObj: EdgeObject = { 
      tube, 
      nodeA, 
      nodeB, 
      burst, 
      burstVel, 
      animProgress: 0, 
      age: 0,
      edgeId,
      attestationCount: finalAttestationCount,
    };
    edges.push(edgeObj);
    
    // Apply edge styling based on witnessed status and attestation count
    applyEdgeScore(edgeObj, true, scene);
    
    // Add edge to both nodes (creates rings on each node)
    nodeA.edgeAttestations.set(edgeId, finalAttestationCount);
    nodeB.edgeAttestations.set(edgeId, finalAttestationCount);
    nodeA.connectionCount++;
    nodeB.connectionCount++;
    
    // Rebuild rings on both nodes to include the new edge (using centralized function from nodes.ts)
    rebuildNodeRings(scene, camera, nodeA);
    rebuildNodeRings(scene, camera, nodeB);
    
    exchangeCount++;
    document.getElementById('exchange-count')!.textContent = exchangeCount.toString();
  }

  function clearEdges() {
    for (const edge of edges) {
      if (edge.tube) {
        scene.remove(edge.tube.core);
        scene.remove(edge.tube.glow);
      }
      if (edge.burst) scene.remove(edge.burst);
    }
    edges.length = 0;
    exchangeCount = 0;
  }

  function animateEdges(dt: number, t: number, _is2DMode: boolean) {
    for (const edge of edges) {
      edge.age += dt;
      
      if (edge.animProgress < 1) {
        edge.animProgress = Math.min(1, edge.animProgress + dt * 2);
        // Animate continuous tube
        if (edge.tube) {
          edge.tube.core.material.opacity = edge.animProgress * 0.95;
          edge.tube.glow.material.opacity = edge.animProgress * 0.3;
        }
      } else {
        // Continuous tube glow animation
        if (edge.tube) {
          edge.tube.glow.material.opacity = 0.25 + Math.sin(t * 2 + edge.age) * 0.08;
        }
      }
      
      // Animate particle burst
      if (edge.burst && edge.age < 2.5) {
        const positions = edge.burst.geometry.attributes.position;
        for (let i = 0; i < edge.burstVel.length; i++) {
          positions.array[i * 3] += edge.burstVel[i].x;
          positions.array[i * 3 + 1] += edge.burstVel[i].y;
          positions.array[i * 3 + 2] += edge.burstVel[i].z;
        }
        positions.needsUpdate = true;
        edge.burst.material.opacity = Math.max(0, 1 - edge.age / 2.5);
      } else if (edge.burst) {
        scene.remove(edge.burst);
        edge.burst = undefined;
      }
    }
  }

  function updateTubePositions(is2DMode: boolean) {
    for (const edge of edges) {
      const a = edge.nodeA.position;
      const b = edge.nodeB.position;
      const dir = b.clone().sub(a);
      if (is2DMode) dir.y = 0;
      const normalizedDir = dir.clone().normalize();
      const tubeLen = dir.length() - NODE_RADIUS * 2; // Subtract node radii
      
      // Calculate start and end positions (offset from node centers by node radius)
      const startPos = a.clone().add(normalizedDir.clone().multiplyScalar(NODE_RADIUS))
      const endPos = b.clone().sub(normalizedDir.clone().multiplyScalar(NODE_RADIUS))
      const mid = startPos.clone().add(endPos).multiplyScalar(0.5)
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalizedDir);
      
      // Update continuous tube - recreate geometry with correct length
      if (edge.tube) {
        edge.tube.core.geometry.dispose()
        edge.tube.core.geometry = new THREE.CylinderGeometry(0.04, 0.04, tubeLen, 6, 1)
        edge.tube.core.position.copy(mid);
        edge.tube.core.quaternion.copy(quat);
        edge.tube.core.scale.y = 1;
        
        edge.tube.glow.geometry.dispose()
        edge.tube.glow.geometry = new THREE.CylinderGeometry(0.12, 0.12, tubeLen, 6, 1)
        edge.tube.glow.position.copy(mid);
        edge.tube.glow.quaternion.copy(quat);
        edge.tube.glow.scale.y = 1;
      }
    }
  }

  return {
    edges,
    addEdge,
    clearEdges,
    animateEdges,
    updateTubePositions,
    getExchangeCount: () => exchangeCount,
    edgeScore,
  };
}

// Edge styling functions
export function setEdgeStyle(edgeIndex: number, edges: EdgeObject[], style: 'solid' | 'dashed' | 'thickness') {
  if (edgeIndex < 0 || edgeIndex >= edges.length) return;
  const edge = edges[edgeIndex];
  if (!edge.tube) return;
  
  const baseCoreRadius = 0.04;
  const baseGlowRadius = 0.12;
  
  switch (style) {
    case 'solid':
      edge.tube.core.geometry.dispose();
      edge.tube.core.geometry = new THREE.CylinderGeometry(baseCoreRadius, baseCoreRadius, 1, 6, 1);
      edge.tube.glow.geometry.dispose();
      edge.tube.glow.geometry = new THREE.CylinderGeometry(baseGlowRadius, baseGlowRadius, 1, 6, 1);
      break;
    case 'dashed':
      edge.tube.core.geometry.dispose();
      edge.tube.core.geometry = new THREE.CylinderGeometry(baseCoreRadius * 0.8, baseCoreRadius * 0.8, 1, 6, 1);
      edge.tube.glow.geometry.dispose();
      edge.tube.glow.geometry = new THREE.CylinderGeometry(baseGlowRadius * 0.8, baseGlowRadius * 0.8, 1, 6, 1);
      break;
    case 'thickness':
      edge.tube.core.geometry.dispose();
      edge.tube.core.geometry = new THREE.CylinderGeometry(baseCoreRadius * 1.5, baseCoreRadius * 1.5, 1, 6, 1);
      edge.tube.glow.geometry.dispose();
      edge.tube.glow.geometry = new THREE.CylinderGeometry(baseGlowRadius * 1.5, baseGlowRadius * 1.5, 1, 6, 1);
      break;
  }
}

export function setEdgeBrightness(edgeIndex: number, edges: EdgeObject[], percent: number) {
  if (edgeIndex < 0 || edgeIndex >= edges.length) return;
  const edge = edges[edgeIndex];
  if (!edge.tube) return;
  const brightness = percentToBrightness(percent);
  edge.tube.core.material.opacity = brightness;
  edge.tube.glow.material.opacity = brightness * 0.3;
}

/**
 * Edge Score Interface
 *
 * Represents the visual styling score for an edge based on:
 * - witnessed: Whether the exchange was witnessed by this server
 * - attestationCount: Number of parties with hardware attestation (0, 1, or 2)
 *
 * Visual mapping (all edges continuous with variable thickness/brightness):
 * - score 0 (non-witnessed): 10% thickness, 10% brightness
 * - score 1 (witnessed, no attestations): 22% thickness, 22% brightness
 * - score 2 (one attestation): 46% thickness, 46% brightness
 * - score 3 (two attestations): 100% thickness, 100% brightness
 */
export interface EdgeScore {
  /** Visual score: 0=non-witnessed, 1=witnessed basic, 2=one attestation, 3=two attestations */
  score: number
  /** Thickness multiplier: exponential scaling (0.10 = 10% thickness, 1.00 = 100% thickness) */
  thicknessMultiplier: number
  /** Brightness multiplier: exponential scaling (0.10 = 10% brightness, 1.00 = 100% brightness) */
  brightness: number
}

/**
 * Calculate the visual edge score based on witnessed status and attestation count.
 * Uses exponential scaling for both thicknessMultiplier and brightness: 10% floor → 100% ceiling
 *
 * @param witnessed - Whether the exchange was witnessed by this server
 * @param attestationCount - Number of parties with hardware attestation (0, 1, or 2)
 * @returns EdgeScore object with visual styling parameters
 */
export function edgeScore(witnessed: boolean, attestationCount: number = 0): EdgeScore {
  // All edges are continuous - both thicknessMultiplier and brightness use exponential scaling
  // Formula: value = 0.10 * 10^((1/3) * score)
  // This gives: 10% → 22% → 46% → 100% for scores 0-3
  
  if (!witnessed) {
    // Non-witnessed: Factor in attestationCount for partial styling
    // - 0 attestations: score 0, 10% thickness, 10% brightness
    // - 1 attestation: score 0.33, 16% thickness, 16% brightness  
    // - 2 attestations: score 0.66, 26% thickness, 26% brightness
    const score = attestationCount / 3; // 0, 0.33, or 0.66
    const thicknessMultiplier = Math.round(0.10 * Math.pow(10, (1/3) * score) * 100) / 100;
    const brightness = Math.round(0.10 * Math.pow(10, (1/3) * score) * 100) / 100;
    
    return {
      score,
      thicknessMultiplier,
      brightness,
    }
  }

  const score = 1 + attestationCount
  const thicknessMultiplier = Math.round(0.10 * Math.pow(10, (1/3) * score) * 100) / 100;
  const brightness = Math.round(0.10 * Math.pow(10, (1/3) * score) * 100) / 100;
  
  return {
    score,
    thicknessMultiplier,  // 22% for score 1, 46% for score 2, 100% for score 3
    brightness,  // 22% for score 1, 46% for score 2, 100% for score 3
  }
}

/**
 * Apply edge score styling to an EdgeObject
 *
 * All edges use continuous tube rendering with variable thickness and brightness.
 * Higher thicknessMultiplier = thicker line
 * Higher brightness = brighter line
 *
 * @param edge - The edge object to style
 * @param isAnimating - Whether this is during the intro animation
 * @param scene - The Three.js scene (not used, kept for API compatibility)
 */
export function applyEdgeScore(edge: EdgeObject, isAnimating: boolean = false, _scene?: THREE.Scene): void {
  const dir = edge.nodeB.position.clone().sub(edge.nodeA.position)
  const normalizedDir = dir.clone().normalize()
  const totalLen = dir.length()
  const tubeLen = totalLen - NODE_RADIUS * 2 // Subtract node radii
  
  // Calculate start and end positions (offset from node centers by node radius)
  const startPos = edge.nodeA.position.clone().add(normalizedDir.clone().multiplyScalar(NODE_RADIUS))
  const endPos = edge.nodeB.position.clone().sub(normalizedDir.clone().multiplyScalar(NODE_RADIUS))
  const mid = startPos.clone().add(endPos).multiplyScalar(0.5)
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normalizedDir)
  
  // Get edge score for styling
  const score = edgeScore(edge.attestationCount > 0, edge.attestationCount)
  
  // Base radii
  const baseCoreRadius = 0.04
  const baseGlowRadius = 0.12
  
  // Calculate thickness based on score
  const coreRadius = baseCoreRadius * score.thicknessMultiplier
  const glowRadius = baseGlowRadius * score.thicknessMultiplier
  
  // Calculate brightness
  const baseOpacity = isAnimating ? 0.95 : score.brightness
  
  // Update core tube - use tubeLen as geometry height and reset scale.y to 1
  edge.tube.core.geometry.dispose()
  edge.tube.core.geometry = new THREE.CylinderGeometry(coreRadius, coreRadius, tubeLen, 6, 1)
  edge.tube.core.position.copy(mid)
  edge.tube.core.quaternion.copy(quat)
  edge.tube.core.scale.y = 1 // Reset scale since geometry height is now correct
  edge.tube.core.material.opacity = baseOpacity
  
  // Update glow tube
  edge.tube.glow.geometry.dispose()
  edge.tube.glow.geometry = new THREE.CylinderGeometry(glowRadius, glowRadius, tubeLen, 6, 1)
  edge.tube.glow.position.copy(mid)
  edge.tube.glow.quaternion.copy(quat)
  edge.tube.glow.scale.y = 1 // Reset scale since geometry height is now correct
  edge.tube.glow.material.opacity = baseOpacity * 0.3
}
