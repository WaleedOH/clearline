// Stages 2 and 3 of the pipeline, run on one changed region:
//   2. SAM 3.1 finds and outlines what is inside it (tablet, label, vial...)
//   3. Muse Spark checks the find against the area's checklist: leftover, belongs, or unclear.
// The region is cropped with some context and enlarged first: a tablet is only a few pixels wide
// in a full camera frame, far smaller than anything a model is tuned for.

import type { Region } from './change';
import { checklistsFor, SAM_PROMPTS } from './checklists';

/** Crops are at least this big (capture pixels) so the model sees the surroundings. */
const MIN_CONTEXT = 200;
/** Crops are enlarged so their longer side is about this many pixels. */
const TARGET_SIDE = 768;
const MAX_ZOOM = 4;

export interface SamFind {
  label: string;
  confidence?: number;
  box: { x1: number; y1: number; x2: number; y2: number };   // capture pixels
}

export interface Analysis {
  samFinds: SamFind[];
  verdict: 'leftover' | 'belongs' | 'unclear';
  item: string;
  reason: string;
  recheck: boolean;
}

export interface Crop {
  /** The crop area in capture pixels. */
  x: number; y: number; w: number; h: number;
  zoom: number;
  plain: HTMLCanvasElement;      // what SAM 3.1 sees
  outlined: HTMLCanvasElement;   // what Muse Spark sees: the change outlined in red
}

export function cropRegion(frame: HTMLCanvasElement, region: Region): Crop {
  const cx = (region.x1 + region.x2) / 2, cy = (region.y1 + region.y2) / 2;
  const w = Math.min(frame.width, Math.max(MIN_CONTEXT, (region.x2 - region.x1) * 2));
  const h = Math.min(frame.height, Math.max(MIN_CONTEXT, (region.y2 - region.y1) * 2));
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), frame.width - w));
  const y = Math.round(Math.min(Math.max(0, cy - h / 2), frame.height - h));
  const zoom = Math.min(MAX_ZOOM, TARGET_SIDE / Math.max(w, h));

  const plain = document.createElement('canvas');
  plain.width = Math.round(w * zoom);
  plain.height = Math.round(h * zoom);
  const ctx = plain.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, x, y, w, h, 0, 0, plain.width, plain.height);

  const outlined = document.createElement('canvas');
  outlined.width = plain.width;
  outlined.height = plain.height;
  const octx = outlined.getContext('2d')!;
  octx.drawImage(plain, 0, 0);
  octx.strokeStyle = '#ff2020';
  octx.lineWidth = Math.max(2, Math.round(zoom));
  octx.strokeRect((region.x1 - x) * zoom, (region.y1 - y) * zoom, (region.x2 - region.x1) * zoom, (region.y2 - region.y1) * zoom);

  return { x, y, w, h, zoom, plain, outlined };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `${url} failed with ${res.status}`);
  return json as T;
}

export async function analyzeRegion(
  frame: HTMLCanvasElement, region: Region, cameraId: string, cameraName: string,
): Promise<Analysis> {
  const crop = cropRegion(frame, region);

  const detect = await post<{ detections: { label: string; confidence?: number; x1: number; y1: number; x2: number; y2: number }[] }>(
    '/api/detect',
    { image: crop.plain.toDataURL('image/png'), prompts: SAM_PROMPTS, width: crop.plain.width, height: crop.plain.height },
  );
  // Map boxes from the enlarged crop back to capture pixels, and keep only those touching the change.
  const samFinds: SamFind[] = detect.detections
    .map((d) => ({
      label: d.label,
      confidence: d.confidence,
      box: {
        x1: crop.x + d.x1 / crop.zoom, y1: crop.y + d.y1 / crop.zoom,
        x2: crop.x + d.x2 / crop.zoom, y2: crop.y + d.y2 / crop.zoom,
      },
    }))
    .filter((f) => f.box.x1 < region.x2 && f.box.x2 > region.x1 && f.box.y1 < region.y2 && f.box.y2 > region.y1);

  const judged = await post<Omit<Analysis, 'samFinds'>>('/api/judge', {
    image: crop.outlined.toDataURL('image/jpeg', 0.92),
    cameraName: `${cameraId} · ${cameraName}`,
    checklists: checklistsFor(cameraId),
    samFinds: samFinds.map(({ label, confidence }) => ({ label, confidence })),
  });

  return { samFinds, verdict: judged.verdict, item: judged.item, reason: judged.reason, recheck: judged.recheck };
}

/** A small preview of the region for alert cards and the clearance record. */
export function thumbnail(frame: HTMLCanvasElement, region: Region, size = 160): string {
  const crop = cropRegion(frame, region);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * crop.h / crop.w);
  c.getContext('2d')!.drawImage(crop.outlined, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
