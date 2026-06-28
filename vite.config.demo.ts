/**
 * Standalone Vite config for the StyleSnap web demo.
 * Builds only the demo entry point as a self-contained JS file
 * for embedding on lucidlibs.dev/stylesnap.
 *
 * Does NOT use the CRX plugin — output is a regular IIFE script.
 */
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/demo/main.ts'),
      name: 'StyleSnapDemo',
      formats: ['iife'],
      fileName: () => 'stylesnap-demo.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: 'es2020',
    minify: 'esbuild',
  },
  define: {
    'import.meta.env.MODE': '"production"',
  },
})
