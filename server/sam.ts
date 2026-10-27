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
      ...(Number.isFinite(fields.confidence) ? { confidence: fields.confidence } : {}),
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

/** Finds every match for `prompt` (a short noun phrase like "white tablet") in the image. */
export async function segment(
  apiKey: string, apiBase: string, imageDataUrl: string, prompt: string, width: number, height: number,
): Promise<SamBox[]> {
  const res = await fetch(`${apiBase}/responses`, {
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
  if (!res.ok) throw new Error(`SAM 3.1 returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return parseSamBoxes(outputText(await res.json()), width, height);
}
