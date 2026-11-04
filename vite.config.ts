import {defineConfig, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';

// Vite does not apply Pages' _headers. Match the public runtime's narrow CORS
// rule locally so an opaque sandbox can load it in both dev and preview.
const runtimeCors: Plugin = {
  name: 'forge-runtime-cors',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.startsWith('/runtime/pyodide/314.0.1/')) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.startsWith('/runtime/pyodide/314.0.1/')) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      next();
    });
  },
};
export default defineConfig({plugins:[runtimeCors,react()],build:{outDir:'dist',emptyOutDir:true}});
