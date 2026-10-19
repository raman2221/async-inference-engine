import { defineConfig } from "vite";

// In development (`npm run dev`) Vite plays the role nginx plays in Docker:
// /api goes to the gateway and /ws to the notifier, so the page always talks
// to its own origin and the backend needs no CORS configuration.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", rewrite: (path) => path.replace(/^\/api/, "") },
      "/ws": { target: "ws://localhost:8081", ws: true },
    },
  },
});
