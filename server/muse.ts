// Muse Spark through the Meta Model API: decides whether what a camera found is a leftover.

export const MUSE_MODEL = 'muse-spark-1.3';
/** Muse Spark 1.3 standard pricing per token (Meta pricing page, Oct 2026). */
export const MUSE_INPUT_COST = 1.25 / 1e6;
export const MUSE_OUTPUT_COST = 4.25 / 1e6;

export interface JudgeRequest {
  image: string;                       // data URL of the cropped region, change outlined in red
  cameraName: string;
  checklists: { area: string; belongs: string[]; mustNotBe: string[] }[];
  samFinds: { label: string; confidence?: number }[];
}

export interface Verdict {
  verdict: 'leftover' | 'belongs' | 'unclear';
  item: string;                        // what it is, in a few words
  reason: string;                      // one sentence an operator can act on
  recheck: boolean;                    // true when the image is too poor to be sure
}

const INSTRUCTIONS = `You are a GMP line clearance inspector in a pharmaceutical packaging room.
A fixed camera noticed something new inside the red outline. Decide whether it is a leftover
from the previous batch that must be removed before the next batch can start.

Rules:
- Anything on the "must not be present" list is a leftover, however small.
- Equipment and items on the "belongs" list are not leftovers.
- If the image is too dark, blurry or blocked to be sure, answer "unclear" and set recheck to true.
  Never guess "belongs" when unsure: a missed leftover is far worse than a false alarm.

Answer with JSON only, no other text:
{"verdict": "leftover" | "belongs" | "unclear", "item": "<what it is, a few words>",
 "reason": "<one short sentence for the operator>", "recheck": true | false}`;

function outputText(reply: any): string {
  if (typeof reply.output_text === 'string') return reply.output_text;
  const parts: string[] = [];
  for (const item of reply.output ?? []) {
    for (const c of item.content ?? []) if (typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('');
}

/** Pulls the first JSON object out of a reply, tolerating code fences or stray text around it. */
export function parseVerdict(text: string): Verdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`No JSON in Muse Spark reply: ${text.slice(0, 200)}`);
  const raw = JSON.parse(text.slice(start, end + 1));
  const verdict = ['leftover', 'belongs', 'unclear'].includes(raw.verdict) ? raw.verdict : 'unclear';
  return {
    verdict,
    item: String(raw.item ?? 'unknown object'),
    reason: String(raw.reason ?? ''),
    recheck: verdict === 'unclear' || raw.recheck === true,
  };
}

export async function judge(apiKey: string, apiBase: string, req: JudgeRequest): Promise<{ verdict: Verdict; costUsd: number }> {
  const context = [
    `Camera: ${req.cameraName}`,
    ...req.checklists.map((c) =>
      `Area "${c.area}". Belongs: ${c.belongs.join(', ')}. Must not be present: ${c.mustNotBe.join(', ')}.`),
    req.samFinds.length
      ? `An object detector found in the outline: ${req.samFinds.map((f) => f.label).join(', ')}.`
      : 'An object detector found nothing it recognised in the outline.',
  ].join('\n');

  const res = await fetch(`${apiBase}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MUSE_MODEL,
      instructions: INSTRUCTIONS,
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: context },
          { type: 'input_image', image_url: req.image },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Muse Spark returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const reply = await res.json();
  const usage = reply.usage ?? {};
  const costUsd = (usage.input_tokens ?? 0) * MUSE_INPUT_COST + (usage.output_tokens ?? 0) * MUSE_OUTPUT_COST;
  return { verdict: parseVerdict(outputText(reply)), costUsd };
}
