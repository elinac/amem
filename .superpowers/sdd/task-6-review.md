# Task 6 审阅 — 组件化 DSH 工作台

**Commit:** `c096e18` (`feat(ui): rebuild DSH memory workbench`)  
**范围:** `packages/amem-dsh-ui/client/*`、`package.json`、`tsconfig.client.json`、`vitest.config.ts`  
**模式:** 只读 spec + 质量审阅

## Spec 对照（Brief + 设计 §7–8 要点）

| 要求 | 结果 | 证据 |
|------|------|------|
| 拆分 `api.ts` / `styles.ts` / `components.ts`，瘦身 `panel.tsx` | ✅ | 9 文件 commit；`panel.tsx` 改为组合层 |
| `AuthState` 四态；Bearer 仅作 `login()` 参数，不进 storage/URL | ✅ | `api.ts` `login()` 仅 `setSession(csrf…)`；`panel` 无 bearer state |
| 解锁后清空输入（Brief 字面） | ⚠️ | `UnlockView` 仅清闭包变量 `inputValue`，非受控 `<input>` 在失败/解锁中 DOM 仍可能保留 token |
| RPC 客户端 + CSRF 头 | ✅ | `rpcCall` → `POST /amem-api/rpc`，`x-amem-csrf` |
| 记忆：300ms 防抖、筛选重置页码、序号丢弃陈旧响应、骨架/保留旧列表/空态/超范围页 | ✅ | `useDebouncedValue(300)`、`nextQuery`、`sequenceRef`+`isStale`、`effectivePage` 重试 |
| `pageSize` 20/50/100 | ✅ | `PAGE_SIZES`、`FilterBar` select |
| skills/proposals/ops/config 走 RPC | ✅ | `api.ts` `rpc.*`；`panel` `runOps` / `loadConfig` |
| 运维：摘要优先，原始 JSON 在 `<details>` | ✅ | `renderOps` 折叠 `pre` |
| 配置：不展示密钥，write-only 替换字段 | ✅ | `renderConfig` 仅 password 替换；`config.put` 带 `api_key_replacement` |
| 审阅：空态文案，不调用 `conflict.*` | ✅ | `renderReview` + `review.empty` locale |
| 组件与 token（宿主 CSS var、无卡片墙） | ✅ | `styles.ts` tokens；`UnlockView`/`SideNav`/… |
| 宽屏侧栏 / `<720px` Tab | ✅ | `useWindowWidth` + `SideNav`/`TopNav` |
| `package.json`：`vitest run` 后双 `tsc --noEmit` | ✅ | 本审阅重跑 `pnpm test` 8/8 + tsc 通过 |
| 纯函数测试（Brief 所列） | ✅ | `pure.test.ts` |
| 设计 §8.1 最近刷新时间 | ❌ | 顶栏仅 `header.summary`，无刷新时间 |
| 设计 §8.2 正文两行预览 | ❌ | `MemoryRow`/`rowPreview` 无 line-clamp |
| 设计 §8.3 配置多分区表单 | ⚠️ | 仅 LLM API Key 替换 UI；其余配置 silent round-trip |

**Spec 结论: PASS**（Task 6 Brief 交付项基本满足；设计 §8 中审阅冲突 UI、刷新时间、两行预览、完整配置表单属后续/首期裁剪，Brief 已明确审阅空态与 config 密钥规则）

## 质量

### Important

1. **解锁输入未真正清空** — `components.ts` `UnlockView` 使用非受控 password input，`submit()` 只重置闭包 `inputValue`，未 `ref.value = ""` 或受控 `value`。登录失败或 `unlocking` 期间 Bearer 仍留在 DOM（违反 Brief「clear input after」的安全意图）。

2. **FilterBar 搜索框与「清除筛选」不同步** — `FilterBar` 用 `defaultValue` + 局部 `searchValue`，React 不会在 `clearFilters` 后更新非受控 input；用户可能看到旧搜索词与 `filters` 不一致。

3. **Bearer 留存测试过弱** — `pure.test.ts` 仅断言 `import("./api.js")` 的 export 名不含 `bearer`，未覆盖 `UnlockView`/`panel` 状态面；无法回归 DOM 清空问题。

4. **`refreshCsrf` 未使用** — `panel.tsx` import 无调用；会话续期/过期恢复路径缺失（若后续 Task 依赖，需接线或删 import）。

### 观察（非阻塞）

- `authState.ready` 在 React 中持有 `csrf`（Brief 允许）；模块级 `currentCsrf` 与 state 双份，一致性问题低但可文档化。
- `FilterSelect` 全选 option 文案硬编码「全部」（中英混用风险）。
- a11y：`StatusMessage`/`UnlockView` 错误有 `role`/`aria-live`；分页有 `{start}-{end}/{total}`；未浏览器实机验证（与报告一致）。

## 验证

本审阅在 `packages/amem-dsh-ui` 执行 `pnpm test`：Vitest 8 通过，host + client `tsc --noEmit` 通过。

---

**Spec: PASS**  
**Quality: CHANGES_REQUESTED**（Important #1–#2 建议合并前修复；#3 补组件级或 DOM 清空测试）
