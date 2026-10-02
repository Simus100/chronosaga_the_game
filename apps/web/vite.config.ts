import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The identity of the build, stamped into the bundle for the playtest overlay
 * and telemetry (GQP-D). In CI the commit is `GITHUB_SHA`, the exact head the
 * workflow checked out; elsewhere it is read from git. Never gameplay input.
 */
function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

const build = {
  commit: process.env.GITHUB_SHA ?? git("rev-parse HEAD") ?? "unknown",
  branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git("rev-parse --abbrev-ref HEAD") || "unknown",
  builtAt: new Date().toISOString()
};

export default defineConfig({
  plugins: [react()],
  define: {
    __CHRONOSAGA_BUILD__: JSON.stringify(build)
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
});
