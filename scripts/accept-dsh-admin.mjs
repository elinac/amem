#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

function jsonFrom(r) {
  const text = r.stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`stdout not JSON: ${text.slice(0, 200)}`);
  }
}

async function mountServer(home) {
  const { apply } = await import(
    new URL("../packages/adapter-dsh/dist/plugin.js", import.meta.url).href
  );
  let handler;
  const ctx = {
    webServer: {
      register: (route) => {
        handler = route.handler;
        return () => {};
      },
    },
  };
  apply(ctx, { amemHome: home });
  if (!handler) throw new Error("/amem-api handler not registered");
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function httpPost(baseUrl, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1",
          host: "127.0.0.1",
          "content-type": "application/json",
          ...extraHeaders,
        },
      },
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

async function rpc(url, cookie, method, params, csrf) {
  const headers = { cookie };
  if (csrf) {
    headers["x-amem-csrf"] = csrf;
    // Match DSH panel: embedded workbench fetch typically sends same-site.
    headers["sec-fetch-site"] = "same-site";
  }
  const res = await httpPost(url, "/amem-api/rpc", { id: "1", method, params }, headers);
  if (res.json && res.json.error) {
    return { ok: false, code: res.json.error.code, status: res.status, body: res.json };
  }
  return { ok: true, status: res.status, body: res.json, result: res.json?.result };
}

function findFiles(dir) {
  const out = [];
  function walk(d) {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else out.push(p);
    }
  }
  walk(dir);
  return out;
}

function assertNoLeak(home, secret) {
  const files = findFiles(home);
  for (const p of files) {
    const rel = relative(home, p);
    if (rel.startsWith("hosts")) continue; // host wrapper contains repo paths only
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (text.includes(secret)) {
      throw new Error(`secret leaked into ${rel}`);
    }
  }
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), "amem-accept-dsh-admin-"));
  const env = { ...process.env, AMEM_HOME: home };
  console.log(`AMEM_HOME=${home}`);

  let readOnly;
  let configTok;

  try {
    // 1) init
    runAmem(["init"], env);
    pass("init");

    // 2) start adapter route test server (also creates auth/ directory)
    const server = await mountServer(home);
    try {
      // 3) issue read-only token
      readOnly = jsonFrom(runAmem(["auth", "issue", "--target", "dsh", "--scopes", "memory:read,skill:read,proposal:read,config:read", "--ttl", "1h"], env));
      if (!readOnly.ok || !readOnly.token) throw new Error("read-only issue failed");
      pass("issue read-only token");

      // 4) login + memory.list
      const login = await httpPost(server.url, "/amem-api/auth/session", { bearer: readOnly.token });
      if (login.status !== 200 || !login.json?.ok) throw new Error(`login failed: ${login.text}`);
      const setCookie = Array.isArray(login.headers["set-cookie"])
        ? login.headers["set-cookie"][0]
        : String(login.headers["set-cookie"]);
      const cookie = setCookie.split(";")[0].trim();
      const csrf = login.json.csrfToken;
      if (!setCookie.includes("HttpOnly") || !setCookie.includes("SameSite=Strict") || !setCookie.includes("Path=/amem-api")) {
        throw new Error(`cookie missing safety attributes: ${setCookie}`);
      }
      pass("login and safe cookie");

      const list = await rpc(server.url, cookie, "memory.list", { page: 1 });
      if (!list.ok) throw new Error(`memory.list failed: ${list.code} ${JSON.stringify(list.body)}`);
      if (list.result?.pageSize !== 20) throw new Error(`unexpected default pageSize: ${list.result?.pageSize}`);
      pass("memory.list with session scope");

      // 5) config.get has no api_key
      const cfgGet = await rpc(server.url, cookie, "config.get", {});
      if (!cfgGet.ok) throw new Error(`config.get failed: ${cfgGet.code}`);
      if (cfgGet.result?.config?.llm?.api_key !== undefined) {
        throw new Error("config.get exposed raw api_key");
      }
      if (cfgGet.result?.config?.llm?.has_api_key === undefined) {
        throw new Error("config.get missing has_api_key flag");
      }
      pass("config.get hides api_key");

      // 6) read-only token cannot config.put
      const putDenied = await rpc(server.url, cookie, "config.put", {
        config: { identity: { user_id: "x" } },
        api_key_replacement: "",
      }, csrf);
      if (putDenied.ok) throw new Error("config.put should have been denied");
      if (putDenied.code !== "unauthenticated" && putDenied.code !== "permission_denied") {
        throw new Error(`expected unauthenticated or permission_denied, got ${putDenied.code}`);
      }
      pass("read-only token rejects config.put");

      // 7) issue config token + verify CSRF for mutation
      configTok = jsonFrom(runAmem(["auth", "issue", "--target", "dsh", "--scopes", "config:read,config:write", "--ttl", "1h"], env));
      if (!configTok.ok || !configTok.token) throw new Error("config issue failed");
      pass("issue config token");

      const configLogin = await httpPost(server.url, "/amem-api/auth/session", { bearer: configTok.token });
      if (configLogin.status !== 200 || !configLogin.json?.ok) throw new Error("config login failed");
      const configCookie = String(configLogin.headers["set-cookie"]).split(";")[0].trim();
      const configCsrf = configLogin.json.csrfToken;

      // mutation without CSRF must fail
      const noCsrf = await rpc(server.url, configCookie, "config.put", {
        config: { identity: { user_id: "accept" } },
        api_key_replacement: "",
      });
      if (noCsrf.ok) throw new Error("mutating RPC without CSRF should fail");
      if (noCsrf.code !== "unauthenticated") throw new Error(`expected unauthenticated, got ${noCsrf.code}`);
      pass("mutation requires CSRF");

      // mutation with CSRF succeeds
      const putOk = await rpc(
        server.url,
        configCookie,
        "config.put",
        { config: { identity: { user_id: "accept" } }, api_key_replacement: "" },
        configCsrf,
      );
      if (!putOk.ok) throw new Error(`config.put with CSRF failed: ${putOk.code}`);
      pass("config token mutates with valid CSRF");

      // 8) revoke token + short session fails
      const revoke = jsonFrom(runAmem(["auth", "revoke", configTok.record.id], env));
      if (!revoke.ok) throw new Error("revoke failed");
      pass("revoke token");

      const afterRevoke = await rpc(server.url, configCookie, "config.get", {});
      if (afterRevoke.ok) throw new Error("session still valid after token revoke");
      if (afterRevoke.code !== "unauthenticated") throw new Error(`expected unauthenticated, got ${afterRevoke.code}`);
      pass("revoked token invalidates short session");
    } finally {
      await server.close();
    }

    // 9) raw token never in disk/logs
    assertNoLeak(home, readOnly.token);
    assertNoLeak(home, configTok.token);
    pass("raw tokens not on disk/logs");
  } catch (e) {
    fail("acceptance", e instanceof Error ? e.message : e);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} acceptance checks failed` : "\nall DSH admin acceptance checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
