// Build del frontend: node build.mjs [--watch]
// Produce dist/ (servita dal backend in produzione e usata dall'app mobile Capacitor).
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/assets", { recursive: true });
cpSync("public", "dist", { recursive: true });

const opts = {
  entryPoints: { app: "src/main.jsx" }, bundle: true, outdir: "dist/assets", format: "esm", target: ["es2020", "safari15"],
  minify: !watch, sourcemap: watch, jsx: "automatic", loader: { ".js": "jsx" }, define: { "process.env.NODE_ENV": watch ? '"development"' : '"production"' },
  logLevel: "info", legalComments: "none",
};
if (watch) { const ctx = await context(opts); await ctx.watch(); }
else await build(opts);

// configurazione runtime: per l'app mobile ISA_API_BASE=https://gestionale.tuodominio.it
writeFileSync("dist/config.js", `window.ISA_API_BASE = ${JSON.stringify(process.env.ISA_API_BASE || "")};\n`);

// cache-busting
const h = createHash("sha1").update(readFileSync("dist/assets/app.js")).update(readFileSync("dist/assets/app.css")).digest("hex").slice(0, 10);
writeFileSync("dist/index.html", readFileSync("index.html", "utf8").replace("assets/app.css", `assets/app.css?v=${h}`).replace("assets/app.js", `assets/app.js?v=${h}`));
