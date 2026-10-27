// One line clearance, from the first scan to the QA decision. Every change is timestamped so the
// run doubles as the clearance record. Runs are kept in this browser (localStorage) as a history.

import type { Region } from '../pipeline/change';
import type { SamFind } from '../pipeline/analyze';

export type FindingStatus =
  | 'awaiting-ai'   // stage 1 saw a change; no API key, so a person must look
  | 'analyzing'     // SAM 3.1 + Muse Spark running
  | 'leftover'      // AI says remove it
  | 'unclear'       // AI could not be sure
  | 'belongs'       // AI says it is part of the area; an operator still confirms
  | 'error'         // the AI call failed; a person must look
  | 'resolved';

export const OPEN_STATUSES: FindingStatus[] = ['awaiting-ai', 'analyzing', 'leftover', 'unclear', 'belongs', 'error'];

export interface CameraView {
  cameraId: string;
  cameraName: string;
  region: Region;
}

export interface Finding {
  id: string;
  /** The camera that saw it first; `views` holds every camera that sees the same object. */
  cameraId: string;
  cameraName: string;
  region: Region;
  views: CameraView[];
  /** Where it is in the room (metres), from the calibrated camera geometry, and the nearest named spot. */
  location?: [number, number, number];
  where?: string;
  thumb: string;
  status: FindingStatus;
  foundAt: string;
  samFinds?: SamFind[];
  item?: string;
  reason?: string;
  error?: string;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ManualCheck {
  spot: string;
  area: string;
  coverage: number;          // share of the spot the cameras can see, 0-1
  done: boolean;
  by?: string;
  at?: string;
}

export interface QaDecision {
  name: string;
  decision: 'approved' | 'rejected';
  comment: string;
  at: string;
}

export interface ClearanceRun {
  id: string;
  line: string;
  previousBatch: string;
  nextBatch: string;
  operator: string;
  startedAt: string;
  scans: { at: string; camerasWithChanges: number; regions: number }[];
  findings: Finding[];
  manualChecks: ManualCheck[];
  submittedAt?: string;
  qa?: QaDecision;
}

export type RunState = 'in-progress' | 'ready-for-qa' | 'awaiting-qa' | 'approved' | 'rejected';

export const now = () => new Date().toISOString();

export function runState(run: ClearanceRun): RunState {
  if (run.qa) return run.qa.decision;
  if (run.submittedAt) return 'awaiting-qa';
  const open = run.findings.some((f) => OPEN_STATUSES.includes(f.status));
  const manualLeft = run.manualChecks.some((m) => !m.done);
  return !open && !manualLeft && run.scans.length > 0 ? 'ready-for-qa' : 'in-progress';
}

const STORAGE_KEY = 'clearline.runs';

export function loadRuns(): ClearanceRun[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveRun(run: ClearanceRun) {
  try {
    const runs = loadRuns().filter((r) => r.id !== run.id);
    runs.unshift(run);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, 20)));
  } catch {
    // Storage can be full or blocked; the run still lives in memory.
  }
}
