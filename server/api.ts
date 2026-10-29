// The local API, served by the Vite dev server. It is the only place the Meta API key lives:
// the browser and the camera pages never see it.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Plugin } from 'vite';
import { META_API_BASE, segment } from './sam';
import { judge } from './muse';
import { PhoneHub } from './phones';

/** SAM 3.1 image segmentation costs $2.50 per 1,000 images (Meta pricing page, Oct 2026). */
const SAM_COST_PER_IMAGE = 2.5 / 1000;

interface Options {
  /** The Meta Model API address; overridable so tests can point at a local stand-in. */
  apiBase: string;
  apiKey?: string;
  /** Hard stop on estimated spend per server run, so a bug can never run up a bill. */
  spendLimitUsd: number;
}

async function readBody(req: IncomingMessage, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** True for requests from this computer. Only phone frame uploads are accepted from the network. */
function isLocal(req: IncomingMessage): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
}

/** Addresses a phone on the same Wi-Fi can use to reach this computer. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function clearlineApi({ apiKey, apiBase, spendLimitUsd }: Options): Plugin {
  let samCalls = 0, museCalls = 0, spentUsd = 0;
  const phones = new PhoneHub();
  const usage = () => ({ samCalls, museCalls, spentUsd: Number(spentUsd.toFixed(4)), spendLimitUsd });

  return {
    name: 'clearline-api',
    configureServer(server) {
      const log = (msg: string) => server.config.logger.info(`[clearline] ${msg} · total ≈ $${spentUsd.toFixed(4)}`);

      server.middlewares.use('/api', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://local');

          // The one route open to the network: a phone camera uploading its latest frame.
          if (req.method === 'POST' && url.pathname === '/phone/frame') {
            const error = phones.accept(
              String(req.headers['x-camera-id'] ?? ''),
              decodeURIComponent(String(req.headers['x-camera-name'] ?? '')),
              String(req.headers['x-join-code'] ?? ''),
              await readBody(req, 4 * 1024 * 1024),
            );
            return send(res, error ? 403 : 200, error ? { error } : { ok: true });
          }

          // Everything else, including anything that spends money, only answers this computer.
          if (!isLocal(req)) return send(res, 403, { error: 'Only available on the computer running ClearLine' });

          if (req.method === 'GET' && url.pathname === '/status') {
            const port = server.config.server.port;
            const scheme = server.config.server.https ? 'https' : 'http';
            return send(res, 200, {
              metaApi: !!apiKey,
              testStandIn: apiBase !== META_API_BASE,
              ...usage(),
              phone: {
                joinCode: phones.joinCode,
                secure: scheme === 'https',
                urls: server.config.server.host ? lanAddresses().map((a) => `${scheme}://${a}:${port}/camera.html`) : [],
              },
            });
          }
          if (req.method === 'GET' && url.pathname === '/phone/list') return send(res, 200, phones.list());
          if (req.method === 'GET' && url.pathname === '/phone/frame') {
            const frame = phones.frame(url.searchParams.get('id') ?? '');
            if (!frame) return send(res, 404, { error: 'No such camera' });
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(frame);
          }

          if (req.method !== 'POST' || (url.pathname !== '/detect' && url.pathname !== '/judge')) {
            return send(res, 404, { error: 'Not found' });
          }
          if (!apiKey) return send(res, 503, { error: 'No Meta API key yet. Add MODEL_API_KEY to .env and restart.' });
          if (spentUsd >= spendLimitUsd) {
            return send(res, 429, { error: `Spend limit of $${spendLimitUsd} reached. Raise SPEND_LIMIT_USD in .env to continue.`, ...usage() });
          }
          const body = JSON.parse((await readBody(req)).toString('utf8'));
          const started = Date.now();

          if (url.pathname === '/detect') {
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
