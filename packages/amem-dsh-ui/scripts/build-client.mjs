import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "dist", "client.bundle.cjs");
mkdirSync(join(root, "dist"), { recursive: true });

await build({
  entryPoints: [join(root, "client", "panel.tsx")],
  bundle: true,
  platform: "browser",
  format: "cjs",
  outfile,
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "react-dom/client",
    "@deepseek-ai/cordis",
  ],
  logLevel: "info",
});

const body = readFileSync(outfile, "utf8");
const id = "@amem/amem-dsh-ui";
const wrapped = `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
${body}
return module.exports;
} });
`;

writeFileSync(join(root, "dist", "client.js"), wrapped);
console.log("wrote dist/client.js (lazy-CJS)");
