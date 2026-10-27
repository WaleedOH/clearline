// The local API, served by the Vite dev server. It is the only place the Meta API key lives:
// the browser and the camera pages never see it.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { segment } from './sam';

/** SAM 3.1 image segmentation costs $2.50 per 1,000 images (Meta pricing page, Oct 2026). */
const SAM_COST_PER_IMAGE = 2.5 / 1000;

interface Options {
  apiKey?: string;
  /** Hard stop on SAM calls per server run, so a bug can never run up a bill. */
  samCallLimit: number;
}

async function readJson(req: IncomingMessage, maxBytes = 20 * 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function clearlineApi({ apiKey, samCallLimit }: Options): Plugin {
  let samCalls = 0;
  const usage = () => ({
    samCalls,
    samCallLimit,
    estimatedCostUsd: Number((samCalls * SAM_COST_PER_IMAGE).toFixed(4)),
  });

  return {
    name: 'clearline-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          if (req.method === 'GET' && req.url === '/status') {
            return send(res, 200, { metaApi: !!apiKey, ...usage() });
          }

          if (req.method === 'POST' && req.url === '/detect') {
            if (!apiKey) return send(res, 503, { error: 'No Meta API key yet. Add MODEL_API_KEY to .env and restart.' });
            const { image, prompts, width, height } = await readJson(req);
            if (typeof image !== 'string' || !Array.isArray(prompts) || !prompts.length) {
              return send(res, 400, { error: 'Expected { image, prompts[], width, height }' });
            }
            if (samCalls + prompts.length > samCallLimit) {
              return send(res, 429, { error: `SAM call limit reached (${samCallLimit}). Raise SAM_CALL_LIMIT in .env to continue.`, ...usage() });
            }
            const started = Date.now();
            const detections = [];
            for (const prompt of prompts as string[]) {
              samCalls++;
              const boxes = await segment(apiKey, image, prompt, width, height);
              detections.push(...boxes.map((b) => ({ label: prompt, ...b })));
            }
            server.config.logger.info(
              `[clearline] SAM 3.1: ${prompts.length} call(s), ${detections.length} match(es), ${Date.now() - started} ms. `
              + `Total ${samCalls} calls ≈ $${usage().estimatedCostUsd}`);
            return send(res, 200, { detections, ms: Date.now() - started, ...usage() });
          }

          send(res, 404, { error: 'Not found' });
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
