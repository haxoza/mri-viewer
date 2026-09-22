import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
const csp =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
export default defineConfig({
  resolve: { alias: { events: 'events/', url: 'url/' } },
  plugins: [
    react(),
    {
      name: 'private-data-boundary',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          let path = '';
          try {
            path = decodeURIComponent(req.url || '').replaceAll('\\', '/');
          } catch {
            res.statusCode = 400;
            res.end();
            return;
          }
          if (
            /(^|\/)(local-data|exports|test-data|\.git)(\/|\?|$)/i.test(path) ||
            /\.(dcm|dicom|ima|nii|nrrd|zip)(\?|$)/i.test(path)
          ) {
            res.statusCode = 403;
            res.end('Private data is not served.');
            return;
          }
          next();
        });
      },
    },
  ],
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      '@cornerstonejs/core',
      '@cornerstonejs/metadata',
      '@zip.js/zip.js',
      'dcmjs',
      'dicom-parser',
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
    ],
  },
  worker: { format: 'es' },
  server: {
    fs: {
      strict: true,
      deny: ['**/local-data/**', '**/exports/**', '**/test-data/**', '**/.git/**', '**/.env*'],
    },
  },
  preview: {
    headers: {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
