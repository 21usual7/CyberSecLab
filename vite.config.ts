import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// `base` makes asset URLs resolve under the project-pages subpath
// (https://21usual7.github.io/CyberSecLab/). Dev server stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/CyberSecLab/' : '/',
  plugins: [react(), tailwindcss()],
}))
