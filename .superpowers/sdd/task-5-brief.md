### Task 5: README + reinstall hint

**Files:**
- Modify: `README.md`（DSH Web 扩展小节，约面板描述处）

- [ ] **Step 1: Update copy**

将「记忆 / 能力 / 提案」改为「记忆 / 能力 / 提案 / 运维 / 说明」，并加一句：运维 Tab 对应 `doctor` / `flush` / `rebuild-index` / `consolidate` / `compile --target dsh`（面板 compile 固定 dsh）。

- [ ] **Step 2: Manual smoke（实现者执行）**

```powershell
pnpm --filter @amem/adapter-dsh build
pnpm --filter @amem/amem-dsh-ui build
# 若 wrapper 未变可不重装；改的是 dist 被 file URL 引用则重启即可
# 重启 dsh web 后：运维→健康检查有 JSON；切到说明不请求 /proposals；中英切换文案变化
```

- [ ] **Step 3: Commit（仅当用户要求）**

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| A: doctor/flush/rebuild-index | 1–2, 4 |
| B: consolidate/compile(dsh); apply 已有 | 1–2, 4 |
| 说明页 | 3–4 |
| load() 契约 | 4 |
| sessionId 校验 / 空白归一 | 1 |
| compile 仅 dsh (O3) | 1–2, 4 |
| async flush await | 2 |
| locale zh/en | 3 |
| README | 5 |
| 不 spawn / 无 CSRF 新做 | 全局 |

## Placeholder scan

无 TBD /「类似 Task N」占位。

## Type consistency

- Admin 方法名：`doctor` / `flush` / `rebuildIndex` / `consolidate` / `compile`
- 路径：`/doctor` `/flush` `/rebuild-index` `/consolidate` `/compile`
- Tab：`ops` / `help`；locale：`tab.ops` / `tab.help`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-27-dsh-panel-ops-help.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新子代理 + 任务间复审  
2. **Inline Execution** — 本会话按 executing-plans 批量推进并设检查点  

选哪种？
