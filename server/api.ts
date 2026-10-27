// The local API, served by the Vite dev server. It is the only place the Meta API key lives:
// the browser and the camera pages never see it.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { META_API_BASE, segment } from './sam';
import { judge } from './muse';

/** SAM 3.1 image segmentation costs $2.50 per 1,000 images (Meta pricing page, Oct 2026). */
const SAM_COST_PER_IMAGE = 2.5 / 1000;

interface Options {
  /** The Meta Model API address; overridable so tests can point at a local stand-in. */
  apiBase: string;
  apiKey?: string;
  /** Hard stop on estimated spend per server run, so a bug can never run up a bill. */
  spendLimitUsd: number;
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

export function clearlineApi({ apiKey, apiBase, spendLimitUsd }: Options): Plugin {
  let samCalls = 0, museCalls = 0, spentUsd = 0;
  const usage = () => ({ samCalls, museCalls, spentUsd: Number(spentUsd.toFixed(4)), spendLimitUsd });

  return {
    name: 'clearline-api',
    configureServer(server) {
      const log = (msg: string) => server.config.logger.info(`[clearline] ${msg} · total ≈ $${spentUsd.toFixed(4)}`);

      server.middlewares.use('/api', async (req, res) => {
        try {
          if (req.method === 'GET' && req.url === '/status') {
            return send(res, 200, { metaApi: !!apiKey, testStandIn: apiBase !== META_API_BASE, ...usage() });
          }
          if (req.method !== 'POST' || (req.url !== '/detect' && req.url !== '/judge')) {
            return send(res, 404, { error: 'Not found' });
          }
          if (!apiKey) return send(res, 503, { error: 'No Meta API key yet. Add MODEL_API_KEY to .env and restart.' });
          if (spentUsd >= spendLimitUsd) {
            return send(res, 429, { error: `Spend limit of $${spendLimitUsd} reached. Raise SPEND_LIMIT_USD in .env to continue.`, ...usage() });
          }
          const body = await readJson(req);
          const started = Date.now();

          if (req.url === '/detect') {
            const { image, prompts, width, height } = body;
            if (typeof image !== 'string' || !Array.isArray(prompts) || !prompts.length) {
              return send(res, 400, { error: 'Expected { image, prompts[], width, height }' });
            }
            const detections = [];
            for (const prompt of prompts as string[]) {
              samCalls++;
              spentUsd += SAM_COST_PER_IMAGE;
              const boxes = await segment(apiKey, apiBase, image, prompt, width, height);
              detections.push(...boxes.map((b) => ({ label: prompt, ...b })));
            }
            log(`SAM 3.1: ${prompts.length} call(s), ${detections.length} match(es), ${Date.now() - started} ms`);
            return send(res, 200, { detections, ms: Date.now() - started, ...usage() });
          }

          museCalls++;
          const { verdict, costUsd } = await judge(apiKey, apiBase, body);
          spentUsd += costUsd;
          log(`Muse Spark: ${verdict.verdict} (${verdict.item}), ${Date.now() - started} ms`);
          return send(res, 200, { ...verdict, ms: Date.now() - started, ...usage() });
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
