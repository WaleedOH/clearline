import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPlant } from './plant/room';
import { Leftovers } from './plant/items';
import {
  CameraRenderer, computeTruth, createPlantCameras, HELPER_LAYER, type PlantCamera, type TruthEntry,
} from './plant/cameras';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- renderer and scene ----------
const canvas = $<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdde2e6);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const HEMI = 0.4, SUN = 1.1, ENV = 0.45;
scene.environmentIntensity = ENV;
const hemi = new THREE.HemisphereLight(0xffffff, 0x6f767c, HEMI);
const sun = new THREE.DirectionalLight(0xfff8ee, SUN);   // stands in for the ceiling lights' shadows
sun.position.set(2, 6, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.002;
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 5, bottom: -5, near: 0.5, far: 15 });
scene.add(hemi, sun);

const spots = buildPlant(scene);
const leftovers = new Leftovers(scene, spots);
const plantCams = createPlantCameras(scene);
const camRenderer = new CameraRenderer(renderer, scene);

// ---------- free view ----------
const freeCam = new THREE.PerspectiveCamera(55, 1, 0.02, 60);
freeCam.position.set(3.2, 3.0, 4.6);
freeCam.layers.enable(HELPER_LAYER);
const controls = new OrbitControls(freeCam, canvas);
controls.target.set(-0.4, 0.9, 0);
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
  label.textContent = `${cam.id} · ${cam.name}`;
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

// Handle for scripts and the upcoming detection pipeline.
Object.assign(window, {
  clearline: {
    scatter: (n = 3) => { const r = leftovers.scatter(n); syncPins(); refreshTruth(); return r.map((i) => i.id); },
    clear: () => { leftovers.clear(); syncPins(); refreshTruth(); },
    capture: captureAll,
    truth: () => truth,
  },
});

// ---------- loop ----------
let tileIndex = 0;
renderer.setAnimationLoop(() => {
  // Refresh one camera tile per frame; at 60 fps each tile updates ten times a second.
  const tile = tiles[tileIndex++ % tiles.length];
  camRenderer.drawTo(tile.cam, tile.canvas);

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
