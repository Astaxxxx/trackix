import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer is a normal web app. `base: './'` makes the production build load
// correctly from the file:// protocol inside Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
