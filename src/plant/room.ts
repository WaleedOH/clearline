import * as THREE from 'three';
import { mat } from './materials';
import type { ItemType } from './items';

// Units are metres. The room is 16 x 12 m. The line is an L:
//   leg A runs east along z = -2: feeder → conveyor → labeler → corner turntable at (1.5, -2)
//   leg B runs south along x = 1.5: turntable → checkweigher (+ reject bin) → cartoner
// Belt tops are at y = 0.9 everywhere.

/** A flat surface where a leftover item can come to rest. */
export interface Spot {
  name: string;
  area: string;            // the line area a checklist belongs to
  x: [number, number];
  z: [number, number];
  y: number;               // surface height
  allowed: ItemType[];
  weight: number;          // how often scatter picks this spot
}

const SMALL: ItemType[] = ['tablet', 'capsule'];
const ALL: ItemType[] = ['tablet', 'capsule', 'label', 'vial', 'carton'];

const ROOM_W = 16, ROOM_D = 12, ROOM_H = 3.5;
const BELT_Y = 0.9;

function box(
  parent: THREE.Object3D, w: number, h: number, d: number,
  material: THREE.Material, x: number, y: number, z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D, r: number, h: number, material: THREE.Material,
  x: number, y: number, z: number, segments = 32,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function legs(parent: THREE.Object3D, xs: number[], zs: number[], height: number, size = 0.05) {
  for (const x of xs) for (const z of zs) box(parent, size, height, size, mat.steel, x, height / 2, z);
}

/** A group placed at (x, z) and turned so its local +z faces `rotY`. */
function placed(scene: THREE.Scene, name: string, x: number, z: number, rotY = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  return g;
}

function floorLine(scene: THREE.Scene, x1: number, z1: number, x2: number, z2: number) {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.06), mat.safetyYellow);
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(z2 - z1, x2 - x1);
  line.position.set((x1 + x2) / 2, 0.002, (z1 + z2) / 2);
  scene.add(line);
}

function whiteboardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7f8f9';
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#1d3f73';
  ctx.font = 'bold 28px Arial';
  ctx.fillText('LINE CLEARANCE', 24, 48);
  ctx.font = '18px Arial';
  ctx.fillStyle = '#333';
  ['Feeder & chute', 'Conveyor & guide rails', 'Labeler', 'Turntable', 'Checkweigher & reject bin', 'Cartoner infeed']
    .forEach((step, i) => {
      ctx.strokeStyle = '#333';
      ctx.strokeRect(28, 74 + i * 38, 18, 18);
      ctx.fillText(step, 60, 90 + i * 38);
    });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- room shell ----------------

function buildRoom(scene: THREE.Scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_H;
  scene.add(ceiling);

  const walls: [number, number, number, number][] = [
    // width, x, z, rotationY
    [ROOM_W, 0, -ROOM_D / 2, 0],
    [ROOM_W, 0, ROOM_D / 2, Math.PI],
    [ROOM_D, -ROOM_W / 2, 0, Math.PI / 2],
    [ROOM_D, ROOM_W / 2, 0, -Math.PI / 2],
  ];
  for (const [width, x, z, rot] of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, ROOM_H), mat.wall);
    wall.position.set(x, ROOM_H / 2, z);
    wall.rotation.y = rot;
    wall.receiveShadow = true;
    scene.add(wall);
    const kick = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.25), mat.steelDark);
    kick.position.set(x, 0.125, z);
    kick.rotation.y = rot;
    kick.translateZ(0.005);
    scene.add(kick);
  }

  for (const x of [-6, -2, 2, 6]) {
    for (const z of [-3.5, 0, 3.5]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), mat.lightPanel);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(x, ROOM_H - 0.01, z);
      scene.add(panel);
    }
  }

  // Walkway lines around the L.
  floorLine(scene, -7.4, -3.3, 3.4, -3.3);
  floorLine(scene, -7.4, -1.1, 0.7, -1.1);
  floorLine(scene, 0.7, -1.1, 0.7, 6);
  floorLine(scene, 3.4, -3.3, 3.4, 6);
  floorLine(scene, -7.4, -3.3, -7.4, -1.1);

  // Door (south wall), pass-through hatch (north wall), whiteboard (west wall).
  box(scene, 1.0, 2.1, 0.05, mat.panelWhite, 5.5, 1.05, ROOM_D / 2 - 0.03).castShadow = false;
  box(scene, 0.04, 0.3, 0.04, mat.steel, 5.15, 1.05, ROOM_D / 2 - 0.07);
  box(scene, 0.7, 0.6, 0.12, mat.steel, 4.5, 1.2, -ROOM_D / 2 + 0.06);
  box(scene, 0.55, 0.45, 0.01, mat.glass, 4.5, 1.2, -ROOM_D / 2 + 0.125).castShadow = false;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.0),
    new THREE.MeshStandardMaterial({ map: whiteboardTexture(), roughness: 0.4 }),
  );
  board.position.set(-ROOM_W / 2 + 0.035, 1.5, 2.2);
  board.rotation.y = Math.PI / 2;
  scene.add(board);
  box(scene, 0.03, 1.06, 1.66, mat.steel, -ROOM_W / 2 + 0.01, 1.5, 2.2).castShadow = false;
}

