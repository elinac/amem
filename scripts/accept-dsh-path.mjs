#!/usr/bin/env node
/**
 * DSH Admin/RPC path: Memory → consolidate → Proposal → apply → compile
 * Uses auth-disabled + panel-like Origin/Sec-Fetch-Site headers (S2).
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
  const home = mkdtempSync(join(tmpdir(), "amem-accept-dsh-path-"));
  const env = { ...process.env, AMEM_HOME: home };
  console.log(`AMEM_HOME=${home}`);

  try {
    runAmem(["init"], env);
    pass("init");

    const { MemoryStore } = await import(
      pathToFileURL(join(root, "packages/store/dist/index.js")).href
    );
    const { paths } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
    new MemoryStore(home).write(
      {
        id: "mem_path",
        kind: "procedure",
        title: "path procedure",
        content: "1. do\n2. it",
        applies_when: "path test",
        scope: { level: "instance", tags: { instances: ["a", "b", "c"] } },
        trust: "T3",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 4, adopted: 2, helpful: 2, harmful: 0, lift: 0.1 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "accept",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    pass("seed instance memory");

    const server = await mountServer(home);
    try {
      const consol = await rpc(server.url, "ops.consolidate", { dryRun: false });
      if (!consol.ok) throw new Error(`consolidate: ${consol.code} ${JSON.stringify(consol.body)}`);
      if (!consol.result?.promoted?.includes("mem_path")) {
        throw new Error(`not promoted: ${JSON.stringify(consol.result)}`);
      }
      if (!consol.result?.proposals?.includes("mem_path")) {
        throw new Error(`no same-pass proposal: ${JSON.stringify(consol.result)}`);
      }
      pass("ops.consolidate promote+propose");

      const listed = await rpc(server.url, "proposal.list", {});
      if (!listed.ok) throw new Error(`proposal.list: ${listed.code}`);
      const items = listed.result?.items ?? [];
      if (!items.some((it) => it.id === "mem_path" || it === "mem_path")) {
        // list shape may be objects with id/name
        const ok = JSON.stringify(items).includes("mem_path");
        if (!ok) throw new Error(`proposal.list missing mem_path: ${JSON.stringify(items)}`);
      }
      pass("proposal.list");

      const applied = await rpc(server.url, "proposal.apply", {
        id: "mem_path",
        skillName: "path-skill",
      });
      if (!applied.ok) throw new Error(`proposal.apply: ${applied.code} ${JSON.stringify(applied.body)}`);
      if (!existsSync(join(paths(home).capabilities, "skills", "path-skill", "SKILL.md"))) {
        throw new Error("skill not materialized");
      }
      pass("proposal.apply");

      const compiled = await rpc(server.url, "ops.compile", { target: "dsh" });
      if (!compiled.ok) throw new Error(`ops.compile: ${compiled.code}`);
      pass("ops.compile dsh");
    } finally {
      await server.close();
    }
  } catch (e) {
    fail("dsh-path", e instanceof Error ? e.message : e);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} DSH path checks failed` : "\nall DSH path acceptance checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
