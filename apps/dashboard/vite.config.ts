import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In development Vite serves the UI and hands /api to the dashboard API (pnpm dashboard runs both).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "DASHBOARD_");
  return {
    plugins: [react()],
    envDir: "../..",
    server: {
      port: 5180,
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${env.DASHBOARD_PORT || 8081}` },
    },
  };
});
