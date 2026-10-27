import * as THREE from 'three';
import { mat } from './materials';
import type { ItemType } from './items';

// Units are metres. The line runs along the x axis: feeder (west) → conveyor → labeler → cartoner (east).

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

function legs(parent: THREE.Object3D, xs: number[], zs: number[], height: number, size = 0.05) {
  for (const x of xs) for (const z of zs) box(parent, size, height, size, mat.steel, x, height / 2, z);
}

function buildRoom(scene: THREE.Scene) {
  const W = 12, D = 8, H = 3.5;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  scene.add(ceiling);

  const walls: [number, number, number, number, number][] = [
    // width, x, z, rotationY
    [W, 0, -D / 2, 0, 0],
    [W, 0, D / 2, Math.PI, 0],
    [D, -W / 2, 0, Math.PI / 2, 0],
    [D, W / 2, 0, -Math.PI / 2, 0],
  ];
  for (const [width, x, z, rot] of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width, H), mat.wall);
    wall.position.set(x, H / 2, z);
    wall.rotation.y = rot;
    wall.receiveShadow = true;
    scene.add(wall);
    // Steel kick plate along the bottom of each wall, common in cleanrooms.
    const kick = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.25), mat.steelDark);
    kick.position.set(x, 0.125, z);
    kick.rotation.y = rot;
    kick.translateZ(0.005);
    scene.add(kick);
  }

  // Yellow walkway lines on the floor around the line.
  for (const z of [-1.1, 1.1]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 0.06), mat.safetyYellow);
    line.rotation.x = -Math.PI / 2;
    line.position.set(-0.2, 0.002, z);
    scene.add(line);
  }

  // Recessed ceiling light panels.
  for (const x of [-4, 0, 4]) {
    for (const z of [-2, 2]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), mat.lightPanel);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(x, H - 0.01, z);
      scene.add(panel);
    }
  }

  // Door on the south wall and a tall cabinet on the north wall.
  const door = box(scene, 1.0, 2.1, 0.05, mat.panelWhite, -4.5, 1.05, D / 2 - 0.03);
  door.castShadow = false;
  box(scene, 0.04, 0.3, 0.04, mat.steel, -4.15, 1.05, D / 2 - 0.07);
  box(scene, 1.2, 2.0, 0.5, mat.panelWhite, 3.5, 1.0, -D / 2 + 0.26);
}

function buildFeeder(scene: THREE.Scene) {
  const g = new THREE.Group();
  g.name = 'feeder';
  scene.add(g);
  legs(g, [-4.2, -3.8], [-0.2, 0.2], 1.025);
  box(g, 0.5, 0.25, 0.5, mat.steel, -4, 1.15, 0);

  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.08, 0.55, 40, 1, true), mat.steelOpen);
  hopper.position.set(-4, 1.55, 0);
  hopper.castShadow = true;
  g.add(hopper);

  // Chute from the feeder down onto the start of the conveyor, with side lips.
  box(g, 0.7, 0.02, 0.22, mat.steel, -3.55, 1.0, 0);
  box(g, 0.7, 0.04, 0.01, mat.steel, -3.55, 1.03, 0.11);
  box(g, 0.7, 0.04, 0.01, mat.steel, -3.55, 1.03, -0.11);

  // Control panel with a screen.
  box(g, 0.05, 0.9, 0.05, mat.steel, -4.55, 0.45, 0.45);
  box(g, 0.08, 0.3, 0.4, mat.steelDark, -4.55, 1.05, 0.45);
  box(g, 0.01, 0.22, 0.3, mat.screen, -4.505, 1.06, 0.45);
}

function buildConveyor(scene: THREE.Scene) {
  const g = new THREE.Group();
  g.name = 'conveyor';
  scene.add(g);
  const length = 6, cx = -0.4;
  box(g, length, 0.12, 0.42, mat.steel, cx, 0.82, 0);
  box(g, length, 0.02, 0.34, mat.belt, cx, 0.89, 0);   // belt top surface at y = 0.90
  // Guide rails sit 3 cm above the belt edges, leaving a gap where tablets get trapped.
  for (const z of [0.15, -0.15]) {
    box(g, length, 0.04, 0.015, mat.steel, cx, 0.95, z);
    for (let x = cx - length / 2 + 0.3; x < cx + length / 2; x += 0.75) {
      box(g, 0.02, 0.1, 0.02, mat.steel, x, 0.93, z + Math.sign(z) * 0.06);
      box(g, 0.02, 0.015, 0.07, mat.steel, x, 0.975, z + Math.sign(z) * 0.03);
    }
  }
  legs(g, [-3.2, -1.7, -0.2, 1.3, 2.4], [-0.18, 0.18], 0.76);
}

