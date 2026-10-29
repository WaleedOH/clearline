// The control-room side of phone cameras: finds phones that have joined and keeps each one's
// latest picture. Real cameras flicker and add sensor noise, so each feed is a running average
// of recent frames rather than the raw last one.

import { CAPTURE_HEIGHT, CAPTURE_WIDTH } from '../plant/cameras';

export interface PhoneFeed {
  id: string;
  name: string;
  live: true;
}

const LIST_EVERY_MS = 2000;
const FRAME_EVERY_MS = 1000;
/** Weight of each new frame in the running average: lower is smoother but slower to react. */
const BLEND = 0.5;
/** A phone that sent nothing for this long shows as offline. */
const OFFLINE_MS = 6000;

interface FeedState {
  feed: PhoneFeed;
  canvas: HTMLCanvasElement;
  frames: number;
  lastFrameAt: number;
}

export class PhoneFeeds {
  private readonly feeds = new Map<string, FeedState>();

  constructor(private readonly onJoin: (feed: PhoneFeed) => void) {
    setInterval(() => this.refreshList(), LIST_EVERY_MS);
    setInterval(() => this.refreshFrames(), FRAME_EVERY_MS);
  }

  has(id: string): boolean {
    return this.feeds.has(id);
  }

  online(id: string): boolean {
    const s = this.feeds.get(id);
    return !!s && Date.now() - s.lastFrameAt < OFFLINE_MS;
  }

  /** The smoothed frame at capture size. */
  capture(id: string): HTMLCanvasElement {
    return this.feeds.get(id)!.canvas;
  }

  draw(id: string, canvas: HTMLCanvasElement) {
    const s = this.feeds.get(id);
    if (!s) return;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(s.canvas, 0, 0, canvas.width, canvas.height);
    if (!this.online(id)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff5d5d';
      ctx.font = `bold ${Math.round(canvas.height / 10)}px system-ui`;
      ctx.fillText('OFFLINE', canvas.width * 0.05, canvas.height * 0.2);
    }
  }

  private async refreshList() {
    try {
      const list: { id: string; name: string }[] = await (await fetch('/api/phone/list')).json();
      for (const { id, name } of list) {
        if (this.feeds.has(id)) continue;
        const canvas = Object.assign(document.createElement('canvas'), { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT });
        const feed: PhoneFeed = { id, name, live: true };
        this.feeds.set(id, { feed, canvas, frames: 0, lastFrameAt: 0 });
      }
    } catch {
      // The local API is down; try again next tick.
    }
  }

  private async refreshFrames() {
    for (const s of this.feeds.values()) {
      try {
        const res = await fetch(`/api/phone/frame?id=${encodeURIComponent(s.feed.id)}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const bitmap = await createImageBitmap(await res.blob());
        const ctx = s.canvas.getContext('2d')!;
        ctx.globalAlpha = s.frames === 0 ? 1 : BLEND;
        ctx.drawImage(bitmap, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
        ctx.globalAlpha = 1;
        bitmap.close();
        s.lastFrameAt = Date.now();
        // Announce a phone only once it has a picture to show.
        if (s.frames++ === 0) this.onJoin(s.feed);
      } catch {
        // Skip this frame.
      }
    }
  }
}