// ---------------- line equipment ----------------

/** A straight conveyor along local x, centred on the origin, with guide rails 3 cm above the belt edges. */
function conveyor(g: THREE.Group, length: number) {
  box(g, length, 0.12, 0.42, mat.steel, 0, 0.82, 0);
  box(g, length, 0.02, 0.34, mat.belt, 0, BELT_Y - 0.01, 0);
  for (const z of [0.15, -0.15]) {
    box(g, length, 0.04, 0.015, mat.steel, 0, 0.95, z);
    for (let x = -length / 2 + 0.3; x < length / 2; x += 0.75) {
      box(g, 0.02, 0.1, 0.02, mat.steel, x, 0.93, z + Math.sign(z) * 0.06);
      box(g, 0.02, 0.015, 0.07, mat.steel, x, 0.975, z + Math.sign(z) * 0.03);
    }
  }
  const legXs: number[] = [];
  for (let x = -length / 2 + 0.2; x <= length / 2 - 0.1; x += 1.5) legXs.push(x);
  legs(g, legXs, [-0.18, 0.18], 0.76);
}

function buildFeeder(scene: THREE.Scene) {
  const g = placed(scene, 'feeder', -6.5, -2);
  legs(g, [-0.2, 0.2], [-0.2, 0.2], 1.025);
  box(g, 0.5, 0.25, 0.5, mat.steel, 0, 1.15, 0);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.08, 0.55, 40, 1, true), mat.steelOpen);
  hopper.position.set(0, 1.55, 0);
  hopper.castShadow = true;
  g.add(hopper);
  // Chute onto the start of the conveyor, with side lips.
  box(g, 0.7, 0.02, 0.22, mat.steel, 0.45, 1.0, 0);
  box(g, 0.7, 0.04, 0.01, mat.steel, 0.45, 1.03, 0.11);
  box(g, 0.7, 0.04, 0.01, mat.steel, 0.45, 1.03, -0.11);
}

function buildLegA(scene: THREE.Scene) {
  const start = -6.0, end = 1.05;
  conveyor(placed(scene, 'conveyor-a', (start + end) / 2, -2), end - start);
}

function buildLabeler(scene: THREE.Scene) {
  // Sits on the north side of leg A; local +z points at the belt.
  const g = placed(scene, 'labeler', -2, -2.62);
  box(g, 0.6, 0.95, 0.4, mat.panelWhite, 0, 0.475, 0);
  box(g, 0.45, 0.25, 0.4, mat.steel, 0, 1.2, 0.24);           // applicator head over the belt edge
  box(g, 0.05, 0.25, 0.05, mat.steel, 0, 1.075, 0.06);
  box(g, 0.55, 0.75, 0.02, mat.steelDark, 0, 1.325, -0.19);   // back plate the rolls hang on
  const roll = cylinder(g, 0.15, 0.1, mat.labelRoll, -0.15, 1.55, -0.1, 40);
  roll.rotation.x = Math.PI / 2;
  cylinder(g, 0.04, 0.12, mat.steelDark, -0.15, 1.55, -0.1, 24).rotation.x = Math.PI / 2;
  cylinder(g, 0.07, 0.1, mat.steelDark, 0.18, 1.5, -0.1).rotation.x = Math.PI / 2;
}

