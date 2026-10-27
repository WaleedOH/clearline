// A local stand-in for the Meta Model API, for testing ClearLine's AI path without spending credits.
// It is NOT Meta's models: it checks each request has the shape Meta's docs describe, then answers
// in the documented reply formats with fixed, fake results.
//
//   node scripts/meta-stand-in.mjs            (listens on http://localhost:5199/v1)
//   META_API_BASE=http://localhost:5199/v1 MODEL_API_KEY=test npx vite --port 5180
//
// SAM 3.1 stand-in: reports one box in the middle of the image for the prompt "tablet", nothing else.
// Muse Spark stand-in: always answers "leftover" for a white tablet.

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 5199;
let requests = 0;

/** Width and height from a PNG data URL's header (bytes 16-23), or null for other formats. */
function pngSize(dataUrl) {
  const match = /^data:image\/png;base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[1].slice(0, 64), 'base64');
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/responses') return reply(res, 404, { error: 'not found' });
  if (!/^Bearer \S+$/.test(req.headers.authorization ?? '')) return reply(res, 401, { error: 'missing bearer token' });

  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const content = body.input?.[0]?.content ?? [];
  const text = content.find((c) => c.type === 'input_text')?.text;
  const image = content.find((c) => c.type === 'input_image')?.image_url;
  if (body.input?.[0]?.type !== 'message' || body.input[0].role !== 'user' || !text || !image?.startsWith('data:image/')) {
    return reply(res, 400, { error: 'request does not match the documented Responses API shape' });
  }
  requests++;

  if (body.model === 'sam-3.1') {
    const size = pngSize(image);
    if (!size) return reply(res, 400, { error: 'stand-in expects PNG images for SAM' });
    const { w, h } = size;
    const box = `<|box;x1=${Math.round(w * 0.45)};y1=${Math.round(h * 0.45)};x2=${Math.round(w * 0.55)};y2=${Math.round(h * 0.55)};w=${w};h=${h};confidence=0.93|>`;
    const output_text = text === 'tablet' ? `<0f>0${box}<|mask;x=0;y=0;data=4,2,!x|>` : '<0f>';
    console.log(`#${requests} sam-3.1 "${text}" ${w}x${h}`);
    return reply(res, 200, { output_text });
  }

  if (body.model === 'muse-spark-1.3') {
    if (!body.instructions) return reply(res, 400, { error: 'missing instructions' });
    console.log(`#${requests} muse-spark-1.3 ${text.split('\n')[0]}`);
    return reply(res, 200, {
      output_text: '```json\n{"verdict": "leftover", "item": "white tablet", "reason": "Loose tablet next to the guide rail; remove it before the next batch.", "recheck": false}\n```',
      usage: { input_tokens: 1800, output_tokens: 60 },
    });
  }

  reply(res, 400, { error: `unknown model ${body.model}` });
}).listen(PORT, () => console.log(`Meta API stand-in (NOT real models) on http://localhost:${PORT}/v1`));
