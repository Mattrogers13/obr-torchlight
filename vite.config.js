import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildLabel, manifestForBranch } from './src/devManifest'

// Renames dist/manifest.json on non-main Cloudflare builds (see devManifest.ts).
const devManifest = () => ({
  name: 'dev-manifest',
  apply: 'build',
  closeBundle() {
    const path = resolve('dist/manifest.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const out = manifestForBranch(manifest, process.env.WORKERS_CI_BRANCH)
    if (out !== manifest) writeFileSync(path, JSON.stringify(out, null, 2) + '\n')
  },
})

export default defineConfig({
  plugins: [react(), devManifest()],
  define: {
    'import.meta.env.VITE_BUILD_LABEL': JSON.stringify(
      buildLabel(process.env.WORKERS_CI_BRANCH, process.env.WORKERS_CI_COMMIT_SHA),
    ),
  },
  server: {
    cors: true // Enables CORS with default settings (allows all origins)
  },
})