function buildTurntable(scene: THREE.Scene) {
  const g = placed(scene, 'turntable', 1.5, -2);
  cylinder(g, 0.5, 0.12, mat.steel, 0, 0.82, 0, 48);
  cylinder(g, 0.45, 0.02, mat.steelDark, 0, BELT_Y - 0.01, 0, 48);
  // Curved fence around the outer corner keeps product on the disk. It leaves gaps on the
  // west (leg A comes in) and south (leg B goes out); theta 0 points south, PI / 2 east.
  const gap = 0.4;
  const fence = new THREE.Mesh(
    new THREE.CylinderGeometry(0.47, 0.47, 0.05, 48, 1, true, gap, Math.PI * 1.5 - 2 * gap), mat.steelOpen);
  fence.position.y = 0.95;
  fence.castShadow = true;
  g.add(fence);
  legs(g, [-0.25, 0.25], [-0.25, 0.25], 0.76);
}

function buildLegB(scene: THREE.Scene) {
  const start = -1.55, end = 4.1;
  // Rotating by -90° turns local +x into world +z.
  conveyor(placed(scene, 'conveyor-b', 1.5, (start + end) / 2, -Math.PI / 2), end - start);
}

function buildCheckweigher(scene: THREE.Scene) {
  const g = placed(scene, 'checkweigher', 1.5, 0.6);
  // Hood over the belt on two side pillars, plus the operator display on a post.
  box(g, 0.08, 0.5, 0.5, mat.panelWhite, -0.26, 1.0, 0);
  box(g, 0.08, 0.5, 0.5, mat.panelWhite, 0.26, 1.0, 0);
  box(g, 0.6, 0.06, 0.5, mat.panelWhite, 0, 1.28, 0);
  box(g, 0.05, 1.2, 0.05, mat.steel, 0.55, 0.6, -0.3);
  box(g, 0.32, 0.24, 0.06, mat.steelDark, 0.55, 1.3, -0.3);
  box(g, 0.26, 0.18, 0.005, mat.screen, 0.55, 1.3, -0.267);
}

function buildRejectBin(scene: THREE.Scene) {
  const g = placed(scene, 'reject-bin', 2.2, 0.9);
  const s = 0.3, wallH = 0.25, base = 0.6;
  legs(g, [-0.12, 0.12], [-0.12, 0.12], base - 0.01, 0.03);
  box(g, s, 0.01, s, mat.steel, 0, base, 0);
  box(g, s, wallH, 0.01, mat.steel, 0, base + wallH / 2, -s / 2);
  box(g, s, wallH, 0.01, mat.steel, 0, base + wallH / 2, s / 2);
  box(g, 0.01, wallH, s, mat.steel, -s / 2, base + wallH / 2, 0);
  box(g, 0.01, wallH, s, mat.steel, s / 2, base + wallH / 2, 0);
  // Reject chute from the belt down into the bin.
  const chute = box(g, 0.32, 0.01, 0.16, mat.steel, -0.3, 0.8, 0);
  chute.rotation.z = -0.5;
}

function buildCartoner(scene: THREE.Scene) {
  const g = placed(scene, 'cartoner', 1.5, 5.1);
  box(g, 1.3, 1.5, 1.6, mat.panelWhite, 0, 0.75, 0);
  box(g, 0.01, 0.6, 1.0, mat.glass, -0.656, 1.05, 0).castShadow = false;
  box(g, 0.4, 0.02, 0.5, mat.steel, 0, BELT_Y, -0.95);        // infeed plate, top at y = 0.91
}

// ---------------- operator furniture ----------------

/** Standing HMI computer: base, post, angled screen and keyboard tray. Faces local +z. */
function computerStand(scene: THREE.Scene, name: string, x: number, z: number, rotY: number) {
  const g = placed(scene, name, x, z, rotY);
  box(g, 0.45, 0.02, 0.45, mat.steelDark, 0, 0.01, 0);
  box(g, 0.08, 1.2, 0.08, mat.steel, 0, 0.6, 0);
  const housing = box(g, 0.5, 0.36, 0.07, mat.steelDark, 0, 1.42, 0.02);
  housing.rotation.x = -0.2;
  const screen = box(g, 0.44, 0.29, 0.005, mat.screen, 0, 1.425, 0.058);
  screen.rotation.x = -0.2;
  box(g, 0.48, 0.02, 0.22, mat.steel, 0, 1.08, 0.14);
  box(g, 0.4, 0.015, 0.13, mat.plasticDark, 0, 1.097, 0.15);
}

