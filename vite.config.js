import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served under /altered on the unified domain (Vercel multi-zone).
  base: '/altered/',
  plugins: [react()],
});
