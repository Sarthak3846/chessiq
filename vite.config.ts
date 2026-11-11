import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser calls /api/* on its own origin; Vite forwards it to the FastAPI backend.
// (In production, put the frontend and backend behind one reverse proxy, or set VITE_API_BASE_URL.)
const api = { '/api': { target: process.env.VITE_BACKEND_URL ?? 'http://localhost:8000', changeOrigin: true } }

export default defineConfig({ plugins: [react()], server: { proxy: api }, preview: { proxy: api } })