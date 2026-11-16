import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MEDIA_ROOTS = ["data", "runs"].map((d) => path.join(REPO_ROOT, d) + path.sep);
const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".vtt": "text/vtt",
};

/**
 * Fixture mode only: serve /media/<repo path> straight from data/ and runs/ (with Range support
 * so the video can seek) because the FastAPI server that normally does this may not be running.
 */
function fixtureMedia(): Plugin {
  return {
    name: "fixture-media",
    configureServer(server) {
      server.middlewares.use("/media", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const file = path.resolve(REPO_ROOT, rel);
        if (!MEDIA_ROOTS.some((root) => file.startsWith(root)) || !fs.existsSync(file)) return next();
        const { size } = fs.statSync(file);
        const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", type);
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          fs.createReadStream(file, { start, end }).pipe(res);
        } else {
          res.setHeader("Content-Length", String(size));
          fs.createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const fixtures = env.VITE_USE_FIXTURES === "1";
  // 127.0.0.1, not localhost: a Docker container owns IPv6 *:8000 on the dev machine.
  const backend = "http://127.0.0.1:8000";
  return {
    plugins: [react(), ...(fixtures ? [fixtureMedia()] : [])],
    server: {
      port: 5173,
      proxy: {
        "/api": backend,
        ...(fixtures ? {} : { "/media": backend }),
      },
    },
  };
});
