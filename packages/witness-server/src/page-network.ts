/**
 * page-network.ts — Three.js live network graph (served at /network)
 *
 * Generates the full HTML string for the real-time witness exchange
 * visualisation. The page connects back to /ws on the same host to
 * receive live NetworkBroadcaster events and render them as a
 * force-directed node graph via Three.js (loaded from CDN).
 */

import type { WebServerConfig } from './WebServer'

export function generateNetworkPage(config: WebServerConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.name} - Live Network</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #canvas-container { width: 100vw; height: 100vh; }
    canvas { display: block; }

    #hud {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 24px 32px; pointer-events: none; z-index: 10;
    }
    #hud > * { pointer-events: auto; }
    .hud-title {
      color: #fff; font-size: 18px; font-weight: 600;
      text-shadow: 0 0 20px rgba(102,126,234,0.5);
    }
    .hud-subtitle { color: #667eea; font-size: 12px; margin-top: 2px; }
    .hud-stats {
      display: flex; gap: 32px;
    }
    .stat { text-align: center; }
    .stat-value {
      font-size: 42px; font-weight: 700; color: #667eea;
      text-shadow: 0 0 30px rgba(102,126,234,0.6);
      line-height: 1;
    }
    .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }

    #status-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #ef4444;
      display: inline-block; margin-right: 8px;
      transition: background 0.3s;
    }
    #status-dot.connected { background: #22c55e; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

    #event-log {
      position: fixed; bottom: 80px; right: 24px; width: 320px; max-height: 300px;
      overflow-y: auto; z-index: 10; pointer-events: auto;
    }
    .log-entry {
      background: rgba(0,0,0,0.7); border-left: 3px solid #667eea;
      padding: 8px 12px; margin-bottom: 4px; font-size: 12px; color: #ccc;
      border-radius: 0 4px 4px 0; backdrop-filter: blur(4px);
      animation: slideIn 0.3s ease-out;
    }
    .log-entry.exchange { border-left-color: #22c55e; }
    .log-entry .time { color: #555; font-size: 10px; }
    @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }

    #tooltip {
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 100;
      border: 1px solid #667eea;
      max-width: 300px;
      word-break: break-all;
    }

    #controls {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 12px; z-index: 10;
    }
    .ctrl-btn {
      background: rgba(102,126,234,0.15); border: 1px solid rgba(102,126,234,0.4);
      color: #667eea; padding: 10px 24px; border-radius: 8px; font-size: 13px;
      cursor: pointer; transition: all 0.2s; backdrop-filter: blur(8px);
      text-decoration: none; display: inline-flex; align-items: center;
    }
    .ctrl-btn:hover { background: rgba(102,126,234,0.3); border-color: #667eea; }
    .ctrl-btn.cinema { border-color: rgba(234,200,102,0.4); color: #eac866; }
    .ctrl-btn.cinema:hover { background: rgba(234,200,102,0.3); }
    .ctrl-btn.cinema.active { background: #eac866; color: #000; }

    body.cinema-mode #hud,
    body.cinema-mode #event-log { opacity: 0; pointer-events: none; }
    body.cinema-mode #controls { opacity: 0 !important; pointer-events: none !important; }
    #hud, #event-log, #controls { transition: opacity 0.4s ease; }
  </style>
</head>
<body>
  <div id="hud">
    <div>
      <div class="hud-title"><span id="status-dot"></span>${config.name}</div>
      <div class="hud-subtitle">Live Witnessed Exchange Network</div>
    </div>
    <div class="hud-stats">
      <div class="stat">
        <div class="stat-value" id="wallet-count">0</div>
        <div class="stat-label">Participants</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="exchange-count">0</div>
        <div class="stat-label">Relationships</div>
      </div>
    </div>
  </div>

  <div id="canvas-container"></div>

  <div id="controls">
    <a href="/" class="ctrl-btn">📱 QR Code</a>
    <a href="/log" class="ctrl-btn">📊 Activity Log</a>
    <button class="ctrl-btn cinema" id="btn-cinema" onclick="window.toggleCinema()">Cinema Mode (F)</button>
  </div>

  <div id="event-log"></div>

  <div id="tooltip"></div>

  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
    }
  }
  </script>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    // ─── State ───────────────────────────────────────────────────────
    const nodes = new Map();    // id -> { mesh, label, position, velocity }
    const edges = [];           // { line, meshA, meshB, particles, age }
    let walletCount = 0;
    let exchangeCount = 0;

    // ─── Three.js Setup ─────────────────────────────────────────────
    const container = document.getElementById('canvas-container');
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.015);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 5, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.enablePan = false;
    controls.minDistance = 15;
    controls.maxDistance = 60;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.minPolarAngle = Math.PI * 0.15;

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambient);
    const pointLight = new THREE.PointLight(0x667eea, 2, 100);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);

    // Background stars
    const starGeom = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) starPositions[i] = (Math.random() - 0.5) * 200;
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x334466, size: 0.15, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Points(starGeom, starMat));

    // Sprite texture for labels
    function makeTextSprite(text, color = '#ffffff', tooltip = '') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const lines = text.split('\\n');
      const fontSize = 28;
      const lineHeight = 36;
      const padding = 24;
      
      const font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.font = font;
      
      let maxWidth = 0;
      for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxWidth) maxWidth = w;
      }
      
      canvas.width = Math.ceil(maxWidth + padding * 2);
      canvas.height = lines.length * lineHeight + padding;
      
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      
      lines.forEach((line, index) => {
        ctx.fillText(line, canvas.width / 2, fontSize + padding / 2 + (index * lineHeight));
      });
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      
      const aspect = canvas.width / canvas.height;
      const spriteHeight = 0.9;
      sprite.scale.set(spriteHeight * aspect, spriteHeight, 1);
      
      sprite.userData = { tooltip: tooltip || '', aspect };
      
      return sprite;
    }

    // Glow sphere material
    function makeNodeMaterial(color = 0x667eea) {
      return new THREE.MeshPhongMaterial({
        color, emissive: color, emissiveIntensity: 0.4,
        transparent: true, opacity: 0.9,
      });
    }

    // ─── Node / Edge Management ─────────────────────────────────────
    function addNode(id, label, tooltip) {
      if (nodes.has(id)) return;

      const angle = Math.random() * Math.PI * 2;
      const radius = 5 + Math.random() * 10;
      const pos = new THREE.Vector3(
        Math.cos(angle) * radius,
        (Math.random() - 0.5) * 6,
        Math.sin(angle) * radius
      );

      const geom = new THREE.SphereGeometry(0.4, 24, 24);
      const mesh = new THREE.Mesh(geom, makeNodeMaterial());
      mesh.position.copy(pos);
      scene.add(mesh);

      // Glow ring
      const ringGeom = new THREE.RingGeometry(0.6, 0.8, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x667eea, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.position.copy(pos);
      ring.lookAt(camera.position);
      scene.add(ring);

      // Label
      const sprite = makeTextSprite(label, '#aabbee', tooltip);
      sprite.position.copy(pos);
      sprite.position.y += 1;
      scene.add(sprite);

      // Scale-in animation
      mesh.scale.set(0, 0, 0);
      ring.scale.set(0, 0, 0);
      sprite.scale.set(0, 0, 0);

      nodes.set(id, {
        mesh, ring, label: sprite, position: pos, tooltip,
        velocity: new THREE.Vector3(), targetScale: 1, animProgress: 0,
      });

      walletCount++;
      document.getElementById('wallet-count').textContent = walletCount;
    }

    function createTubeBetween(a, b) {
      const dir = b.clone().sub(a);
      const len = dir.length();
      const mid = a.clone().add(b).multiplyScalar(0.5);

      const coreGeom = new THREE.CylinderGeometry(0.04, 0.04, len, 6, 1);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x44ee88, transparent: true, opacity: 0 });
      const core = new THREE.Mesh(coreGeom, coreMat);
      core.position.copy(mid);
      core.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.normalize());
      scene.add(core);

      const glowGeom = new THREE.CylinderGeometry(0.12, 0.12, len, 6, 1);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0 });
      const glow = new THREE.Mesh(glowGeom, glowMat);
      glow.position.copy(mid);
      glow.quaternion.copy(core.quaternion);
      scene.add(glow);

      return { core, glow };
    }

    function addEdge(walletAId, walletBId, sessionId) {
      const nodeA = nodes.get(walletAId);
      const nodeB = nodes.get(walletBId);
      if (!nodeA || !nodeB) return;

      const tube = createTubeBetween(nodeA.position, nodeB.position);

      const mid = nodeA.position.clone().add(nodeB.position).multiplyScalar(0.5);
      const burstGeom = new THREE.BufferGeometry();
      const burstCount = 40;
      const burstPos = new Float32Array(burstCount * 3);
      const burstVel = [];
      for (let i = 0; i < burstCount; i++) {
        burstPos[i*3] = mid.x;
        burstPos[i*3+1] = mid.y;
        burstPos[i*3+2] = mid.z;
        burstVel.push(new THREE.Vector3(
          (Math.random()-0.5)*0.4,
          (Math.random()-0.5)*0.4,
          (Math.random()-0.5)*0.4,
        ));
      }
      burstGeom.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
      const burstMat = new THREE.PointsMaterial({ color: 0x44ee88, size: 0.2, transparent: true, opacity: 1 });
      const burst = new THREE.Points(burstGeom, burstMat);
      scene.add(burst);

      const edge = { tube, nodeA, nodeB, burst, burstVel, animProgress: 0, age: 0 };
      edges.push(edge);

      exchangeCount++;
      document.getElementById('exchange-count').textContent = exchangeCount;
    }

    // ─── Force-directed Layout ──────────────────────────────────────
    function applyForces() {
      const nodeArr = Array.from(nodes.values());
      const repulsionStrength = 2.0;
      const attractionStrength = 0.01;
      const damping = 0.92;
      const centerPull = 0.008;
      const boundary = 18;

      for (let i = 0; i < nodeArr.length; i++) {
        const a = nodeArr[i];
        // Repulsion between all pairs
        for (let j = i + 1; j < nodeArr.length; j++) {
          const b = nodeArr[j];
          const diff = a.position.clone().sub(b.position);
          const dist = Math.max(diff.length(), 0.5);
          const force = diff.normalize().multiplyScalar(repulsionStrength / (dist * dist));
          a.velocity.add(force);
          b.velocity.sub(force);
        }
        // Pull toward center
        const toCenter = a.position.clone().negate().multiplyScalar(centerPull);
        a.velocity.add(toCenter);

        // Soft boundary
        const distFromCenter = a.position.length();
        if (distFromCenter > boundary) {
          const pushBack = a.position.clone().negate().normalize().multiplyScalar((distFromCenter - boundary) * 0.05);
          a.velocity.add(pushBack);
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        if (!edge.nodeA || !edge.nodeB) continue;
        const diff = edge.nodeB.position.clone().sub(edge.nodeA.position);
        const dist = diff.length();
        const idealDist = 6;
        const force = diff.normalize().multiplyScalar((dist - idealDist) * attractionStrength);
        edge.nodeA.velocity.add(force);
        edge.nodeB.velocity.sub(force);
      }

      // Apply velocity
      for (const node of nodeArr) {
        node.velocity.multiplyScalar(damping);
        node.position.add(node.velocity);
        node.mesh.position.copy(node.position);
        node.ring.position.copy(node.position);
        node.ring.lookAt(camera.position);
        node.label.position.copy(node.position);
        node.label.position.y += 1;
      }

      // Update edge tubes
      for (const edge of edges) {
        if (!edge.tube) continue;
        const a = edge.nodeA.position;
        const b = edge.nodeB.position;
        const dir = b.clone().sub(a);
        const len = dir.length();
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), dir.normalize());

        edge.tube.core.position.copy(mid);
        edge.tube.core.quaternion.copy(quat);
        edge.tube.core.scale.set(1, len / edge.tube.core.geometry.parameters.height, 1);

        edge.tube.glow.position.copy(mid);
        edge.tube.glow.quaternion.copy(quat);
        edge.tube.glow.scale.set(1, len / edge.tube.glow.geometry.parameters.height, 1);
      }
    }

    // ─── Tooltip Interaction ─────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const tooltip = document.getElementById('tooltip');
    let currentEvent = null;

    renderer.domElement.addEventListener('mousemove', (event) => {
      currentEvent = event;
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    });

    function updateTooltip() {
      if (!currentEvent) return;
      raycaster.setFromCamera(mouse, camera);
      
      // Get all label sprites
      const sprites = [];
      for (const node of nodes.values()) {
        if (node.label) sprites.push(node.label);
      }
      
      const intersects = raycaster.intersectObjects(sprites);
      
      if (intersects.length > 0 && intersects[0].object.userData.tooltip) {
        const nodeData = intersects[0].object.userData;
        tooltip.textContent = nodeData.tooltip;
        tooltip.style.opacity = '1';
        tooltip.style.left = (currentEvent.clientX + 16) + 'px';
        tooltip.style.top = (currentEvent.clientY + 16) + 'px';
      } else {
        tooltip.style.opacity = '0';
      }
    }

    // ─── Animation Loop ─────────────────────────────────────────────
    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();

      // Update tooltip
      updateTooltip();

      // Animate node scale-in
      for (const node of nodes.values()) {
        if (node.animProgress < 1) {
          node.animProgress = Math.min(1, node.animProgress + dt * 3);
          const s = easeOutBack(node.animProgress);
          node.mesh.scale.setScalar(s);
          node.ring.scale.setScalar(s);
          const labelAspect = node.label.userData.aspect || 4;
          const labelH = 0.9;
          node.label.scale.set(labelH * labelAspect * s, labelH * s, 1);
        }
        // Subtle breathing glow
        const breathe = 0.3 + Math.sin(t * 2 + node.position.x) * 0.1;
        node.mesh.material.emissiveIntensity = breathe;
        node.ring.material.opacity = 0.2 + Math.sin(t * 1.5 + node.position.z) * 0.1;
      }

      // Animate edges
      for (const edge of edges) {
        edge.age += dt;
        if (edge.animProgress < 1) {
          edge.animProgress = Math.min(1, edge.animProgress + dt * 2);
          const p = edge.animProgress;
          if (edge.tube) {
            edge.tube.core.material.opacity = p * 0.95;
            edge.tube.glow.material.opacity = p * 0.3;
          }
        }
        if (edge.tube && edge.animProgress >= 1) {
          const pulse = 0.25 + Math.sin(t * 2 + edge.age) * 0.08;
          edge.tube.glow.material.opacity = pulse;
        }
        if (edge.burst && edge.age < 2.5) {
          const positions = edge.burst.geometry.attributes.position;
          for (let i = 0; i < edge.burstVel.length; i++) {
            positions.array[i*3] += edge.burstVel[i].x;
            positions.array[i*3+1] += edge.burstVel[i].y;
            positions.array[i*3+2] += edge.burstVel[i].z;
          }
          positions.needsUpdate = true;
          edge.burst.material.opacity = Math.max(0, 1 - edge.age / 2.5);
        } else if (edge.burst && edge.age >= 2.5) {
          scene.remove(edge.burst);
          edge.burst = null;
        }
      }

      applyForces();

      // Auto-fit: smoothly adjust camera distance so all nodes stay in view
      if (nodes.size > 0) {
        let maxDist = 0;
        for (const node of nodes.values()) {
          const d = node.position.length();
          if (d > maxDist) maxDist = d;
        }
        const idealDist = Math.max(25, maxDist * 2.5 + 10);
        const currentDist = camera.position.length();
        const targetDist = currentDist + (idealDist - currentDist) * 0.02;
        camera.position.normalize().multiplyScalar(targetDist);
      }

      controls.update();
      renderer.render(scene, camera);
    }

    function easeOutBack(x) {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    animate();

    // ─── WebSocket ──────────────────────────────────────────────────
    let ws;
    let reconnectTimer;

    function connectWS() {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(protocol + '://' + location.host + '/ws');

      ws.onopen = () => {
        document.getElementById('status-dot').classList.add('connected');
        addLogEntry('Connected to witness server', false);
      };

      ws.onclose = () => {
        document.getElementById('status-dot').classList.remove('connected');
        addLogEntry('Disconnected - reconnecting...', false);
        reconnectTimer = setTimeout(connectWS, 3000);
      };

      ws.onmessage = (evt) => {
        const event = JSON.parse(evt.data);
        handleEvent(event);
      };
    }

    function handleEvent(event) {
      switch (event.type) {
        case 'initial-state': {
          const { wallets, exchanges } = event.data;
          for (const w of wallets) addNode(w.id, w.label, w.tooltip);
          for (const e of exchanges) addEdge(e.walletA, e.walletB, e.sessionId);
          break;
        }
        case 'wallet-connected': {
          const w = event.data.wallet;
          addNode(w.id, w.label, w.tooltip);
          addLogEntry(w.label + ' connected', false);
          break;
        }
        case 'exchange-started': {
          addLogEntry(event.data.labelA + ' \\u2194 ' + event.data.labelB + ' started', false);
          break;
        }
        case 'exchange-complete': {
          const ex = event.data.exchange;
          addEdge(ex.walletA, ex.walletB, ex.sessionId);
          addLogEntry(ex.labelA + ' \\u2194 ' + ex.labelB + ' witnessed', true);
          break;
        }
        case 'stats-update': {
          break;
        }
      }
    }

    function addLogEntry(text, isExchange) {
      const log = document.getElementById('event-log');
      const entry = document.createElement('div');
      entry.className = 'log-entry' + (isExchange ? ' exchange' : '');
      const now = new Date().toLocaleTimeString();
      entry.innerHTML = '<span class="time">' + now + '</span> ' + text;
      log.prepend(entry);
      while (log.children.length > 30) log.removeChild(log.lastChild);
    }

    connectWS();

    // ─── Cinema mode ────────────────────────────────────────────────
    window.toggleCinema = function() {
      document.body.classList.toggle('cinema-mode');
      const btn = document.getElementById('btn-cinema');
      const active = document.body.classList.contains('cinema-mode');
      btn.classList.toggle('active', active);
      btn.textContent = active ? 'Exit Cinema (F)' : 'Cinema Mode (F)';
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') window.toggleCinema();
      if (e.key === 'Escape' && document.body.classList.contains('cinema-mode')) window.toggleCinema();
    });

    // Resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  </script>
</body>
</html>`
}
