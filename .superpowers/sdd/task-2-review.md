# Task 2 代码审查 — 长期能力令牌与 CLI

**基准:** `d6eda82` → **头:** `043e256`  
**审查范围:** `auth-store.ts`, `auth-store.test.ts`, `adapter-dsh/index.ts`, `cli/bin.ts`, `list-export.test.ts`  
**依据:** `task-2-brief.md`（`task-2-report.md` 为未复跑测试的参考）

---

## 结论摘要

| 维度 | 结果 |
|------|------|
| Spec compliance | **PASS** |
| Quality | **CHANGES_REQUESTED**（2 项 Important） |

---

## Spec 符合性

### 已满足

1. **接口与类型** — `DshAdminScope`、`PublicTokenRecord`、`VerifiedToken`、`DshTokenStore.issue/list/verify/revoke` 与 brief 一致；`index.ts` 导出完整。
2. **测试（Step 1）** — 五项用例齐全；读取 `dsh-tokens.json` 断言不含签发 token；`list` 无 `hash`、未知/重复 scope、双实例持久化均覆盖。
3. **实现（Step 3）** — `randomBytes(32).base64url`、SHA-256 base64url 落盘、`timingSafeEqual`、schema `version: 1`、临时文件 + `fsync` + `rename`、`auth/.issue-lock` 串行 `issue`/`revoke`；公开记录不含 hash。
4. **CLI（Step 4）** — `amem auth issue|list|revoke`、可导出的 `parseDurationMs`（m/h/d、零/负/>365d/非法格式）、`issue` JSON 仅该次含 `token`；`import.meta.url` 守卫便于单测。
5. **全局约束** — diff 仅 5 文件，未动 `ocr-review.md`、未引入 Connection auth；token 不进 URL/TOML；磁盘与 `list` 输出不含 bearer（`issue`  stdout 为 brief 要求的一次性披露）。
6. **提交** — `feat(dsh): add scoped admin tokens`，与 brief Step 6 一致。

### 与 brief 的细微差异（不判 FAIL）

- `PublicTokenRecord.lastUsedAt` 在类型中存在，`verify` 未更新该字段；Task 2 步骤未要求，留待后续 RPC/会话任务合理。
- TTL 上限 365 天仅在 CLI parser  enforced，`DshTokenStore.issue` 仍接受任意正 `ttlMs`；brief 仅约束 duration parser。

---

## 质量与风险

### Important — 损坏/非预期 JSON 静默丢弃全部令牌

`readFile()` 在 parse 失败或 `version !== 1` 时返回 `{ version: 1, tokens: [] }`，不报错。下一次 `issue`/`revoke` 在锁内读盘、修改并 **整文件写回**，会在无告警情况下 **覆盖并丢失** 原有全部 token 记录。

**建议:** 读盘失败时抛出明确错误（或只读拒绝写入）；或备份/保留旧文件后再写；至少增加 corrupt-file 测试锁定行为。

### Important — `verify` 对畸形记录未隔离，可抛 TypeError

循环中对每条记录执行 `Buffer.from(t.hash, "base64url")`。若磁盘上某条缺少 `hash`（手工编辑或部分迁移），`verify` **整次调用抛错**，而非返回 `null`。与「无效 token → null」的语义不一致，可能影响后续 Task 3 的 bearer 校验路径。

**建议:** 校验 `typeof t.hash === "string"` 且长度合理，否则 `continue`；或为单条记录包 try/catch。

### Nice-to-have（不阻塞）

- 目录锁使用 busy-wait + 5s 超时；进程崩溃可能留下 `.issue-lock`，需人工清理或 stale-lock 检测。
- `verify`/`list` 无锁，与 `issue`/`revoke` 并发时依赖 rename 原子性，一般可接受。
- 未复跑 `pnpm test`/`build`；与 report 声称一致但未验证。

---

## 安全与全局约束（静态审查）

| 检查项 | 结论 |
|--------|------|
| Bearer 明文落盘 | **通过** — 测试 + 实现仅 hash |
| Bearer 进日志/错误信息 | **通过** — 仅 `issue` 成功路径 stdout JSON；`revoke` 失败仅 token **id** |
| `ocr-review.md` | **未触碰** |
| Schema v1 | **通过** |

---

## 对实现报告声称的核对

| 声称 | 审查结论 |
|------|----------|
| adapter-dsh 30 tests / cli 3 tests / build PASS | 未复跑；diff 与用例设计合理 |
| 无顾虑 | 见上文 Important 两项 |

---

## 审查清单

- [x] Token 仅 hash 持久化
- [x] 过期/撤销拒绝
- [x] list/文件不含 raw token
- [x] scope 校验
- [x] CLI auth 三子命令 + duration parser
- [x] 导出与 commit 范围
- [ ] 损坏 store 与畸形 record 的可靠性（Important 未闭合）
