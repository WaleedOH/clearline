import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPlant } from './plant/room';
import { Leftovers, type ItemType } from './plant/items';
import {
  CameraRenderer, CAPTURE_HEIGHT, CAPTURE_WIDTH, computeTruth, createPlantCameras, HELPER_LAYER, projectBounds,
  type PlantCamera, type TruthEntry,
} from './plant/cameras';
import { ChangeDetector, type Region } from './pipeline/change';
import { ControlRoom } from './ui/controlRoom';
import { PhoneFeeds } from './phone/feeds';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- renderer and scene ----------
const canvas = $<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde2e6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const HEMI = 0.4, SUN = 1.1, ENV = 0.45;
scene.environmentIntensity = ENV;
const hemi = new THREE.HemisphereLight(0xffffff, 0x6f767c, HEMI);
const sun = new THREE.DirectionalLight(0xfff8ee, SUN);   // stands in for the ceiling lights' shadows
sun.position.set(2, 8, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.002;
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7.5, bottom: -7.5, near: 0.5, far: 20 });
scene.add(hemi, sun);

const spots = buildPlant(scene);
const leftovers = new Leftovers(scene, spots);
const plantCams = createPlantCameras(scene);
const camRenderer = new CameraRenderer(renderer, scene);

// ---------- free view ----------
const freeCam = new THREE.PerspectiveCamera(55, 1, 0.02, 60);
freeCam.position.set(6.5, 6.5, 9.5);
freeCam.layers.enable(HELPER_LAYER);
const controls = new OrbitControls(freeCam, canvas);
controls.target.set(-1.2, 0.6, 0);
controls.update();

let lookingThrough: PlantCamera | null = null;
const throughCam = new THREE.PerspectiveCamera();

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  freeCam.aspect = w / h;
  freeCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- camera tiles ----------
const tiles = plantCams.map((cam) => {
  const el = document.createElement('div');
  el.className = 'tile';
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 216;
  const label = document.createElement('span');
  label.textContent = cam.id;
  el.title = `${cam.id} · ${cam.name}`;
  el.append(c, label);
  el.addEventListener('click', () => lookThrough(lookingThrough === cam ? null : cam));
  $('tiles').append(el);
  return { cam, el, canvas: c };
});

function lookThrough(cam: PlantCamera | null) {
  lookingThrough = cam;
  for (const t of tiles) t.el.classList.toggle('active', t.cam === cam);
  controls.enabled = !cam;
  $('view-label').textContent = cam
    ? `Looking through ${cam.id} · ${cam.name} · click the tile again for free view`
    : 'Free view · drag to orbit, scroll to zoom';
}

// ---------- hidden-item pins (free view only) ----------
const pinMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
const pins = new Map<string, THREE.Object3D>();
let pinsVisible = false;

function syncPins() {
  for (const [id, pin] of pins) {
    if (!leftovers.items.some((it) => it.id === id)) { scene.remove(pin); pins.delete(id); }
  }
  for (const it of leftovers.items) {
    if (pins.has(it.id)) continue;
    const pin = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.25, 8), pinMat);
    stick.position.y = 0.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), pinMat);
    head.position.y = 0.28;
    pin.add(stick, head);
    pin.position.copy(it.object.position);
    pin.traverse((o) => o.layers.set(HELPER_LAYER));
    pin.visible = pinsVisible;
    scene.add(pin);
    pins.set(it.id, pin);
  }
}

// ---------- ground truth list ----------
let truth: TruthEntry[] = [];

function refreshTruth() {
  truth = computeTruth(scene, plantCams, leftovers.items);
  const list = $('truth');
  list.replaceChildren();
  if (!truth.length) {
    list.innerHTML = '<li class="empty">Line is clear. Nothing hidden yet.</li>';
    return;
  }
  for (const t of truth) {
    const li = document.createElement('li');
    const seen = t.sightings.length
      ? `<span class="seen">seen by ${t.sightings.map((s) => `${s.cameraId} (${s.pixels}px)`).join(', ')}</span>`
      : '<span class="blind">no camera can see this: blind spot</span>';
    li.innerHTML = `<b>${t.type}</b> · ${t.spot}<br>${seen}`;
    list.append(li);
  }
}

// ---------- controls ----------
$('scatter').addEventListener('click', () => { leftovers.scatter(3); syncPins(); refreshTruth(); });
$('clear').addEventListener('click', () => { leftovers.clear(); syncPins(); refreshTruth(); });

