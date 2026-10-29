// What each line area should and should not contain after a clearance. Muse Spark uses these
// to decide whether something a camera found is a leftover or part of the equipment.

export interface AreaChecklist {
  area: string;
  /** Things that are allowed to be there (equipment, fixtures, staged components). */
  belongs: string[];
  /** Things that must not be there once the previous batch is cleared. */
  mustNotBe: string[];
}

const PRODUCT_LEFTOVERS = [
  'loose tablets or capsules', 'printed labels or label backing', 'vials, bottles or caps',
  'cartons or carton blanks', 'leaflets or batch paperwork from the previous batch',
];

export const CHECKLISTS: AreaChecklist[] = [
  { area: 'Feeder', belongs: ['empty steel hopper', 'chute', 'control screen'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Conveyor A', belongs: ['belt', 'guide rails and brackets'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Labeler', belongs: ['label roll mounted on its spindle', 'rewind roll', 'applicator head'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Turntable', belongs: ['empty turntable disk', 'curved fence'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Conveyor B', belongs: ['belt', 'guide rails and brackets', 'checkweigher hood'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Checkweigher', belongs: ['empty reject bin', 'reject chute', 'display'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Cartoner', belongs: ['empty infeed plate', 'machine guarding'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Packing table', belongs: ['flat shipper boxes on the lower shelf'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Trolley', belongs: ['empty shelves'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'QA desk', belongs: ['monitor', 'keyboard', 'mouse', 'printer'], mustNotBe: PRODUCT_LEFTOVERS },
  { area: 'Floor', belongs: ['machine legs', 'floor markings'], mustNotBe: PRODUCT_LEFTOVERS },
];

/** Which line areas each camera watches. Room overviews cover everything at low detail. */
export const CAMERA_AREAS: Record<string, string[]> = {
  'CAM-1': ['Conveyor B', 'Cartoner', 'Packing table', 'Floor'],
  'CAM-2': ['Feeder', 'Conveyor A', 'Labeler', 'Floor'],
  'CAM-3': ['Feeder'],
  'CAM-4': ['Conveyor A'],
  'CAM-5': ['Labeler', 'Conveyor A'],
  'CAM-6': ['Labeler'],
  'CAM-7': ['Floor'],
  'CAM-8': ['Turntable', 'Conveyor A'],
  'CAM-9': ['Conveyor B', 'Checkweigher'],
  'CAM-10': ['Checkweigher'],
  'CAM-11': ['Cartoner', 'Conveyor B'],
  'CAM-12': ['Packing table'],
  'CAM-13': ['QA desk'],
  'CAM-14': ['Trolley'],
  'CAM-15': ['Conveyor A'],
  'CAM-16': ['Conveyor B'],
};

/** What SAM 3.1 is asked to look for inside a changed region. Short noun phrases work best. */
export const SAM_PROMPTS = ['tablet', 'capsule', 'label', 'vial', 'carton'];

/** Phone cameras watch the real mock line: a tray standing in for a stretch of conveyor. */
const MOCK_TRAY: AreaChecklist = {
  area: 'Mock line tray',
  belongs: ['empty metal tray or surface', 'tray edges and rims'],
  mustNotBe: PRODUCT_LEFTOVERS,
};

export function checklistsFor(cameraId: string): AreaChecklist[] {
  if (cameraId.startsWith('PHONE-')) return [MOCK_TRAY];
  const areas = CAMERA_AREAS[cameraId] ?? [];
  return CHECKLISTS.filter((c) => areas.includes(c.area));
}
