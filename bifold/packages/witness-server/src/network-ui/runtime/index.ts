/**
 * Network Visualization Runtime - Main Entry Point
 *
 * Initializes the network visualization with all components.
 * This file is bundled by esbuild into a single JS file.
 */

import * as THREE from 'three'
import { createScene } from './scene'
import { createNodesManager } from './nodes'
import { createEdgesManager } from './edges'
import { createPhysicsEngine } from './physics'
import { DEFAULT_WS_CONNECT_MESSAGE } from './config'
import type { NetworkEvent } from './config'

export interface RuntimeConfig {
  wsConnectMessage?: string
  initialStateHandler?: string
  extraEventCases?: string
  extraWindowFunctions?: string
}

function easeOutBack(x: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

export function createNetworkVisualization(container: HTMLElement, config: RuntimeConfig = {}) {
  // Initialize scene
  const { scene, camera, renderer, orbitControls, starGeom } = createScene(container)

  // State flags
  let is2DMode = false
  let autoCameraMode = true
  let mouseEvent: MouseEvent | null = null

  // Create managers
  const nodesManager = createNodesManager(scene, camera, () => is2DMode)
  const edgesManager = createEdgesManager(
    scene,
    camera,
    nodesManager.nodes,
    nodesManager.incrementConnection,
    nodesManager.decrementConnection
  )
  const physics = createPhysicsEngine(nodesManager.nodes, edgesManager.edges, () => is2DMode, camera)

  // Tooltip
  const tooltipEl = document.getElementById('tooltip')!
  const mouse = new THREE.Vector2()
  const raycaster = new THREE.Raycaster()

  renderer.domElement.addEventListener('mousemove', (event) => {
    mouseEvent = event
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1
  })

  function updateTooltip() {
    if (!mouseEvent) return
    raycaster.setFromCamera(mouse, camera)
    const sprites = Array.from(nodesManager.nodes.values())
      .map((n) => n.label)
      .filter(Boolean)
    const meshes = Array.from(nodesManager.nodes.values())
      .map((n) => n.mesh)
      .filter(Boolean)
    const intersects = raycaster.intersectObjects([...sprites, ...meshes])
    let tooltipText = ''
    for (const hit of intersects) {
      if (hit.object.userData?.tooltip) {
        tooltipText = hit.object.userData.tooltip
        break
      }
      const node = Array.from(nodesManager.nodes.values()).find((n) => n.mesh === hit.object)
      if (node) {
        tooltipText = node.mesh.userData?.tooltip || ''
        break
      }
    }
    if (tooltipText) {
      tooltipEl.textContent = tooltipText
      tooltipEl.style.opacity = '1'
      tooltipEl.style.left = mouseEvent.clientX + 16 + 'px'
      tooltipEl.style.top = mouseEvent.clientY + 16 + 'px'
    } else {
      tooltipEl.style.opacity = '0'
    }
  }

  // Clock
  const clock = new THREE.Clock()

  // Animation loop
  function animate() {
    requestAnimationFrame(animate)
    const dt = clock.getDelta()
    const t = clock.getElapsedTime()

    updateTooltip()

    // Animate node appearance
    for (const node of nodesManager.nodes.values()) {
      if (node.animProgress < 1) {
        node.animProgress = Math.min(1, node.animProgress + dt * 3)
        const s = easeOutBack(node.animProgress)
        node.mesh.scale.setScalar(s)
        // Animate all rings with the same scale
        // Rings are now arrays of { mesh, edgeId, attestationCount }
        for (const ringData of node.rings) {
          ringData.mesh.scale.setScalar(s)
        }
        const canvasWidth = (node.label.material.map as THREE.CanvasTexture)?.image?.width || 256
        const canvasHeight = (node.label.material.map as THREE.CanvasTexture)?.image?.height || 30
        const lineCount = Math.max(1, canvasHeight / 30)
        const baseScaleX = Math.max(4, canvasWidth * 0.015)
        node.label.scale.set(baseScaleX * s, s * lineCount * 0.5, 1)
      }
    }

    // Update breathing animation for nodes and rings
    nodesManager.updateBreathing(t)

    // Update ring positions to follow nodes
    nodesManager.updateRingPositions()

    // Animate edges
    edgesManager.animateEdges(dt, t, is2DMode)

    // Apply physics
    physics.applyForces()

    // Update edge positions to follow nodes
    edgesManager.updateTubePositions(is2DMode)

    // Auto camera zoom
    if (nodesManager.nodes.size > 0 && !is2DMode && autoCameraMode) {
      let maxDist = 0
      for (const node of nodesManager.nodes.values()) {
        maxDist = Math.max(maxDist, node.position.length())
      }
      const ideal = Math.max(15, maxDist * 1.5 + 8)
      const curr = camera.position.length()
      camera.position.normalize().multiplyScalar(curr + (ideal - curr) * 0.02)
    }

    orbitControls.update()
    renderer.render(scene, camera)
  }
  animate()

  // WebSocket connection
  let ws: WebSocket

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(proto + '://' + location.host + '/ws')
    ws.onopen = () => {
      document.getElementById('status-dot')!.classList.add('connected')
      addLogEntry(config.wsConnectMessage || DEFAULT_WS_CONNECT_MESSAGE, false)
    }
    ws.onclose = () => {
      document.getElementById('status-dot')!.classList.remove('connected')
      addLogEntry('Disconnected - reconnecting...', false)
      setTimeout(connectWS, 3000)
    }
    ws.onmessage = (evt) => handleEvent(JSON.parse(evt.data))
  }

  function handleEvent(event: NetworkEvent) {
    switch (event.type) {
      case 'initial-state':
        // Call the injected initial state handler (from generateNetworkHTML)
        if (typeof (window as any).__networkInitialStateHandler === 'function') {
          (window as any).__networkInitialStateHandler(event)
        }
        // Also process directly for backward compatibility
        if (event.data.wallets) {
          for (const w of event.data.wallets) {
            nodesManager.addNode(w.id, w.label, w.tooltip, true) // skipAnimation=true
          }
        }
        if (event.data.exchanges) {
          for (const e of event.data.exchanges) {
            edgesManager.addEdge(e.walletA, e.walletB, e.sessionId, e.attestationCount || 0)
          }
        }
        break
      case 'wallet-connected':
        if (event.data.wallet) {
          const w = event.data.wallet
          nodesManager.addNode(w.id, w.label, w.tooltip) // animate new wallets
          addLogEntry(w.label + ' connected', false)
        }
        break
      case 'exchange-complete':
        if (event.data.exchange) {
          const ex = event.data.exchange
          const attestationCount = ex.attestationCount || 0
          // Determine if this is witnessed - default to false if not specified
          const witnessed = ex.witnessed ?? false
          edgesManager.addEdge(ex.walletA, ex.walletB, ex.sessionId, attestationCount, witnessed)

          // Build log entry with attestation info
          const score = edgesManager.edgeScore(witnessed, attestationCount)
          console.log(`[Network] Edge added: ${ex.labelA} ↔ ${ex.labelB}`)
          console.log(`[Network]   witnessed: ${witnessed}, attestationCount: ${attestationCount}`)
          console.log(`[Network]   edgeScore: ${JSON.stringify(score)}`)
          console.log(`[Network]   score: ${score.score}, dashRatio: ${score.dashRatio}, opacity: ${score.opacity}`)

          // Format attestation info for display
          let logText = ex.labelA + ' \u2194 ' + ex.labelB
          if (!witnessed) {
            // Non-witnessed exchanges still show Secure count for visibility score
            logText += attestationCount > 0 ? ` (not witnessed, Secure x ${attestationCount})` : ' (not witnessed)'
          } else if (attestationCount === 0) {
            logText += ' (witnessed)'
          } else if (attestationCount === 1) {
            logText += ' (witnessed, Secure x 1)'
          } else {
            logText += ` (witnessed, Secure x ${attestationCount})`
          }
          addLogEntry(logText, true)
        }
        break
    }
  }

  function addLogEntry(text: string, isExchange: boolean) {
    const log = document.getElementById('event-log')!
    const entry = document.createElement('div')
    entry.className = 'log-entry' + (isExchange ? ' exchange' : '')
    entry.innerHTML = '<span class="time">' + new Date().toLocaleTimeString() + '</span> ' + text
    log.prepend(entry)
    while (log.children.length > 30) log.removeChild(log.lastChild!)
  }

  // Public API
  function setVisualizationMode(mode: boolean) {
    is2DMode = mode
    const btn = document.getElementById('btn-2d')
    btn?.classList.toggle('active', is2DMode)

    if (is2DMode) {
      camera.position.set(0, 40, 0.1)
      camera.lookAt(0, 0, 0)
      orbitControls.enableRotate = false
      orbitControls.autoRotate = false
      scene.fog = null
      scene.children = scene.children.filter((c) => !(c instanceof THREE.Points))
    } else {
      camera.position.set(0, 5, 35)
      camera.lookAt(0, 0, 0)
      orbitControls.enableRotate = true
      orbitControls.autoRotate = true
      scene.fog = new THREE.FogExp2(0x000000, 0.015)
      scene.add(
        new THREE.Points(
          starGeom,
          new THREE.PointsMaterial({ color: 0x334466, size: 0.15, transparent: true, opacity: 0.6 })
        )
      )
    }
  }

  // Expose API to window
  (window as any).addNode = (id: string, label: string, tooltip?: string) =>
    nodesManager.addNode(id, label, tooltip, true)
  ;(window as any).addEdge = (walletA: string, walletB: string, sessionId: string, attestationCount?: number) =>
    edgesManager.addEdge(walletA, walletB, sessionId, attestationCount || 0)
  ;(window as any).toggle2DMode = () => setVisualizationMode(!is2DMode)
  ;(window as any).is2DMode = () => is2DMode
  ;(window as any).toggleCinema = () => {
    document.body.classList.toggle('cinema-mode')
    const btn = document.getElementById('btn-cinema')
    const active = document.body.classList.contains('cinema-mode')
    btn?.classList.toggle('active', active)
    btn!.textContent = active ? 'Exit Cinema (F)' : 'Cinema Mode (F)'
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('cinema-mode')) {
      (window as any).toggleCinema()
    }
  })
  ;(window as any).zoomIn = () => {
    autoCameraMode = false
    const currentDist = camera.position.length()
    const newDist = Math.max(orbitControls.minDistance, currentDist * 0.7)
    camera.position.normalize().multiplyScalar(newDist)
  }
  ;(window as any).zoomOut = () => {
    autoCameraMode = false
    const currentDist = camera.position.length()
    const newDist = Math.min(orbitControls.maxDistance, currentDist * 1.4)
    camera.position.normalize().multiplyScalar(newDist)
  }
  ;(window as any).toggleAutoCamera = () => {
    autoCameraMode = !autoCameraMode
  }
  ;(window as any).isAutoCamera = () => autoCameraMode
  ;(window as any).clearScene = () => {
    nodesManager.clearScene()
    edgesManager.clearEdges()
  }

  // Start WebSocket
  connectWS()

  return {
    nodesManager,
    edgesManager,
    physics,
    setVisualizationMode,
  }
}

// Auto-initialize if data attribute is present
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('network-canvas')
  if (container) {
    const configAttr = container.dataset.config
    const config = configAttr ? JSON.parse(configAttr) : {}
    createNetworkVisualization(container, config)
  }
})
