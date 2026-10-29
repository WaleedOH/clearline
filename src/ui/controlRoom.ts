// The operator and QA view: live camera grid, findings, manual checks for blind spots,
// QA sign-off and the printable clearance record.

import { CAPTURE_WIDTH } from '../plant/cameras';
import { LIVE_CAMERA, type ChangeDetector, type Region } from '../pipeline/change';
import { analyzeRegion, thumbnail } from '../pipeline/analyze';
import {
  loadRuns, now, OPEN_STATUSES, runState, saveRun,
  type ClearanceRun, type Finding, type FindingStatus,
} from '../clearance/run';

/** A camera the control room watches: a simulated plant camera, or a real phone (`live`). */
export interface CameraFeed {
  id: string;
  name: string;
  live?: boolean;
}

export interface PhoneInfo {
  joinCode: string;
  secure: boolean;
  urls: string[];
}

export interface ControlRoomDeps {
  cams: CameraFeed[];
  /** Renders a camera into a canvas of any size. */
  draw(cam: CameraFeed, canvas: HTMLCanvasElement): void;
  /** Full-size frame; reused between calls, so use it straight away. */
  capture(cam: CameraFeed): HTMLCanvasElement;
  detector: ChangeDetector;
  /** Spots the cameras cannot fully see; they need a manual check every clearance. */
  blindSpots: { spot: string; area: string; coverage: number }[];
  /** Simulator only: stands in for the operator physically removing what is under a region. */
  simulateRemoval(cameraId: string, region: Region): number;
  /** Where a region sits in the room, from calibrated camera geometry, plus the nearest named spot. */
  locate(cameraId: string, region: Region): { location: [number, number, number]; where: string } | null;
  /** Whether the local API has a Meta key, and whether it points at the offline test stand-in. */
  apiStatus(): Promise<{ connected: boolean; standIn: boolean; phone?: PhoneInfo }>;
  onExit(): void;
}

/** A view where more than this share of pixels changed means the camera moved or the lights changed. */
const MOVED_SHARE = 0.25;
/** A phone's clean picture is learned from this many frames, a little over one per phone upload. */
const CLEAN_FRAMES = 5;
const CLEAN_FRAME_GAP_MS = 1100;

const STATUS_TEXT: Record<FindingStatus, string> = {
  'awaiting-ai': 'Change found · AI not connected, check by eye',
  analyzing: 'Checking with SAM 3.1 + Muse Spark…',
  leftover: 'Leftover: remove it',
  unclear: 'Unclear: inspect by eye',
  belongs: 'AI: belongs here. Confirm?',
  error: 'AI check failed: inspect by eye',
  resolved: 'Resolved',
};

