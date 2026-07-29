import { defineConfig } from 'vite';

import { API_PREFIX, createApiProxyOptions, DEFAULT_BACKEND_ORIGIN } from './config/api-proxy';

const backendOrigin = process.env['FM_SERVER_ORIGIN'] ?? DEFAULT_BACKEND_ORIGIN;

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      [API_PREFIX]: createApiProxyOptions(backendOrigin),
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
});