let dim = false;
$('lights').addEventListener('click', (e) => {
  dim = !dim;
  const k = dim ? 0.35 : 1;
  hemi.intensity = HEMI * k;
  sun.intensity = SUN * k;
  scene.environmentIntensity = ENV * k;
  const btn = e.currentTarget as HTMLButtonElement;
  btn.textContent = `Lights: ${dim ? 'dim' : 'normal'}`;
  btn.classList.toggle('on', dim);
});

$('pins').addEventListener('click', (e) => {
  pinsVisible = !pinsVisible;
  for (const pin of pins.values()) pin.visible = pinsVisible;
  (e.currentTarget as HTMLButtonElement).classList.toggle('on', pinsVisible);
});

function captureAll() {
  refreshTruth();
  return plantCams.map((cam) => ({ cameraId: cam.id, name: cam.name, png: camRenderer.capture(cam) }));
}

$('capture').addEventListener('click', async () => {
  const frames = captureAll();
  const grid = $('capture-grid');
  grid.replaceChildren();
  for (const frame of frames) {
    const img = new Image();
    img.src = frame.png;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.strokeStyle = '#3ccf7a';
    ctx.lineWidth = 3;
    for (const t of truth) {
      for (const s of t.sightings.filter((s) => s.cameraId === frame.cameraId)) {
        ctx.strokeRect(s.box.x1 - 4, s.box.y1 - 4, s.box.x2 - s.box.x1 + 8, s.box.y2 - s.box.y1 + 8);
      }
    }
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.innerHTML = `<span>${frame.cameraId} · ${frame.name}</span>`
      + `<a href="${frame.png}" download="${frame.cameraId}.png">Save PNG</a>`;
    fig.append(c, cap);
    grid.append(fig);
  }
  const truthBlob = new Blob([JSON.stringify(truth, null, 2)], { type: 'application/json' });
  $<HTMLAnchorElement>('save-truth').href = URL.createObjectURL(truthBlob);
  $<HTMLDialogElement>('captures').showModal();
});
$('close-captures').addEventListener('click', () => $<HTMLDialogElement>('captures').close());

// ---------- line clearance: stage 1, change detection ----------
const detector = new ChangeDetector();
const changes = new Map<string, Region[]>();
const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function setTileStatus(cameraId: string, status: 'clear' | 'change' | '') {
  const tile = tiles.find((t) => t.cam.id === cameraId)!;
  tile.el.dataset.status = status;
}

function markClean() {
  for (const cam of plantCams) {
    detector.setReference(cam.id, camRenderer.captureCanvas(cam));
    setTileStatus(cam.id, 'clear');
  }
  changes.clear();
  $<HTMLButtonElement>('run-scan').disabled = false;
  $('scan-summary').innerHTML = `Clean reference saved for all ${plantCams.length} cameras at ${time()}.`;
}

function runScan() {
  const started = performance.now();
  changes.clear();
  for (const cam of plantCams) {
    const regions = detector.detect(cam.id, camRenderer.captureCanvas(cam));
    if (regions.length) changes.set(cam.id, regions);
    setTileStatus(cam.id, regions.length ? 'change' : 'clear');
  }
  const ms = Math.round(performance.now() - started);
  const flagged = [...changes.entries()];
  $('scan-summary').innerHTML = flagged.length
    ? `<b>${flagged.length} camera(s) saw changes</b> at ${time()}: `
      + flagged.map(([id, r]) => `${id} (${r.length})`).join(', ')
      + `. Next, SAM 3.1 checks what they are. <span class="hint">${ms} ms</span>`
    : `<b>No changes on any camera</b> at ${time()}. <span class="hint">${ms} ms</span>`;
  return changes;
}

$('mark-clean').addEventListener('click', markClean);
$('run-scan').addEventListener('click', runScan);

/**
 * Scores stage 1 against the simulator's ground truth: over `rounds` random scenarios, how many
 * camera sightings of a leftover overlap a changed region, and how many regions match nothing.
 */