function buildLabeler(scene: THREE.Scene) {
  const g = new THREE.Group();
  g.name = 'labeler';
  scene.add(g);
  box(g, 0.6, 0.95, 0.4, mat.panelWhite, 0.3, 0.475, -0.62);
  box(g, 0.45, 0.25, 0.4, mat.steel, 0.3, 1.2, -0.38);         // applicator head over the belt edge
  box(g, 0.05, 0.25, 0.05, mat.steel, 0.3, 1.075, -0.6);
  box(g, 0.55, 0.75, 0.02, mat.steelDark, 0.3, 1.325, -0.7);  // back plate the rolls hang on

  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 40), mat.labelRoll);
  roll.rotation.x = Math.PI / 2;
  roll.position.set(0.15, 1.55, -0.62);
  roll.castShadow = true;
  g.add(roll);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 24), mat.steelDark);
  core.rotation.x = Math.PI / 2;
  core.position.copy(roll.position);
  g.add(core);
  const rewind = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 32), mat.steelDark);
  rewind.rotation.x = Math.PI / 2;
  rewind.position.set(0.48, 1.5, -0.62);
  g.add(rewind);
}

function buildRejectBin(scene: THREE.Scene) {
  const g = new THREE.Group();
  g.name = 'reject-bin';
  scene.add(g);
  const x = 1.6, z = 0.5, s = 0.3, wallH = 0.25, base = 0.6;
  legs(g, [x - 0.12, x + 0.12], [z - 0.12, z + 0.12], base - 0.01, 0.03);
  box(g, s, 0.01, s, mat.steel, x, base, z);
  box(g, s, wallH, 0.01, mat.steel, x, base + wallH / 2, z - s / 2);
  box(g, s, wallH, 0.01, mat.steel, x, base + wallH / 2, z + s / 2);
  box(g, 0.01, wallH, s, mat.steel, x - s / 2, base + wallH / 2, z);
  box(g, 0.01, wallH, s, mat.steel, x + s / 2, base + wallH / 2, z);
}

function buildCartoner(scene: THREE.Scene) {
  const g = new THREE.Group();
  g.name = 'cartoner';
  scene.add(g);
  box(g, 1.8, 1.5, 1.1, mat.panelWhite, 3.7, 0.75, 0);
  box(g, 1.2, 0.6, 0.01, mat.glass, 3.7, 1.05, 0.556).castShadow = false;
  box(g, 0.6, 0.02, 0.4, mat.steel, 2.75, 0.9, 0);             // infeed plate, top at y = 0.91
  box(g, 0.08, 0.3, 0.4, mat.steelDark, 2.85, 1.25, 0.6);
  box(g, 0.01, 0.22, 0.3, mat.screen, 2.805, 1.26, 0.6);
}

function buildPackingTable(scene: THREE.Scene) {
  const g = new THREE.Group();
  g.name = 'packing-table';
  scene.add(g);
  box(g, 1.6, 0.04, 0.8, mat.steel, -1.2, 0.9, 2.4);
  legs(g, [-1.95, -0.45], [2.05, 2.75], 0.88);
  box(g, 1.5, 0.02, 0.7, mat.steel, -1.2, 0.2, 2.4);           // lower shelf
}

export function buildPlant(scene: THREE.Scene): Spot[] {
  buildRoom(scene);
  buildFeeder(scene);
  buildConveyor(scene);
  buildLabeler(scene);
  buildRejectBin(scene);
  buildCartoner(scene);
  buildPackingTable(scene);

  return [
    { name: 'Feeder chute', area: 'Feeder', x: [-3.85, -3.3], z: [-0.08, 0.08], y: 1.01, allowed: SMALL, weight: 2 },
    { name: 'Conveyor belt (infeed)', area: 'Conveyor', x: [-3.1, -1.0], z: [-0.12, 0.12], y: 0.9, allowed: ALL, weight: 2 },
    { name: 'Conveyor belt (outfeed)', area: 'Conveyor', x: [0.8, 2.4], z: [-0.12, 0.12], y: 0.9, allowed: ALL, weight: 2 },
    { name: 'Under north guide rail', area: 'Conveyor', x: [-3.1, 2.4], z: [0.14, 0.152], y: 0.9, allowed: SMALL, weight: 2 },
    { name: 'Under south guide rail', area: 'Conveyor', x: [-3.1, 2.4], z: [-0.152, -0.14], y: 0.9, allowed: SMALL, weight: 2 },
    { name: 'Labeler deck', area: 'Labeler', x: [0.05, 0.55], z: [-0.8, -0.6], y: 0.95, allowed: ALL, weight: 1 },
    { name: 'Reject bin', area: 'Reject bin', x: [1.48, 1.72], z: [0.38, 0.62], y: 0.605, allowed: ALL, weight: 2 },
    { name: 'Cartoner infeed', area: 'Cartoner', x: [2.6, 2.98], z: [-0.15, 0.15], y: 0.91, allowed: ALL, weight: 1 },
    { name: 'Packing table', area: 'Packing table', x: [-1.9, -0.5], z: [2.1, 2.7], y: 0.92, allowed: ALL, weight: 1 },
    { name: 'Floor under conveyor', area: 'Floor', x: [-3.0, 2.2], z: [-0.12, 0.12], y: 0, allowed: ALL, weight: 1 },
    { name: 'Floor by feeder', area: 'Floor', x: [-4.8, -4.35], z: [-0.6, 0.6], y: 0, allowed: ALL, weight: 1 },
  ];
}
