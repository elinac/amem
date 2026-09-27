// Production Cursor hook: normalize → spool → queue flush on sessionEnd; fail-open.
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const event = process.argv[2] ?? "unknown";
const home = process.env.AMEM_HOME ?? join(homedir(), ".amem");
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function sanitizeId(id) {
  const s = String(id ?? "").trim();
  if (SAFE_ID.test(s)) return s;
  return `sid_${createHash("sha256").update(s || "empty").digest("hex").slice(0, 12)}`;
}

function respond() {
  process.stdout.write(event === "beforeSubmitPrompt" ? '{"continue":true}' : "{}");
  process.exit(0);
}

let settled = false;
async function run(rawText) {
  if (settled) return;
  settled = true;
  try {
    const body = rawText.replace(/^\uFEFF/, "").trim();
    let raw = {};
    try {
      raw = body ? JSON.parse(body) : {};
    } catch {
      raw = { _unparsed: body.slice(0, 500) };
    }

    // dynamic import compiled adapter if present; else write raw spool only
    let events = [];
    try {
      const adapterPath = join(
        dirname(fileURLToPath(import.meta.url)),
        "../dist/index.js",
      );
      if (existsSync(adapterPath)) {
        const mod = await import(pathToFileURL(adapterPath).href);
        events = mod.normalizeCursorHook(event, raw, process.env.USER ?? "local");
      }
    } catch {
      events = [];
    }

    const sessionId = sanitizeId(raw.conversation_id || raw.session_id || "unknown");
    mkdirSync(join(home, "spool"), { recursive: true });
    const spool = join(home, "spool", `${sessionId}.jsonl`);
    for (const ev of events) {
      appendFileSync(spool, `${JSON.stringify(ev)}\n`);
    }
    // always keep raw sample (bounded) for adapter calibration
    mkdirSync(join(home, "spool", "raw"), { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(
      join(home, "spool", "raw", `${day}.jsonl`),
      `${JSON.stringify({ ts: new Date().toISOString(), event, keys: Object.keys(raw) })}\n`,
    );

    if (event === "sessionEnd" || event === "preCompact") {
      const qdir = join(home, "queue");
      mkdirSync(qdir, { recursive: true });
      writeFileSync(
        join(qdir, `flush-${sessionId}-${Date.now()}.json`),
        JSON.stringify({ type: "flush", sessionId }),
      );
      // detached worker best-effort
      const cli = join(dirname(fileURLToPath(import.meta.url)), "../../cli/dist/bin.js");
      if (existsSync(cli)) {
        const child = spawn(process.execPath, [cli, "worker"], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env, AMEM_HOME: home },
        });
        child.unref();
      }
    }
  } catch {
    // fail-open
  }
  respond();
}

let buf = "";
const guard = setTimeout(() => {
  void run(buf);
}, 1500);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
});
process.stdin.on("end", () => {
  clearTimeout(guard);
  void run(buf);
});
process.stdin.on("error", () => {
  clearTimeout(guard);
  if (!settled) {
    settled = true;
    respond();
  }
});
