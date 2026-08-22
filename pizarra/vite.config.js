import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pizarraApi } from './server/api.js'

// The API plugin serves /api from data/pizarra.json in both `dev` and
// `preview`; `server/index.js` does the same for a standalone run.
export default defineConfig({
  plugins: [react(), pizarraApi()],
})
