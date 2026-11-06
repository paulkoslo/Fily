import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const nonce = randomBytes(16).toString('base64');
  return {
    html: command === 'serve' ? { cspNonce: nonce } : undefined,
    plugins: [react(), {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html, context) {
        const address = context.server?.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : 5180;
        return html
          .replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
          .replace("connect-src 'self'", `connect-src 'self' ws://localhost:${port}`);
      },
    }],
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      host: 'localhost',
      allowedHosts: ['localhost'],
      cors: false,
      port: 5180,
      strictPort: true,
    },
  };
});