function evaluateChangeDetection(rounds = 20, itemsPerRound = 4) {
  leftovers.clear();
  markClean();
  let sightings = 0, caught = 0, items = 0, visibleItems = 0, itemsCaught = 0;
  let regions = 0, smallOrHidden = 0, falseAlarms = 0;
  const overlaps = (r: Region, b: { x1: number; y1: number; x2: number; y2: number }, pad = 0) =>
    r.x1 < b.x2 + pad && r.x2 > b.x1 - pad && r.y1 < b.y2 + pad && r.y2 > b.y1 - pad;
  for (let round = 0; round < rounds; round++) {
    leftovers.scatter(itemsPerRound);
    refreshTruth();
    const found = runScan();
    for (const t of truth) {
      items++;
      if (t.sightings.length) visibleItems++;
      let anyCaught = false;
      for (const s of t.sightings) {
        sightings++;
        if ((found.get(s.cameraId) ?? []).some((r) => overlaps(r, s.box))) { caught++; anyCaught = true; }
      }
      if (anyCaught) itemsCaught++;
    }
    // Every region either matches a visible item, comes from an item that is real but too small or
    // mostly hidden (shadow, a sliver), or is a false alarm with no item anywhere near it.
    for (const [cameraId, rs] of found) {
      const cam = plantCams.find((c) => c.id === cameraId)!;
      const anywhere = leftovers.items
        .map((it) => projectBounds(new THREE.Box3().setFromObject(it.object), cam.camera))
        .filter((p) => p !== null);
      for (const r of rs) {
        regions++;
        if (truth.some((t) => t.sightings.some((s) => s.cameraId === cameraId && overlaps(r, s.box)))) continue;
        if (anywhere.some((p) => overlaps(r, p.box, 20))) smallOrHidden++;
        else falseAlarms++;
      }
    }
    leftovers.clear();
  }
  syncPins();
  refreshTruth();
  runScan();
  return { rounds, items, visibleItems, itemsCaught, sightings, caught, regions, smallOrHidden, falseAlarms };
}

// ---------- blind spots: which hiding spots the cameras can't fully see ----------
/** Places test tablets on a grid across every spot and measures how many any camera can see. */
function measureCoverage() {
  const result: { spot: string; area: string; coverage: number }[] = [];
  for (const spot of spots) {
    const probes = [];
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fz of [0.15, 0.5, 0.85]) {
        const x = spot.x[0] + fx * (spot.x[1] - spot.x[0]);
        const z = spot.z[0] + fz * (spot.z[1] - spot.z[0]);
        probes.push(leftovers.place('tablet', spot, x, z));
      }
    }
    const seen = computeTruth(scene, plantCams, probes).filter((t) => t.sightings.length).length;
    for (const p of probes) leftovers.remove(p.id);
    result.push({ spot: spot.name, area: spot.area, coverage: seen / probes.length });
  }
  return result;
}
const coverage = measureCoverage();
const blindSpots = coverage.filter((c) => c.coverage < 0.75);
Object.assign(window, { clearlineCoverage: coverage });

/** Simulator stand-in for an operator picking up whatever lies under a region. */
function simulateRemoval(cameraId: string, region: Region): number {
  const cam = plantCams.find((c) => c.id === cameraId)!;
  let removed = 0;
  for (const it of [...leftovers.items]) {
    const p = projectBounds(new THREE.Box3().setFromObject(it.object), cam.camera);
    if (p && p.box.x1 < region.x2 + 10 && p.box.x2 > region.x1 - 10 && p.box.y1 < region.y2 + 10 && p.box.y2 > region.y1 - 10) {
      leftovers.remove(it.id);
      removed++;
    }
  }
  syncPins();
  refreshTruth();
  return removed;
}

const locateRay = new THREE.Raycaster();
locateRay.layers.set(0);

/**
 * Where a camera region is in the room. The cameras are calibrated (we know their pose), so a ray
 * through the region's centre lands on the surface the change sits on.
 */
function locate(cameraId: string, region: Region): { location: [number, number, number]; where: string } | null {
  const cam = plantCams.find((c) => c.id === cameraId)!;
  const ndc = new THREE.Vector2(
    ((region.x1 + region.x2) / 2 / CAPTURE_WIDTH) * 2 - 1,
    1 - ((region.y1 + region.y2) / 2 / CAPTURE_HEIGHT) * 2,
  );
  locateRay.setFromCamera(ndc, cam.camera);
  const hit = locateRay.intersectObjects(scene.children, true)[0];
  if (!hit) return null;
  const p = hit.point;
  let best = { name: '', d: Infinity };
  for (const s of spots) {
    const dx = Math.max(s.x[0] - p.x, 0, p.x - s.x[1]);
    const dz = Math.max(s.z[0] - p.z, 0, p.z - s.z[1]);
    const d = Math.hypot(dx, dz, p.y - s.y);
    if (d < best.d) best = { name: s.name, d };
  }
  const where = best.d < 0.5 ? best.name : `Room floor near (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) m`;
  return { location: [p.x, p.y, p.z], where };
}

