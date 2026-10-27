import * as THREE from 'three';
import type { PlacedItem } from './items';

/** Layer 1 holds helpers (camera bodies, truth pins) that only the free view sees, never the plant cameras. */
export const HELPER_LAYER = 1;

export const CAPTURE_WIDTH = 1280;
export const CAPTURE_HEIGHT = 720;
/** Below this size (in capture pixels) an item is too small for any detector to see reliably. */
const MIN_PIXELS = 6;

export interface PlantCameraDef {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export const CAMERA_DEFS: PlantCameraDef[] = [
  { id: 'CAM-1', name: 'Room, north-east corner', position: [5.6, 3.1, 3.6], target: [-0.5, 0.6, 0], fov: 70 },
  { id: 'CAM-2', name: 'Room, south-west corner', position: [-5.6, 3.1, -3.6], target: [0, 0.6, 0.5], fov: 70 },
  { id: 'CAM-3', name: 'Feeder & chute', position: [-3.55, 1.45, 0.5], target: [-3.6, 0.95, 0], fov: 55 },
  { id: 'CAM-4', name: 'Conveyor infeed', position: [-3.0, 1.35, 0], target: [-1.6, 0.9, 0], fov: 60 },
  { id: 'CAM-5', name: 'Labeler', position: [0.9, 1.45, 0.45], target: [0.2, 0.9, -0.35], fov: 60 },
  { id: 'CAM-6', name: 'Outfeed & reject bin', position: [1.5, 2.4, 1.15], target: [2.1, 0.75, 0.3], fov: 75 },
  { id: 'CAM-7', name: 'Packing table (ceiling)', position: [-1.2, 2.3, 3.2], target: [-1.2, 0.9, 2.35], fov: 60 },
];

export interface PlantCamera extends PlantCameraDef {
  camera: THREE.PerspectiveCamera;
}

/** Where one item shows up in one camera's capture. */
export interface Sighting {
  cameraId: string;
  box: { x1: number; y1: number; x2: number; y2: number };   // capture pixels
  pixels: number;                                           // longest side of the box
}

export interface TruthEntry {
  id: string;
  type: string;
  spot: string;
  area: string;
  sightings: Sighting[];   // only cameras where the item is visible and big enough
}

export function createPlantCameras(scene: THREE.Scene): PlantCamera[] {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.5 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x3aa0ff, emissive: 0x1a5fa0, emissiveIntensity: 0.8 });

  return CAMERA_DEFS.map((def) => {
    const camera = new THREE.PerspectiveCamera(def.fov, CAPTURE_WIDTH / CAPTURE_HEIGHT, 0.02, 30);
    camera.position.set(...def.position);
    camera.lookAt(...def.target);
    camera.layers.set(0);

    // A small camera body sitting just behind the lens, visible only in the free view.
    const body = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.12), bodyMat);
    housing.position.z = 0.08;
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 16), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.02;
    body.add(housing, lens);
    body.position.copy(camera.position);
    body.quaternion.copy(camera.quaternion);
    body.traverse((o) => o.layers.set(HELPER_LAYER));
    scene.add(body);

    return { ...def, camera };
  });
}

/**
 * Renders plant cameras off screen. Rendering at twice the size and scaling down
 * gives smooth edges without relying on multisampled render targets.
 */
export class CameraRenderer {
  private readonly targets = new Map<string, THREE.WebGLRenderTarget>();
  private readonly scratch = document.createElement('canvas');

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {}

  /** Draws a camera's current view into `canvas`, at the canvas's size. */
  drawTo(cam: PlantCamera, canvas: HTMLCanvasElement) {
    const src = this.renderPixels(cam, canvas.width * 2, canvas.height * 2);
    canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  }

  /** Full-size frame as a PNG data URL, exactly what gets sent to the AI. */
  capture(cam: PlantCamera): string {
    const src = this.renderPixels(cam, CAPTURE_WIDTH * 2, CAPTURE_HEIGHT * 2);
    const out = document.createElement('canvas');
    out.width = CAPTURE_WIDTH;
    out.height = CAPTURE_HEIGHT;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    return out.toDataURL('image/png');
  }

  private renderPixels(cam: PlantCamera, w: number, h: number): HTMLCanvasElement {
    const key = `${w}x${h}`;
    let target = this.targets.get(key);
    if (!target) {
      target = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
      this.targets.set(key, target);
    }
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, cam.camera);
    const pixels = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    this.renderer.setRenderTarget(null);

    // WebGL rows run bottom-up, canvas rows run top-down.
    const image = new ImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      image.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    this.scratch.width = w;
    this.scratch.height = h;
    this.scratch.getContext('2d')!.putImageData(image, 0, 0);
    return this.scratch;
  }
}

const raycaster = new THREE.Raycaster();
raycaster.layers.set(0);

function belongsTo(object: THREE.Object3D | null, item: PlacedItem): boolean {
  for (let o = object; o; o = o.parent) if (o === item.object) return true;
  return false;
}

/** Works out which cameras can see which items, using the scene geometry as ground truth. */
export function computeTruth(scene: THREE.Scene, cams: PlantCamera[], items: PlacedItem[]): TruthEntry[] {
  scene.updateMatrixWorld(true);
  return items.map((item) => {
    const bounds = new THREE.Box3().setFromObject(item.object);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    // Sample points across the top of the item, so a tablet half under a rail still counts as seen.
    const samples = [
      center,
      ...[[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].map(([fx, fz]) =>
        new THREE.Vector3(center.x + fx * size.x, bounds.max.y - 0.0005, center.z + fz * size.z)),
    ];

    const sightings: Sighting[] = [];
    for (const cam of cams) {
      const visible = samples.some((p) => {
        const ndc = p.clone().project(cam.camera);
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z < -1 || ndc.z > 1) return false;
        const dir = p.clone().sub(cam.camera.position);
        const dist = dir.length();
        raycaster.set(cam.camera.position, dir.normalize());
        raycaster.far = dist + 0.01;
        // See-through panels (machine windows) don't block the view; a glass vial still counts as the vial.
        const hit = raycaster.intersectObjects(scene.children, true).find((h) =>
          belongsTo(h.object, item)
          || !(h.object instanceof THREE.Mesh && (h.object.material as THREE.Material).transparent));
        return !!hit && belongsTo(hit.object, item);
      });
      if (!visible) continue;

      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const corner = new THREE.Vector3(
          i & 1 ? bounds.max.x : bounds.min.x,
          i & 2 ? bounds.max.y : bounds.min.y,
          i & 4 ? bounds.max.z : bounds.min.z,
        ).project(cam.camera);
        const px = (corner.x + 1) / 2 * CAPTURE_WIDTH;
        const py = (1 - corner.y) / 2 * CAPTURE_HEIGHT;
        x1 = Math.min(x1, px); y1 = Math.min(y1, py);
        x2 = Math.max(x2, px); y2 = Math.max(y2, py);
      }
      const pixels = Math.max(x2 - x1, y2 - y1);
      if (pixels < MIN_PIXELS) continue;
      sightings.push({
        cameraId: cam.id,
        box: { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2) },
        pixels: Math.round(pixels),
      });
    }
    return { id: item.id, type: item.type, spot: item.spot, area: item.area, sightings };
  });
}
