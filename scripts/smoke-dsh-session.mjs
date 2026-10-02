#!/usr/bin/env node
/**
 * Live DSH session smoke hook.
 *
 * If AMEM_DSH_SMOKE_URL is unset → exit 0 (skip).
 * If set → POST minimal /amem-api/rpc probes (ops.doctor, conflict.list) with panel-like headers.
 *
 * Optional: AMEM_DSH_SMOKE_TOKEN for Authorization: Bearer when auth_enabled=true.
 */
import { request } from "node:http";
import { request as requestHttps } from "node:https";

const base = process.env.AMEM_DSH_SMOKE_URL?.replace(/\/$/, "");
if (!base) {
  console.log("SKIP smoke-dsh-session: AMEM_DSH_SMOKE_URL not set");
  process.exit(0);
}

const token = process.env.AMEM_DSH_SMOKE_TOKEN?.trim() || "";

function panelHeaders(extra = {}) {
  const h = {
    origin: base,
    "sec-fetch-site": "same-site",
    "content-type": "application/json",
    ...extra,
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

function httpJson(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? requestHttps : request;
    const req = lib(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
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
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on("error", reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log(`smoke against ${base}`);
  const doctor = await httpJson(
    "POST",
    `${base}/amem-api/rpc`,
    { id: "smoke-1", method: "ops.doctor", params: {} },
    panelHeaders(),
  );
  if (doctor.status !== 200 || doctor.json?.ok !== true) {
    console.error("FAIL ops.doctor", doctor.status, doctor.text?.slice(0, 400));
    process.exit(1);
  }
  console.log("PASS ops.doctor", doctor.json.result?.status ?? "");

  const conflicts = await httpJson(
    "POST",
    `${base}/amem-api/rpc`,
    { id: "smoke-2", method: "conflict.list", params: {} },
    panelHeaders(),
  );
  if (conflicts.status !== 200 || conflicts.json?.ok !== true) {
    console.error("FAIL conflict.list", conflicts.status, conflicts.text?.slice(0, 400));
    process.exit(1);
  }
  console.log(
    "PASS conflict.list",
    `n=${(conflicts.json.result?.conflicts ?? []).length}`,
  );
  console.log("PASS live DSH session smoke");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
