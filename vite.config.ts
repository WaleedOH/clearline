import { defineConfig, loadEnv } from 'vite';
import { clearlineApi } from './server/api';
import { META_API_BASE } from './server/sam';

export default defineConfig(({ mode }) => {
  // Loads .env without exposing anything to the browser (only VITE_* variables reach the client).
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      clearlineApi({
        apiKey: env.MODEL_API_KEY || undefined,
        apiBase: env.META_API_BASE || META_API_BASE,
        spendLimitUsd: Number(env.SPEND_LIMIT_USD) || 2,
      }),
    ],
  };
});
