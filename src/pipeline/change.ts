// Stage 1 of the pipeline: compare each camera's frame with its "clean line" reference and
// return the regions that changed. Cheap and local, so the AI is only called when something
// actually appears.

import { CAPTURE_HEIGHT, CAPTURE_WIDTH } from '../plant/cameras';

/** Frames are compared at half resolution: small enough to be fast, big enough to keep a tablet. */
const SCALE = 2;
const W = CAPTURE_WIDTH / SCALE;
const H = CAPTURE_HEIGHT / SCALE;
/** Minimum brightness difference (0-255) for a pixel to count as changed. */
const THRESHOLD = 14;
/** Changed pixels closer than this (in compare pixels) belong to the same region. */
const JOIN = 3;
/** Regions are padded so the AI sees a little context around the change. */
const PAD = 8;

export interface Region {
  x1: number; y1: number; x2: number; y2: number;   // capture pixels
  pixels: number;                                   // changed pixels at compare resolution
}

const scratch = document.createElement('canvas');
scratch.width = W;
scratch.height = H;
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;

function luminance(frame: CanvasImageSource): Float32Array {
  scratchCtx.drawImage(frame, 0, 0, W, H);
  const { data } = scratchCtx.getImageData(0, 0, W, H);
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return out;
}

function mean(values: Float32Array): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export class ChangeDetector {
  private readonly references = new Map<string, Float32Array>();

  setReference(cameraId: string, frame: CanvasImageSource) {
    this.references.set(cameraId, luminance(frame));
  }

  hasReference(cameraId: string): boolean {
    return this.references.has(cameraId);
  }

  detect(cameraId: string, frame: CanvasImageSource): Region[] {
    const ref = this.references.get(cameraId);
    if (!ref) throw new Error(`No clean reference for ${cameraId}`);
    const cur = luminance(frame);

    // Undo overall brightness drift (lights dimmed, daylight) so only local changes remain.
    const gain = mean(ref) / Math.max(mean(cur), 1);
    const changed = new Uint8Array(W * H);
    for (let i = 0; i < changed.length; i++) {
      if (Math.abs(cur[i] * gain - ref[i]) > THRESHOLD) changed[i] = 1;
    }
    return this.regions(changed);
  }

  /** Groups changed pixels into boxes (connected components, joining pixels up to JOIN apart). */
  private regions(changed: Uint8Array): Region[] {
    const seen = new Uint8Array(W * H);
    const out: Region[] = [];
    const stack: number[] = [];
    for (let start = 0; start < changed.length; start++) {
      if (!changed[start] || seen[start]) continue;
      let x1 = W, y1 = H, x2 = 0, y2 = 0, pixels = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % W, y = (i - x) / W;
        pixels++;
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
        for (let dy = -JOIN; dy <= JOIN; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= H) continue;
          for (let dx = -JOIN; dx <= JOIN; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            const j = ny * W + nx;
            if (changed[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
          }
        }
      }
      out.push({
        x1: Math.max(0, x1 * SCALE - PAD),
        y1: Math.max(0, y1 * SCALE - PAD),
        x2: Math.min(CAPTURE_WIDTH, (x2 + 1) * SCALE + PAD),
        y2: Math.min(CAPTURE_HEIGHT, (y2 + 1) * SCALE + PAD),
        pixels,
      });
    }
    return out;
  }
}
