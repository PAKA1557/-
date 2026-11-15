/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// BASE_PATH lets the GitHub Pages workflow serve the app under /<repo>/.
// The relative default ('./') works for local preview and any static host.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
