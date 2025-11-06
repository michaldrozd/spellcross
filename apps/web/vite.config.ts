import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite configuration for the Spellcross tactical sandbox prototype.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  resolve: {
    alias: {
      '@core': '../packages/core/src'
    }
  }
});
