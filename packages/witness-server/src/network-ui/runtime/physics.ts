/**
 * Network Visualization Runtime - Physics Simulation
 *
 * Implements force-directed layout algorithm for node positioning.
 */

import * as THREE from 'three';
import type { NodeObject } from './nodes';
import type { EdgeObject } from './edges';
import { DEFAULT_PHYSICS_CONFIG } from './config';
import type { PhysicsConfig } from './config';

export function createPhysicsEngine(
  nodes: Map<string, NodeObject>,
  edges: EdgeObject[],
  is2DMode: () => boolean,
  camera: THREE.Camera,
  config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG
) {
  function applyForces(): void {
    const nodeArr = Array.from(nodes.values());
    
    // Repulsion between all node pairs
    for (let i = 0; i < nodeArr.length; i++) {
      const a = nodeArr[i];
      for (let j = i + 1; j < nodeArr.length; j++) {
        const b = nodeArr[j];
        const diff = a.position.clone().sub(b.position);
        if (is2DMode()) diff.y = 0;
        const dist = Math.max(diff.length(), 0.5);
        const force = diff.normalize().multiplyScalar(config.repulsionStrength / (dist * dist));
        if (is2DMode()) force.y = 0;
        a.velocity.add(force);
        b.velocity.sub(force);
      }
      // Pull toward center
      a.velocity.add(a.position.clone().negate().multiplyScalar(config.centerPull));
      // Boundary constraint
      const d = a.position.length();
      if (d > config.boundary) {
        a.velocity.add(a.position.clone().negate().normalize().multiplyScalar((d - config.boundary) * 0.05));
      }
    }
    
    // Edge attraction (spring force toward ideal length)
    for (const edge of edges) {
      const diff = edge.nodeB.position.clone().sub(edge.nodeA.position);
      if (is2DMode()) diff.y = 0;
      const force = diff.normalize().multiplyScalar((diff.length() - config.idealEdgeLength) * config.attractionStrength);
      if (is2DMode()) force.y = 0;
      edge.nodeA.velocity.add(force);
      edge.nodeB.velocity.sub(force);
    }
    
    // Apply velocities and update positions
    for (const node of nodeArr) {
      node.velocity.multiplyScalar(config.damping);
      node.position.add(node.velocity);
      
      // 2D mode constraints
      if (is2DMode()) {
        const yBoost = Math.min(node.connectionCount * config.connectionYBoost, config.maxYBoost);
        node.position.y = yBoost;
        node.velocity.y = 0;
        // Update ring Y positions in 2D mode
        for (const ringData of node.rings) {
          ringData.mesh.position.y = yBoost;
        }
      }
      
      node.mesh.position.copy(node.position);
      // Update all rings - always face camera for circular appearance
      // Rings are now arrays of { mesh, edgeId, attestationCount }
      for (const ringData of node.rings) {
        ringData.mesh.position.copy(node.position);
        ringData.mesh.lookAt(camera.position);
      }
      node.label.position.copy(node.position);
      if (!is2DMode()) node.label.position.y += 1;
    }
  }

  return { applyForces };
}
