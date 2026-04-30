import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/widget.ts'),
      name: 'RPPersonalizer',
      formats: ['iife'],
      fileName: () => 'personalizer.js',
    },
    outDir: '../../public/storefront',
    emptyOutDir: false,
    rollupOptions: {
      output: { extend: true },
    },
    minify: 'terser',
  },
});