const STATE_TEXT = {
  'in-progress': 'In progress',
  'ready-for-qa': 'Ready for QA',
  'awaiting-qa': 'Awaiting QA',
  approved: 'Approved by QA',
  rejected: 'Rejected by QA',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const overlaps = (a: Region, b: Region) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
/** Two cameras' finds closer than this (metres) are treated as the same object. */
const SAME_OBJECT = 0.25;
const distance = (a: [number, number, number], b: [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class ControlRoom {
  private readonly root = document.getElementById('control')!;
  private readonly cams: CameraFeed[];
  private readonly tiles: { cam: CameraFeed; canvas: HTMLCanvasElement; el: HTMLElement }[] = [];
  private tileIndex = 0;
  private run: ClearanceRun | null = null;
  private busy = false;
  private api = false;
  private standIn = false;
  private phone?: PhoneInfo;
  /** Cameras that couldn't be checked on the last scan, and why. */
  private readonly warnings = new Map<string, string>();
  private counter = 0;

  constructor(private readonly deps: ControlRoomDeps) {
    this.root.innerHTML = `
      <header class="cr-head">
        <div><b>ClearLine</b> · Control room</div>
        <div id="cr-title" class="cr-title"></div>
        <div id="cr-state" class="badge"></div>
        <button id="cr-exit">Back to simulator</button>
      </header>
      <div class="cr-body">
        <div id="cr-grid" class="cr-grid"></div>
        <aside id="cr-side" class="cr-side"></aside>
      </div>
      <dialog id="cr-record"></dialog>`;
    this.root.querySelector('#cr-exit')!.addEventListener('click', () => deps.onExit());

    this.cams = [...deps.cams];
    for (const cam of this.cams) this.addTile(cam);
    this.render();
  }

  /** Adds a camera that joined after start-up, such as a phone. */
  addCamera(cam: CameraFeed) {
    if (this.cams.some((c) => c.id === cam.id)) return;
    this.cams.push(cam);
    this.addTile(cam);
    this.render();
  }

  private addTile(cam: CameraFeed) {
    const el = document.createElement('div');
    el.className = 'cr-tile';
    const canvas = Object.assign(document.createElement('canvas'), { width: 480, height: 270 });
    const label = document.createElement('span');
    label.textContent = cam.live ? `${cam.name} · live phone` : `${cam.id} · ${cam.name}`;
    el.append(canvas, label);
    if (cam.live) {
      // A real camera has no known-clean picture until someone confirms the area is clean.
      // It watches for a few seconds so it can learn how much the camera flickers on its own.
      const button = document.createElement('button');
      button.className = 'cr-tile-action';
      button.textContent = 'Set clean picture';
      button.addEventListener('click', async () => {
        button.disabled = true;
        const frames: HTMLCanvasElement[] = [];
        for (let i = CLEAN_FRAMES; i > 0; i--) {
          button.textContent = `Hold still… ${i}`;
          frames.push(copyCanvas(this.deps.capture(cam)));
          await new Promise((r) => setTimeout(r, CLEAN_FRAME_GAP_MS));
        }
        this.deps.detector.setReference(cam.id, frames);
        this.warnings.delete(cam.id);
        button.textContent = 'Reset clean picture';
        button.disabled = false;
        this.render();
      });
      el.append(button);
    }
    // Phones go first: they're the real-footage part of the demo.
    const grid = this.root.querySelector('#cr-grid')!;
    if (cam.live) grid.prepend(el); else grid.append(el);
    this.tiles.push({ cam, canvas, el });
  }

  async show() {
    this.root.hidden = false;
    ({ connected: this.api, standIn: this.standIn, phone: this.phone } = await this.deps.apiStatus());
    this.render();
  }

  hide() {
    this.root.hidden = true;
  }

  get visible() {
    return !this.root.hidden;
  }

  /** Called once per animation frame: refreshes one tile and draws its open findings. */
  drawNext() {
    const tile = this.tiles[this.tileIndex++ % this.tiles.length];
    this.deps.draw(tile.cam, tile.canvas);
    const open = (this.run?.findings ?? []).flatMap((f) => f.status === 'resolved' ? []
      : f.views.filter((v) => v.cameraId === tile.cam.id).map((v) => ({ f, region: v.region })));
    tile.el.dataset.status = open.length
      ? (open.some(({ f }) => f.status === 'leftover') ? 'leftover' : 'change')
      : (this.run?.scans.length ? 'clear' : '');
    if (!open.length) return;
    const ctx = tile.canvas.getContext('2d')!;
    const k = tile.canvas.width / CAPTURE_WIDTH;
    ctx.lineWidth = 2;
    for (const { f, region: r } of open) {
      ctx.strokeStyle = f.status === 'leftover' || f.status === 'unclear' ? '#ff4d4d' : f.status === 'belongs' ? '#3ccf7a' : '#ffb020';
      ctx.strokeRect(r.x1 * k, r.y1 * k, (r.x2 - r.x1) * k, (r.y2 - r.y1) * k);
    }
  }

  // ---------------- actions ----------------

  private start(form: HTMLFormElement) {
    const data = new FormData(form);
    this.run = {
      id: `CL-${Date.now().toString(36).toUpperCase()}`,
      line: String(data.get('line')),
      previousBatch: String(data.get('previous')),
      nextBatch: String(data.get('next')),
      operator: String(data.get('operator')) || 'Operator',
      startedAt: now(),
      scans: [],
      findings: [],
      manualChecks: this.deps.blindSpots.map((b) => ({ ...b, done: false })),
    };
    saveRun(this.run);
    this.render();
    this.scanAll();
  }

  private async scanAll() {
    const run = this.run;
    if (!run || this.busy) return;
    this.busy = true;
    this.render();

    // For each new finding, the clearest view so far: the camera where the change covers the most
    // pixels. That view becomes the thumbnail and is what the AI gets to look at.
    const best = new Map<Finding, { cam: CameraFeed; region: Region; frame: HTMLCanvasElement }>();
    let camerasWithChanges = 0, regionCount = 0;
    this.warnings.clear();
    for (const cam of this.cams) {
      if (!this.deps.detector.hasReference(cam.id)) {
        this.warnings.set(cam.id, 'no clean picture yet: press "Set clean picture" while the area is clean');
        continue;
      }
      const frame = this.deps.capture(cam);
      const regions = this.detect(cam, frame);
      // Half the picture changed: the camera was bumped or the lights changed, not a leftover.
      if (this.deps.detector.changedShare(cam.id) > MOVED_SHARE) {
        this.warnings.set(cam.id, 'the view changed a lot (camera moved or lights changed): set a new clean picture');
        continue;
      }
      if (regions.length) camerasWithChanges++;
      regionCount += regions.length;
      for (const region of regions) {
        const place = this.deps.locate(cam.id, region);
        // Already being handled, or confirmed as belonging there: don't raise it again.
        const active = (f: Finding) => f.status !== 'resolved' || !!f.resolution?.startsWith('Confirmed not a leftover');
        const known = run.findings.some((f) => active(f)
          && f.views.some((v) => v.cameraId === cam.id && overlaps(v.region, region)));
        if (known) continue;
        // Another camera already reported something at the same place: it's the same object.
        const same = place && run.findings.find((f) => active(f) && f.location && distance(f.location, place.location) < SAME_OBJECT);
        if (same) {
          same.views.push({ cameraId: cam.id, cameraName: cam.name, region });
          const current = best.get(same);
          // The frame canvas is reused by the next capture, so keep a copy.
          if (current && region.pixels > current.region.pixels) best.set(same, { cam, region, frame: copyCanvas(frame) });
          continue;
        }
        const finding: Finding = {
          id: `F${++this.counter}`,
          cameraId: cam.id,
          cameraName: cam.name,
          region,
          views: [{ cameraId: cam.id, cameraName: cam.name, region }],
          ...(place ?? {}),
          thumb: '',
          status: this.api ? 'analyzing' : 'awaiting-ai',
          foundAt: now(),
        };
        run.findings.push(finding);
        best.set(finding, { cam, region, frame: copyCanvas(frame) });
      }
    }
    for (const [finding, view] of best) {
      Object.assign(finding, { cameraId: view.cam.id, cameraName: view.cam.name, region: view.region });
      finding.thumb = thumbnail(view.frame, view.region);
    }
    run.scans.push({ at: now(), camerasWithChanges, regions: regionCount });
    saveRun(run);
    this.render();

    for (const [finding, { frame }] of this.api ? best : []) {
      try {
        const a = await analyzeRegion(frame, finding.region, finding.cameraId, finding.cameraName);
        Object.assign(finding, { status: a.verdict, item: a.item, reason: a.reason, samFinds: a.samFinds });
      } catch (err) {
        Object.assign(finding, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
      saveRun(run);
      this.render();
    }
    this.busy = false;
    this.render();
  }

  /** The operator removed the item; every camera that saw it checks its area is back to clean. */
  private recheck(finding: Finding, simulateRemoval: boolean) {
    if (!this.run) return;
    if (simulateRemoval) for (const v of finding.views) this.deps.simulateRemoval(v.cameraId, v.region);
    const stillSeen = finding.views.filter((v) => {
      const cam = this.cams.find((c) => c.id === v.cameraId)!;
      return this.detect(cam, this.deps.capture(cam)).some((r) => overlaps(r, v.region));
    });
    const ids = finding.views.map((v) => v.cameraId).join(', ');
    if (stillSeen.length) {
      finding.reason = `Still visible on ${stillSeen.map((v) => v.cameraId).join(', ')} at ${clock(now())}. Check again.`;
    } else {
      this.resolve(finding, `Removed by ${this.run.operator}; ${ids} confirmed the area is clean`);
    }
    saveRun(this.run);
    this.render();
  }

  private detect(cam: CameraFeed, frame: HTMLCanvasElement): Region[] {
    return this.deps.detector.detect(cam.id, frame, cam.live ? LIVE_CAMERA : {});
  }

  private resolve(finding: Finding, resolution: string) {
    finding.status = 'resolved';
    finding.resolution = resolution;
    finding.resolvedBy = this.run?.operator;
    finding.resolvedAt = now();
  }

  // ---------------- rendering ----------------

  private render() {
    const run = this.run;
    const title = this.root.querySelector('#cr-title')!;
    const badge = this.root.querySelector<HTMLElement>('#cr-state')!;
    const side = this.root.querySelector('#cr-side')!;

    if (!run) {
      title.textContent = 'No clearance running';
      badge.textContent = '';
      badge.dataset.state = '';
      side.innerHTML = this.startForm() + this.phoneSection();
      side.querySelector('form')!.addEventListener('submit', (e) => {
        e.preventDefault();
        this.start(e.currentTarget as HTMLFormElement);
      });
      return;
    }

    const state = runState(run);
    title.textContent = `${run.line} · ${run.previousBatch} → ${run.nextBatch} · ${run.id}`;
    badge.textContent = STATE_TEXT[state];
    badge.dataset.state = state;

    const open = run.findings.filter((f) => OPEN_STATUSES.includes(f.status));
    const resolved = run.findings.filter((f) => f.status === 'resolved');
    const manualLeft = run.manualChecks.filter((m) => !m.done).length;
    const locked = state === 'awaiting-qa' || state === 'approved' || state === 'rejected';

    side.innerHTML = `
      <div class="cr-actions">
        <button data-act="scan" ${this.busy || locked ? 'disabled' : ''}>${this.busy ? 'Scanning…' : 'Scan all cameras'}</button>
        <button data-act="submit" class="primary" ${state === 'ready-for-qa' ? '' : 'disabled'}>Submit for QA</button>
        <button data-act="record">Clearance record</button>
      </div>
      <p class="cr-note">${this.standIn ? '<b class="cr-error">TEST STAND-IN, not Meta\'s models: AI answers are fake.</b> '
        : this.api ? 'AI connected: SAM 3.1 + Muse Spark check every change.' : 'AI not connected: changes are flagged for a person to check.'}
        ${run.scans.length ? ` Last scan ${clock(run.scans.at(-1)!.at)}.` : ''}</p>
      ${[...this.warnings].map(([id, why]) => {
        const cam = this.cams.find((c) => c.id === id);
        return `<p class="cr-warning"><b>${esc(cam?.name ?? id)}</b> not checked: ${esc(why)}.</p>`;
      }).join('')}

      <h3>Findings <span class="count">${open.length} open · ${resolved.length} resolved</span></h3>
      ${open.length ? open.map((f) => this.findingCard(f, locked)).join('') : `<p class="cr-empty">${run.scans.length ? 'No open findings.' : 'Scanning…'}</p>`}

      <h3>Manual checks <span class="count">${manualLeft} left</span></h3>
      <p class="cr-note">Cameras can't fully see these spots. Check each one by eye.</p>
      ${run.manualChecks.map((m, i) => `
        <label class="cr-check">
          <input type="checkbox" data-manual="${i}" ${m.done ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span><b>${esc(m.spot)}</b> · ${Math.round(m.coverage * 100)}% camera coverage
          ${m.done ? `<br><small>Checked by ${esc(m.by ?? '')} at ${clock(m.at)}</small>` : ''}</span>
        </label>`).join('')}

      ${state === 'awaiting-qa' ? this.qaForm() : ''}
      ${run.qa ? `<div class="cr-qa-result" data-state="${run.qa.decision}">
        <b>${run.qa.decision === 'approved' ? 'Approved' : 'Rejected'}</b> by ${esc(run.qa.name)} at ${clock(run.qa.at)}
        ${run.qa.comment ? `<br>${esc(run.qa.comment)}` : ''}</div>
        <button data-act="new">Start a new clearance</button>` : ''}

      ${resolved.length ? `<h3>Resolved</h3>${resolved.map((f) => `
        <div class="cr-resolved"><b>${esc(f.where ?? f.cameraId)}</b> ${esc(f.item ?? 'change')} · ${esc(f.resolution ?? '')} · ${clock(f.resolvedAt)}</div>`).join('')}` : ''}
      ${this.phoneSection()}`;

    side.querySelector('[data-act="scan"]')?.addEventListener('click', () => this.scanAll());
    side.querySelector('[data-act="record"]')?.addEventListener('click', () => this.showRecord());
    side.querySelector('[data-act="new"]')?.addEventListener('click', () => { this.run = null; this.render(); });
    side.querySelector('[data-act="submit"]')?.addEventListener('click', () => {
      run.submittedAt = now();
      saveRun(run);
      this.render();
    });
    side.querySelectorAll<HTMLInputElement>('[data-manual]').forEach((box) => box.addEventListener('change', () => {
      const m = run.manualChecks[Number(box.dataset.manual)];
      Object.assign(m, box.checked ? { done: true, by: run.operator, at: now() } : { done: false, by: undefined, at: undefined });
      saveRun(run);
      this.render();
    }));
    side.querySelectorAll<HTMLButtonElement>('[data-finding]').forEach((btn) => btn.addEventListener('click', () => {
      const f = run.findings.find((x) => x.id === btn.dataset.finding)!;
      if (btn.dataset.do === 'removed') this.recheck(f, true);
      if (btn.dataset.do === 'belongs') {
        this.resolve(f, `Confirmed not a leftover${f.item ? ` (${f.item})` : ''}`);
        saveRun(run);
        this.render();
      }
    }));
    side.querySelector('form.cr-qa')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const decision = (e as SubmitEvent).submitter?.getAttribute('value') === 'rejected' ? 'rejected' : 'approved';
      run.qa = { name: String(data.get('qa')) || 'QA', decision, comment: String(data.get('comment')), at: now() };
      saveRun(run);
      this.render();
    });
  }

  private phoneSection() {
    const phones = this.cams.filter((c) => c.live).length;
    const p = this.phone;
    const how = !p ? ''
      : !p.secure ? '<p class="cr-note">To add a phone camera, restart ClearLine with <code>npm run dev:phone</code>.</p>'
      : `<p class="cr-note">On a phone on the same Wi-Fi, open
          ${p.urls.map((u) => `<br><code>${esc(u)}</code>`).join('') || '<br>(no network address found)'}
          <br>and enter join code <b class="cr-code">${esc(p.joinCode)}</b>. The phone will warn about the
          certificate once; that's expected for a local test.</p>`;
    return `<h3>Phone cameras <span class="count">${phones} connected</span></h3>${how}`;
  }

  private startForm() {
    const previous = loadRuns().length;
    return `
      <h3>Start line clearance</h3>
      <form class="cr-form">
        <label>Line <input name="line" value="Packaging Line 2"></label>
        <label>Previous batch <input name="previous" value="LX-2041"></label>
        <label>Next batch <input name="next" value="QB-7713"></label>
        <label>Operator <input name="operator" placeholder="Your name" required></label>
        <button class="primary">Start clearance &amp; scan</button>
      </form>
      <p class="cr-note">Every camera compares the line with its last approved clean picture. ${previous ? `${previous} earlier clearance(s) saved in this browser.` : ''}</p>`;
  }

  private findingCard(f: Finding, locked: boolean) {
    const canAct = !locked && f.status !== 'analyzing';
    const finds = f.samFinds?.length ? `<br><small>SAM 3.1 found: ${f.samFinds.map((s) => s.label).join(', ')}</small>` : '';
    return `
      <div class="cr-finding" data-status="${f.status}">
        <img src="${f.thumb}" alt="">
        <div>
          <div><b>${esc(f.where ?? f.cameraName)}</b> · ${clock(f.foundAt)}</div>
          <small>Seen by ${f.views.map((v) => v.cameraId).join(', ')}</small>
          <div class="cr-status">${STATUS_TEXT[f.status]}</div>
          ${f.item ? `<div>${esc(f.item)}</div>` : ''}
          ${f.reason ? `<small>${esc(f.reason)}</small>` : ''}${finds}
          ${f.error ? `<small class="cr-error">${esc(f.error)}</small>` : ''}
          ${canAct ? `<div class="cr-card-actions">
            <button data-finding="${f.id}" data-do="removed">Removed, re-check</button>
            ${f.status !== 'leftover' ? `<button data-finding="${f.id}" data-do="belongs">Not a leftover</button>` : ''}
          </div>` : ''}
        </div>
      </div>`;
  }

  private qaForm() {
    return `
      <h3>QA review</h3>
      <form class="cr-form cr-qa">
        <label>QA reviewer <input name="qa" placeholder="Name" required></label>
        <label>Comment <input name="comment" placeholder="Optional"></label>
        <div class="cr-actions">
          <button value="approved" class="primary">Approve line clearance</button>
          <button value="rejected">Reject</button>
        </div>
      </form>
      <p class="cr-note">Review the findings and the clearance record before signing.</p>`;
  }

  private showRecord() {
    const run = this.run;
    if (!run) return;
    const dialog = this.root.querySelector<HTMLDialogElement>('#cr-record')!;
    const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    dialog.innerHTML = `
      <div class="dialog-head"><h2>Line clearance record · ${run.id}</h2>
        <div><button data-act="print">Print</button><button data-act="close">Close</button></div></div>
      <table class="cr-table">
        ${row('Line', esc(run.line))}
        ${row('Batch change', `${esc(run.previousBatch)} → ${esc(run.nextBatch)}`)}
        ${row('Operator', esc(run.operator))}
        ${row('Started', new Date(run.startedAt).toLocaleString())}
        ${row('Scans', run.scans.map((s) => `${clock(s.at)}: ${s.camerasWithChanges} camera(s) with changes`).join('<br>') || 'none')}
        ${row('Status', STATE_TEXT[runState(run)])}
        ${run.qa ? row('QA decision', `${run.qa.decision} by ${esc(run.qa.name)}, ${new Date(run.qa.at).toLocaleString()}${run.qa.comment ? `: ${esc(run.qa.comment)}` : ''}`) : ''}
      </table>
      <h3>Findings (${run.findings.length})</h3>
      ${run.findings.map((f) => `
        <div class="cr-finding" data-status="${f.status}"><img src="${f.thumb}" alt="">
          <div><b>${esc(f.where ?? f.cameraName)}</b> · seen by ${f.views.map((v) => v.cameraId).join(', ')} · found ${clock(f.foundAt)}<br>
          ${esc(f.item ?? 'Change')} · ${STATUS_TEXT[f.status]}${f.reason ? `<br><small>${esc(f.reason)}</small>` : ''}
          ${f.resolution ? `<br><small>${esc(f.resolution)} · ${clock(f.resolvedAt)}</small>` : ''}</div></div>`).join('') || '<p>None.</p>'}
      <h3>Manual checks</h3>
      ${run.manualChecks.map((m) => `<div>${m.done ? '✔' : '✘'} ${esc(m.spot)}${m.done ? ` · ${esc(m.by ?? '')} at ${clock(m.at)}` : ''}</div>`).join('')}
      <p class="cr-note">Prototype record. A production system would need validated electronic signatures (21 CFR Part 11).</p>`;
    dialog.querySelector('[data-act="close"]')!.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-act="print"]')!.addEventListener('click', () => window.print());
    dialog.showModal();
  }
}

function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
