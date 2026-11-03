// SAM 3.1 through the Meta Model API (Responses API, model "sam-3.1").
// It answers in "special-token text", one record per match, for example:
//   <0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=...|>,1<|box;...|>
// We only need the boxes for now; masks carry commas inside their data, so we match box tokens
// directly instead of splitting the text.

export const META_API_BASE = 'https://api.meta.ai/v1';

export interface SamBox {
  x1: number; y1: number; x2: number; y2: number;
  confidence?: number;
}

const BOX_TOKEN = /<\|box;([^|]*)\|>/g;

/** Parses SAM 3.1 output text into boxes, rescaled to a `width` x `height` image. */
export function parseSamBoxes(text: string, width: number, height: number): SamBox[] {
  const boxes: SamBox[] = [];
  for (const match of text.matchAll(BOX_TOKEN)) {
    const fields = Object.fromEntries(match[1].split(';').map((kv) => {
      const [k, v] = kv.split('=');
      return [k, Number(v)];
    }));
    const sx = fields.w ? width / fields.w : 1;
    const sy = fields.h ? height / fields.h : 1;
    boxes.push({
      // x2/y2 are written as right - 1 and bottom - 1.
      x1: fields.x1 * sx,
      y1: fields.y1 * sy,
      x2: (fields.x2 + 1) * sx,
      y2: (fields.y2 + 1) * sy,
      // The live API writes confidence as `c=`; the docs example used `confidence=`.
      ...(Number.isFinite(fields.c) ? { confidence: fields.c }
        : Number.isFinite(fields.confidence) ? { confidence: fields.confidence } : {}),
    });
  }
  return boxes;
}

/** Pulls the text answer out of a Responses API reply. */
function outputText(reply: any): string {
  if (typeof reply.output_text === 'string') return reply.output_text;
  const parts: string[] = [];
  for (const item of reply.output ?? []) {
    for (const c of item.content ?? []) if (typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('');
}

/** At most this many SAM calls in flight; more than ~8 at once trips the API's burst limit. */
const MAX_IN_FLIGHT = 4;
const RETRY_WAITS_MS = [1000, 2000, 4000];
let inFlight = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** Finds every match for `prompt` (a short noun phrase like "white tablet") in the image. */
export function segment(
  apiKey: string, apiBase: string, imageDataUrl: string, prompt: string, width: number, height: number,
): Promise<SamBox[]> {
  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await request(apiKey, apiBase, imageDataUrl, prompt);
      if (res.status === 429 && attempt < RETRY_WAITS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]));
        continue;
      }
      if (!res.ok) throw new Error(`SAM 3.1 returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const reply = await res.json();
      const text = outputText(reply);
      if (process.env.CLEARLINE_DEBUG) {
        // Masks are long; show the shape of the reply without the mask data.
        console.log(`[sam-3.1 "${prompt}"] text=${text.replace(/data=[^|]*/g, 'data=…').slice(0, 300)}`);
      }
      return parseSamBoxes(text, width, height);
    }
  });
}

function request(apiKey: string, apiBase: string, imageDataUrl: string, prompt: string): Promise<Response> {
  return fetch(`${apiBase}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sam-3.1',
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      }],
      metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
    }),
  });
}
