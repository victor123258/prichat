import { defineConfig } from 'vite'

export default defineConfig({
  base: '/prichat/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/database']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})