function buildQaDesk(scene: THREE.Scene) {
  // Against the south wall; local +z points into the room.
  const g = placed(scene, 'qa-desk', -5.5, 5.35, Math.PI);
  box(g, 1.6, 0.04, 0.7, mat.steel, 0, 0.73, 0);
  legs(g, [-0.75, 0.75], [-0.3, 0.3], 0.71, 0.04);
  box(g, 0.06, 0.02, 0.18, mat.plasticDark, 0.1, 0.76, -0.22);  // monitor foot
  box(g, 0.04, 0.3, 0.04, mat.plasticDark, 0.1, 0.9, -0.24);
  box(g, 0.6, 0.36, 0.03, mat.plasticDark, 0.1, 1.15, -0.22);
  box(g, 0.56, 0.32, 0.005, mat.screen, 0.1, 1.15, -0.204);
  box(g, 0.42, 0.015, 0.14, mat.plasticDark, 0.1, 0.758, 0.08);
  box(g, 0.06, 0.02, 0.1, mat.plasticDark, 0.42, 0.76, 0.08);
  box(g, 0.4, 0.22, 0.35, mat.panelWhite, -0.55, 0.86, -0.12);  // printer
  // Stool.
  cylinder(g, 0.2, 0.05, mat.seat, 0.1, 0.62, 0.55);
  cylinder(g, 0.025, 0.6, mat.steel, 0.1, 0.3, 0.55, 12);
  cylinder(g, 0.22, 0.02, mat.steelDark, 0.1, 0.01, 0.55);
}

function buildPackingTable(scene: THREE.Scene) {
  const g = placed(scene, 'packing-table', -2, 2.6);
  box(g, 1.6, 0.04, 0.8, mat.steel, 0, 0.9, 0);
  legs(g, [-0.75, 0.75], [-0.35, 0.35], 0.88);
  box(g, 1.5, 0.02, 0.7, mat.steel, 0, 0.2, 0);
  // Stack of flat shipper boxes kept on the lower shelf.
  for (let i = 0; i < 4; i++) box(g, 0.6, 0.03, 0.45, mat.cardboard, -0.3, 0.226 + i * 0.031, 0);
}

function buildTrolley(scene: THREE.Scene) {
  const g = placed(scene, 'trolley', -4.2, 0.2);
  for (const y of [0.3, 0.9]) {
    box(g, 0.9, 0.02, 0.5, mat.steel, 0, y, 0);
    box(g, 0.9, 0.04, 0.01, mat.steel, 0, y + 0.03, 0.25);
    box(g, 0.9, 0.04, 0.01, mat.steel, 0, y + 0.03, -0.25);
  }
  for (const x of [-0.43, 0.43]) for (const z of [-0.23, 0.23]) {
    box(g, 0.025, 0.86, 0.025, mat.steel, x, 0.5, z);
    cylinder(g, 0.04, 0.03, mat.rubber, x, 0.04, z, 16).rotation.z = Math.PI / 2;
  }
  box(g, 0.025, 0.25, 0.025, mat.steel, -0.47, 1.05, -0.2);
  box(g, 0.025, 0.25, 0.025, mat.steel, -0.47, 1.05, 0.2);
  box(g, 0.025, 0.025, 0.42, mat.steel, -0.47, 1.17, 0);
}

function buildStagingRack(scene: THREE.Scene) {
  // Components waiting for the next batch: label rolls and carton bundles, against the north wall.
  const g = placed(scene, 'staging-rack', -4.5, -5.6);
  for (const x of [-0.95, 0.95]) for (const z of [-0.22, 0.22]) box(g, 0.04, 1.9, 0.04, mat.steel, x, 0.95, z);
  const shelves = [0.15, 0.75, 1.35, 1.85];
  for (const y of shelves) box(g, 1.94, 0.03, 0.48, mat.steel, 0, y, 0);
  for (let i = 0; i < 4; i++) cylinder(g, 0.13, 0.1, mat.labelRoll, -0.7 + i * 0.3, 0.92, 0, 32).rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) box(g, 0.5, 0.3, 0.38, mat.cardboard, -0.6 + i * 0.6, 0.32, 0);
  box(g, 0.6, 0.25, 0.38, mat.cardboard, 0.5, 1.495, 0);
}

function buildBins(scene: THREE.Scene) {
  for (const [material, x] of [[mat.plasticYellow, -0.7], [mat.plasticBlue, -0.25]] as const) {
    cylinder(scene, 0.2, 0.6, material, x, 0.3, 3.5);
    cylinder(scene, 0.21, 0.04, mat.plasticDark, x, 0.62, 3.5);
  }
}

// ---------------- assembly ----------------

