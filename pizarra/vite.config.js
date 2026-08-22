import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { pizarraApi } from './server/api.js'

// Two shapes of build:
//
//   npm run build         normal build; /api serves data/pizarra.json
//   npm run build:static  one self-contained index.html, localStorage instead
//                         of the file, for a static host or a phone
//
// VITE_STORAGE=local is what src/storage/index.js reads to pick its driver.
export default defineConfig(({ mode }) => {
  const singleFile = process.env.VITE_STORAGE === 'local';
  return {
    // Relative URLs so the page works from any path on a static host.
    base: './',
    plugins: [
      react(),
      ...(singleFile ? [viteSingleFile()] : [pizarraApi()]),
    ],
    build: {
      // Fonts and other assets become data: URIs so the page stands alone.
      assetsInlineLimit: singleFile ? Number.MAX_SAFE_INTEGER : 4096,
      outDir: singleFile ? 'dist-static' : 'dist',
      chunkSizeWarningLimit: singleFile ? 4096 : 500,
    },
  };
})
