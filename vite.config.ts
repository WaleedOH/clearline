import { defineConfig, loadEnv } from 'vite';
import { clearlineApi } from './server/api';

export default defineConfig(({ mode }) => {
  // Loads .env without exposing anything to the browser (only VITE_* variables reach the client).
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      clearlineApi({
        apiKey: env.MODEL_API_KEY || undefined,
        samCallLimit: Number(env.SAM_CALL_LIMIT) || 400,
      }),
    ],
  };
});
