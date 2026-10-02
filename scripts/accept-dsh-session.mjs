#!/usr/bin/env node
/**
 * DSH session path (no live DSH process): spool → flush/extract → Memory →
 * consolidate → Proposal → apply → compile.
 */
import { createServer, request } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const amemBin = join(root, "packages/cli/dist/bin.js");

let failed = 0;
function pass(name) {
  console.log(`PASS ${name}`);
}
function fail(name, detail) {
  failed += 1;
  console.error(`FAIL ${name}:`, detail);
}

function runAmem(args, env) {
  const r = spawnSync(process.execPath, [amemBin, ...args], { encoding: "utf8", env });
  if (r.status !== 0) {
    throw new Error(`amem ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}

function panelHeaders(extra = {}) {
  return {
    origin: "http://127.0.0.1:7788",
    host: "127.0.0.1:7788",
    "sec-fetch-site": "same-site",
    "content-type": "application/json",
    ...extra,
  };
}

function httpPost(baseUrl, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = request(
      `${baseUrl}${path}`,
      { method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, headers: res.headers, text: data, json });
        });
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function rpc(url, method, params) {
  const res = await httpPost(
    url,
    "/amem-api/rpc",
    { id: "1", method, params },
    panelHeaders(),
  );
  if (res.status === 401 || res.json?.ok === false) {
    return {
      ok: false,
      status: res.status,
      code: res.json?.error?.code ?? res.json?.error,
      body: res.json,
    };
  }
  return { ok: true, status: res.status, result: res.json?.result, body: res.json };
}

async function mountServer(home) {
  const { apply } = await import(
    pathToFileURL(join(root, "packages/adapter-dsh/dist/plugin.js")).href
  );
  let handler;
  apply(
    {
      webServer: {
        register: (route) => {
          handler = route.handler;
          return () => {};
        },
      },
    },
    { amemHome: home },
  );
  if (!handler) throw new Error("/amem-api handler not registered");
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), "amem-accept-dsh-session-"));
  const env = { ...process.env, AMEM_HOME: home };
  console.log(`AMEM_HOME=${home}`);

  try {
    runAmem(["init"], env);
    pass("init");

    const { MemoryStore } = await import(
      pathToFileURL(join(root, "packages/store/dist/index.js")).href
    );
    const { paths } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
    const { enqueueFlush, processQueue } = await import(
      pathToFileURL(join(root, "packages/pipeline/dist/index.js")).href
    );

    const sid = "dsh-sess-smoke";
    mkdirSync(join(home, "spool"), { recursive: true });
    writeFileSync(
      join(home, "spool", `${sid}.jsonl`),
      [
        {
          v: 1,
          ts: new Date().toISOString(),
          host: "dsh",
          session_id: sid,
          user_id: "accept",
          type: "session_start",
          payload: {},
        },
        {
          v: 1,
          ts: new Date().toISOString(),
          host: "dsh",
          session_id: sid,
          user_id: "accept",
          type: "tool_result",
          payload: { output: "Error: Port 3000 is already in use" },
        },
        {
          v: 1,
          ts: new Date().toISOString(),
          host: "dsh",
          session_id: sid,
          user_id: "accept",
          type: "session_end",
          payload: {},
        },
      ]
        .map((e) => `${JSON.stringify(e)}\n`)
        .join(""),
    );
    pass("write synthetic spool");

    const queued = enqueueFlush(home, sid);
    const processed = await processQueue(home);
    if (!queued || processed < 1) {
      throw new Error(`flush did not process: queued=${queued} processed=${processed}`);
    }
    pass("enqueueFlush + processQueue");

    const store = new MemoryStore(home);
    const all = store.listAll();
    if (all.length < 1) throw new Error("expected memories after extract");
    const mem = all[0];
    pass(`extract wrote memory ${mem.id}`);

    // Raise evidence so consolidate can promote+propose (simulates multi-session adoption).
    mem.kind = "procedure";
    mem.scope.level = "instance";
    mem.scope.tags.instances = ["a", "b", "c"];
    mem.trust = "T3";
    mem.status = "active";
    mem.evidence.episodes = ["e1", "e2", "e3"];
    mem.evidence.count = 3;
    mem.evidence.distinct_instances = 3;
    mem.stats = { recalled: 4, adopted: 2, helpful: 2, harmful: 0, lift: 0.1 };
    store.write(mem, "pipeline");
    pass("raise evidence for promotion gates");

    const server = await mountServer(home);
    try {
      const consol = await rpc(server.url, "ops.consolidate", { dryRun: false });
      if (!consol.ok) throw new Error(`consolidate: ${consol.code} ${JSON.stringify(consol.body)}`);
      if (!consol.result?.promoted?.includes(mem.id)) {
        throw new Error(`not promoted: ${JSON.stringify(consol.result)}`);
      }
      if (!consol.result?.proposals?.includes(mem.id)) {
        throw new Error(`no proposal: ${JSON.stringify(consol.result)}`);
      }
      pass("ops.consolidate promote+propose");

      const applied = await rpc(server.url, "proposal.apply", {
        id: mem.id,
        skillName: "session-skill",
      });
      if (!applied.ok) {
        throw new Error(`proposal.apply: ${applied.code} ${JSON.stringify(applied.body)}`);
      }
      if (!existsSync(join(paths(home).capabilities, "skills", "session-skill", "SKILL.md"))) {
        throw new Error("skill not materialized");
      }
      pass("proposal.apply");

      const compiled = await rpc(server.url, "ops.compile", { target: "dsh" });
      if (!compiled.ok) throw new Error(`ops.compile: ${compiled.code}`);
      pass("ops.compile dsh");

      const doctor = await rpc(server.url, "ops.doctor", {});
      if (!doctor.ok) throw new Error(`ops.doctor: ${doctor.code}`);
      if (!doctor.result?.status) throw new Error("doctor missing status");
      pass("ops.doctor structured");
    } finally {
      await server.close();
    }
  } catch (e) {
    fail("dsh-session", e instanceof Error ? e.message : e);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  console.log(
    failed ? `\n${failed} DSH session checks failed` : "\nall DSH session acceptance checks passed",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
