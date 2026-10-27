import * as THREE from 'three';
import type { Spot } from './room';

export type ItemType = 'tablet' | 'capsule' | 'label' | 'vial' | 'carton';

/** One leftover item placed in the plant. The simulator always knows exactly where it is. */
export interface PlacedItem {
  id: string;
  type: ItemType;
  spot: string;
  area: string;
  object: THREE.Object3D;
}

const tabletMat = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.55 });
const capsuleMats = [
  [0x2f6fd1, 0xf2f2f2],
  [0xc8402f, 0xf0c53a],
  [0x2e9a5b, 0xf2f2f2],
].map(([a, b]) => [
  new THREE.MeshStandardMaterial({ color: a, roughness: 0.3 }),
  new THREE.MeshStandardMaterial({ color: b, roughness: 0.3 }),
]);
const vialGlass = new THREE.MeshStandardMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.55, roughness: 0.05 });
const vialCap = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.8, roughness: 0.35 });

// Every product name and batch number here is made up.
const PRODUCTS = [
  { name: 'DEMOZOL 10 mg', lot: 'LX-2041', color: '#1d5fb8' },
  { name: 'FICTAMIDE 25 mg', lot: 'QB-7713', color: '#b8361d' },
];

function printTexture(product: (typeof PRODUCTS)[number], w: number, h: number, carton: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = product.color;
  ctx.fillRect(0, 0, w, h * (carton ? 0.35 : 0.22));
  ctx.fillStyle = carton ? '#ffffff' : '#111111';
  ctx.font = `bold ${Math.round(h * 0.16)}px Arial`;
  ctx.fillText(product.name, w * 0.05, carton ? h * 0.24 : h * 0.45);
  ctx.fillStyle = '#222222';
  ctx.font = `${Math.round(h * 0.11)}px Arial`;
  ctx.fillText(`LOT ${product.lot}   EXP 11/2028`, w * 0.05, h * 0.68);
  for (let i = 0; i < 28; i++) {                       // barcode
    const bw = 1 + Math.floor(Math.random() * 3);
    ctx.fillRect(w * 0.55 + i * 4, h * 0.76, bw, h * 0.18);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const labelMats = PRODUCTS.map((p) => new THREE.MeshStandardMaterial({
  map: printTexture(p, 256, 128, false), roughness: 0.6, side: THREE.DoubleSide,
}));
const cartonMats = PRODUCTS.map((p) => new THREE.MeshStandardMaterial({
  map: printTexture(p, 256, 128, true), roughness: 0.7,
}));

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
  return o;
}

/** Builds the item resting on y = 0 at its own origin. */
function makeItem(type: ItemType): THREE.Object3D {
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  switch (type) {
    case 'tablet': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.0035, 28), tabletMat);
      m.position.y = 0.00175;
      return shadowed(new THREE.Group().add(m));
    }
    case 'capsule': {
      const [a, b] = pick(capsuleMats);
      const g = new THREE.Group();
      for (const [material, offset] of [[a, -0.0035], [b, 0.0035]] as const) {
        const half = new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.007, 6, 16), material);
        half.rotation.z = Math.PI / 2;
        half.position.set(offset, 0.0035, 0);
        g.add(half);
      }
      return shadowed(g);
    }
    case 'label': {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), pick(labelMats));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.0008;
      return shadowed(new THREE.Group().add(m));
    }
    case 'vial': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.045, 28), vialGlass);
      body.position.y = 0.0225;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 28), vialCap);
      cap.position.y = 0.049;
      g.add(body, cap);
      if (Math.random() < 0.5) {                        // knocked over
        g.rotation.z = Math.PI / 2;
        g.position.y = 0.012;
        return shadowed(new THREE.Group().add(g));
      }
      return shadowed(g);
    }
    case 'carton': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.05), pick(cartonMats));
      m.position.y = 0.015;
      return shadowed(new THREE.Group().add(m));
    }
  }
}

function weightedSpot(spots: Spot[]): Spot {
  const total = spots.reduce((s, sp) => s + sp.weight, 0);
  let r = Math.random() * total;
  for (const sp of spots) if ((r -= sp.weight) <= 0) return sp;
  return spots[spots.length - 1];
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class Leftovers {
  readonly items: PlacedItem[] = [];
  private readonly group = new THREE.Group();
  private counter = 0;

  constructor(scene: THREE.Scene, private readonly spots: Spot[]) {
    this.group.name = 'leftovers';
    scene.add(this.group);
  }

  /** Hides `count` leftover items at random spots. */
  scatter(count: number): PlacedItem[] {
    const added: PlacedItem[] = [];
    for (let i = 0; i < count; i++) {
      const spot = weightedSpot(this.spots);
      const type = spot.allowed[Math.floor(Math.random() * spot.allowed.length)];
      added.push(this.place(type, spot, rand(spot.x[0], spot.x[1]), rand(spot.z[0], spot.z[1])));
    }
    return added;
  }

  place(type: ItemType, spot: Spot, x: number, z: number): PlacedItem {
    const object = makeItem(type);
    object.position.x = x;
    object.position.z = z;
    object.position.y += spot.y;
    object.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(object);
    const item: PlacedItem = { id: `item-${++this.counter}`, type, spot: spot.name, area: spot.area, object };
    object.userData.itemId = item.id;
    this.items.push(item);
    return item;
  }

  remove(id: string) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0) return;
    this.group.remove(this.items[i].object);
    this.items.splice(i, 1);
  }

  clear() {
    for (const it of [...this.items]) this.remove(it.id);
  }
}
