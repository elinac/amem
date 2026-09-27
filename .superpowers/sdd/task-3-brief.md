### Task 3: Routes GET/PUT `/amem-api/config`

**Files:**
- Modify: `packages/adapter-dsh/src/plugin.ts`（在 `/compile` 路由之后、`404` 之前）

**Interfaces:**
- Consumes: `admin.getConfig()`, `admin.putConfig(body)`
- Produces: HTTP handlers same style as `/doctor`

- [ ] **Step 1: Add routes**

```ts
if (method === "GET" && path === "/config") {
  const r = admin.getConfig();
  sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
  return;
}

if (method === "PUT" && path === "/config") {
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    sendJson(res, 400, { error: "bad_request", message: "invalid JSON" });
    return;
  }
  const r = admin.putConfig(body);
  sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
  return;
}
```

- [ ] **Step 2: Typecheck / build adapter**

Run: `cd packages/adapter-dsh && pnpm build`  
Expected: exit 0

- [ ] **Step 3: Commit**（仅当用户要求时）

```bash
git add packages/adapter-dsh/src/plugin.ts
git commit -m "feat(adapter-dsh): expose GET/PUT /amem-api/config"
```

---