export function buildPlant(scene: THREE.Scene): Spot[] {
  buildRoom(scene);
  buildFeeder(scene);
  buildLegA(scene);
  buildLabeler(scene);
  buildTurntable(scene);
  buildLegB(scene);
  buildCheckweigher(scene);
  buildRejectBin(scene);
  buildCartoner(scene);

  computerStand(scene, 'hmi-feeder', -7.0, -1.1, Math.PI * 0.85);
  computerStand(scene, 'hmi-corner', 0.2, -0.6, Math.PI * 0.25);
  computerStand(scene, 'hmi-cartoner', 2.9, 3.4, -Math.PI / 2);
  buildQaDesk(scene);
  buildPackingTable(scene);
  buildTrolley(scene);
  buildStagingRack(scene);
  buildBins(scene);

  // A thin strip half under a guide rail, where tablets get trapped.
  const rail = (c: number): [number, number] => [c - 0.006, c + 0.006];
  return [
    { name: 'Feeder chute', area: 'Feeder', x: [-6.35, -5.8], z: [-2.08, -1.92], y: 1.01, allowed: SMALL, weight: 2 },
    { name: 'Floor by feeder', area: 'Floor', x: [-7.3, -6.9], z: [-2.6, -1.5], y: 0, allowed: ALL, weight: 1 },
    { name: 'Conveyor A (infeed)', area: 'Conveyor A', x: [-5.6, -3.5], z: [-2.12, -1.88], y: BELT_Y, allowed: ALL, weight: 2 },
    { name: 'Conveyor A (labeler)', area: 'Conveyor A', x: [-2.8, -1.2], z: [-2.12, -1.88], y: BELT_Y, allowed: ALL, weight: 2 },
    { name: 'Conveyor A (outfeed)', area: 'Conveyor A', x: [-1.0, 0.9], z: [-2.12, -1.88], y: BELT_Y, allowed: ALL, weight: 2 },
    { name: 'Under north rail (A)', area: 'Conveyor A', x: [-5.6, 0.9], z: rail(-2.146), y: BELT_Y, allowed: SMALL, weight: 2 },
    { name: 'Under south rail (A)', area: 'Conveyor A', x: [-5.6, 0.9], z: rail(-1.854), y: BELT_Y, allowed: SMALL, weight: 2 },
    { name: 'Floor under conveyor A', area: 'Floor', x: [-5.6, 0.6], z: [-2.12, -1.88], y: 0, allowed: ALL, weight: 1 },
    { name: 'Labeler deck', area: 'Labeler', x: [-2.25, -1.75], z: [-2.78, -2.62], y: 0.95, allowed: ALL, weight: 1 },
    { name: 'Turntable', area: 'Turntable', x: [1.2, 1.8], z: [-2.3, -1.7], y: BELT_Y, allowed: ALL, weight: 2 },
    { name: 'Conveyor B', area: 'Conveyor B', x: [1.38, 1.62], z: [-1.2, 3.8], y: BELT_Y, allowed: ALL, weight: 2 },
    { name: 'Under west rail (B)', area: 'Conveyor B', x: rail(1.354), z: [-1.2, 3.8], y: BELT_Y, allowed: SMALL, weight: 1 },
    { name: 'Under east rail (B)', area: 'Conveyor B', x: rail(1.646), z: [-1.2, 3.8], y: BELT_Y, allowed: SMALL, weight: 1 },
    { name: 'Floor under conveyor B', area: 'Floor', x: [1.38, 1.62], z: [-1.0, 3.6], y: 0, allowed: ALL, weight: 1 },
    { name: 'Reject bin', area: 'Checkweigher', x: [2.08, 2.32], z: [0.78, 1.02], y: 0.605, allowed: ALL, weight: 2 },
    { name: 'Cartoner infeed', area: 'Cartoner', x: [1.38, 1.62], z: [3.98, 4.3], y: 0.91, allowed: ALL, weight: 1 },
    { name: 'Packing table', area: 'Packing table', x: [-2.7, -1.3], z: [2.3, 2.9], y: 0.92, allowed: ALL, weight: 1 },
    { name: 'Trolley top shelf', area: 'Trolley', x: [-4.55, -3.85], z: [0.02, 0.38], y: 0.91, allowed: ALL, weight: 1 },
    { name: 'QA desk', area: 'QA desk', x: [-6.2, -4.8], z: [5.06, 5.16], y: 0.75, allowed: ALL, weight: 1 },
  ];
}
