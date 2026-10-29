import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';
import { clearlineApi } from './server/api';
import { META_API_BASE } from './server/sam';

export default defineConfig(({ mode }) => {
  // Loads .env without exposing anything to the browser (only VITE_* variables reach the client).
  const env = loadEnv(mode, process.cwd(), '');
  // `npm run dev:phone` serves over HTTPS on the local network, because phones only allow camera
  // access on secure pages. The certificate is self-signed, so each device asks to trust it once.
  const phone = mode === 'phone';
  return {
    plugins: [
      ...(phone ? [basicSsl()] : []),
      clearlineApi({
        apiKey: env.MODEL_API_KEY || undefined,
        apiBase: env.META_API_BASE || META_API_BASE,
        spendLimitUsd: Number(env.SPEND_LIMIT_USD) || 2,
      }),
    ],
    server: phone ? { host: true } : {},
    build: {
      rollupOptions: {
        input: { main: resolve(__dirname, 'index.html'), camera: resolve(__dirname, 'camera.html') },
      },
    },
  };
});
