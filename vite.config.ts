import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('southern_boundaries.json')) return 'geo-boundaries';
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/pmtiles')) {
            return 'vendor-leaflet';
          }
          if (id.includes('node_modules/milsymbol')) return 'vendor-milsymbol';
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/lucide-react')
          ) {
            return 'vendor-react';
          }
        },
      },
    },
  },
});
