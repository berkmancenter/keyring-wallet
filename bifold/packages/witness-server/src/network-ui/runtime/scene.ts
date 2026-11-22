/**
 * Network Visualization Runtime - Scene Management
 *
 * Handles Three.js scene setup, camera, renderer, lighting, and stars.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  orbitControls: OrbitControls
  starGeom: THREE.BufferGeometry
}

export function createScene(container: HTMLElement): SceneState {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.015);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 5, 35);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);

  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;
  orbitControls.autoRotate = true;
  orbitControls.autoRotateSpeed = 0.3;
  orbitControls.enablePan = false;
  orbitControls.minDistance = 5;
  orbitControls.maxDistance = 150;
  orbitControls.maxPolarAngle = Math.PI * 0.85;
  orbitControls.minPolarAngle = Math.PI * 0.15;

  // Lighting
  const ambient = new THREE.AmbientLight(0x404060, 0.5);
  scene.add(ambient);
  const pointLight = new THREE.PointLight(0xa06eff, 2, 100);
  pointLight.position.set(0, 10, 0);
  scene.add(pointLight);

  // Background stars
  const starGeom = new THREE.BufferGeometry();
  const starPositions = new Float32Array(2000 * 3);
  for (let i = 0; i < starPositions.length; i++) starPositions[i] = (Math.random() - 0.5) * 200;
  starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starGeom, new THREE.PointsMaterial({ color: 0x334466, size: 0.15, transparent: true, opacity: 0.6 })));

  // Handle resize
  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);

  return { scene, camera, renderer, orbitControls, starGeom };
}