// Real phone cameras join the control room alongside the simulated ones.
const phoneFeeds = new PhoneFeeds((feed) => controlRoom.addCamera(feed));
const plantCamById = new Map(plantCams.map((c) => [c.id, c]));

const controlRoom = new ControlRoom({
  // Phones aren't calibrated, so they have no room location and nothing to remove in the simulator.
  locate: (cameraId, region) => (plantCamById.has(cameraId) ? locate(cameraId, region) : null),
  simulateRemoval: (cameraId, region) => (plantCamById.has(cameraId) ? simulateRemoval(cameraId, region) : 0),
  cams: plantCams,
  draw: (cam, canvas) => {
    const plant = plantCamById.get(cam.id);
    if (plant) camRenderer.drawTo(plant, canvas); else phoneFeeds.draw(cam.id, canvas);
  },
  capture: (cam) => {
    const plant = plantCamById.get(cam.id);
    return plant ? camRenderer.captureCanvas(plant) : phoneFeeds.capture(cam.id);
  },
  detector,
  blindSpots,
  apiStatus: async () => {
    try {
      const s = await (await fetch('/api/status')).json();
      return { connected: s.metaApi === true, standIn: s.testStandIn === true, phone: s.phone };
    } catch {
      return { connected: false, standIn: false };
    }
  },
  onExit: () => controlRoom.hide(),
});
$('open-control').addEventListener('click', () => controlRoom.show());

// The simulated line starts clean, so every camera can save its clean reference right away.
markClean();

async function refreshApiStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    $('api-status').textContent = s.metaApi
      ? `Meta API connected · ${s.samCalls}/${s.samCallLimit} SAM calls used (≈ $${s.estimatedCostUsd})`
      : 'Meta API not connected yet: waiting for the API key. Change detection works without it.';
  } catch {
    $('api-status').textContent = 'Local API not reachable.';
  }
}
refreshApiStatus();

// Handle for scripts and tests.
Object.assign(window, {
  clearline: {
    scatter: (n = 3) => { const r = leftovers.scatter(n); syncPins(); refreshTruth(); return r.map((i) => i.id); },
    /** Puts one item in the middle of a named spot, e.g. place('tablet', 'Packing table'). */
    place: (type: ItemType, spotName: string) => {
      const spot = spots.find((s) => s.name === spotName);
      if (!spot) throw new Error(`No spot named ${spotName}`);
      const it = leftovers.place(type, spot, (spot.x[0] + spot.x[1]) / 2, (spot.z[0] + spot.z[1]) / 2);
      syncPins();
      refreshTruth();
      return it.id;
    },
    /** One camera's current view as a JPEG data URL, as a phone would send it. */
    jpeg: (cameraId: string) => camRenderer.captureCanvas(plantCamById.get(cameraId)!).toDataURL('image/jpeg', 0.85),
    clear: () => { leftovers.clear(); syncPins(); refreshTruth(); },
    capture: captureAll,
    truth: () => truth,
    markClean,
    scan: () => Object.fromEntries(runScan()),
    evaluateChangeDetection,
    /** Internals, for tests in the browser console. */
    debug: { detector, phoneFeeds },
  },
});

// ---------- loop ----------
let tileIndex = 0;
renderer.setAnimationLoop(() => {
  // The control room covers the whole screen, so only its camera tiles need drawing.
  if (controlRoom.visible) {
    controlRoom.drawNext();
    return;
  }
  // Refresh one camera tile per frame; at 60 fps each tile updates about five times a second.
  const tile = tiles[tileIndex++ % tiles.length];
  camRenderer.drawTo(tile.cam, tile.canvas);
  const regions = changes.get(tile.cam.id);
  if (regions) {
    const ctx = tile.canvas.getContext('2d')!;
    const k = tile.canvas.width / CAPTURE_WIDTH;
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth = 2;
    for (const r of regions) ctx.strokeRect(r.x1 * k, r.y1 * k, (r.x2 - r.x1) * k, (r.y2 - r.y1) * k);
  }

  if (lookingThrough) {
    throughCam.copy(lookingThrough.camera);
    throughCam.aspect = freeCam.aspect;
    throughCam.updateProjectionMatrix();
    renderer.render(scene, throughCam);
  } else {
    controls.update();
    renderer.render(scene, freeCam);
  }
});
