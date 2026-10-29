// Phone cameras: a phone opens /camera.html, enters the join code shown in the control room,
// and uploads a JPEG frame about once a second. The control room polls the latest frame.
// Frames live in memory only and are never written to disk.

import { randomInt } from 'node:crypto';

export interface PhoneCamera {
  id: string;
  name: string;
  lastSeen: number;
  frame: Buffer;
}

/** A phone that hasn't sent a frame for this long is dropped from the list. */
const STALE_MS = 15_000;
const MAX_PHONES = 4;
const MAX_FRAME_BYTES = 3 * 1024 * 1024;

export class PhoneHub {
  /** Shown in the control room; a phone must send it with every frame. */
  readonly joinCode = String(randomInt(1000, 10000));
  private readonly phones = new Map<string, PhoneCamera>();

  /** Stores a frame. Returns an error message, or null when accepted. */
  accept(id: string, name: string, code: string, frame: Buffer): string | null {
    if (code !== this.joinCode) return 'Wrong join code';
    if (!/^PHONE-[A-Z0-9]{1,8}$/.test(id)) return 'Bad camera id';
    if (frame.length > MAX_FRAME_BYTES) return 'Frame too large';
    // JPEG files start with FF D8.
    if (frame[0] !== 0xff || frame[1] !== 0xd8) return 'Frames must be JPEG';
    this.prune();
    if (!this.phones.has(id) && this.phones.size >= MAX_PHONES) return 'Too many phone cameras';
    this.phones.set(id, { id, name: name.slice(0, 40) || id, lastSeen: Date.now(), frame });
    return null;
  }

  list() {
    this.prune();
    return [...this.phones.values()].map(({ id, name, lastSeen }) => ({ id, name, lastSeen }));
  }

  frame(id: string): Buffer | undefined {
    return this.phones.get(id)?.frame;
  }

  private prune() {
    const cutoff = Date.now() - STALE_MS;
    for (const [id, p] of this.phones) if (p.lastSeen < cutoff) this.phones.delete(id);
  }
}
