import { defineConfig } from 'vite';
export default defineConfig({ base: './', worker: { format: 'es' }, optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] } });
