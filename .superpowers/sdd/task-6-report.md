# Task 6 报告：组件化并重做 DSH 工作台

## 完成内容

- 拆分 `packages/amem-dsh-ui/client/`：
  - `api.ts`：认证/RPC 客户端、纯辅助函数（`nextQuery`、`effectivePage`、`isStale`、`rpcErrorMessage`）。
  - `styles.ts`：语义化设计 token，优先使用宿主 CSS variables 并提供 light/dark fallback，无渐变/重阴影/卡片墙。
  - `components.ts`：`UnlockView`、`SideNav`、`TopNav`、`FilterBar`、`MemoryRow`、`Pagination`、`StatusMessage`、`SkeletonList`、`EmptyState`。
  - `panel.tsx`：页面级状态组合，响应式布局（宽屏左侧导航，<720px 横向 tabs）。
  - `pure.test.ts`：Vitest 纯函数测试。
- 更新 `locales.ts`：新增解锁、导航、筛选、分页、审阅空态等中文/英文词条。
- 更新 `package.json`：`test` 先跑 `vitest run` 再 `tsc --noEmit`（host + client 两份配置）。
- 新增 `tsconfig.client.json` 与 `vitest.config.ts`，让客户端代码参与类型检查和测试。

## 行为验证

- 搜索框 300ms 防抖；筛选/搜索改变时 `nextQuery` 重置页码到 1。
- `memory.list` 请求序号递增，旧响应被丢弃。
- 后端返回 `total=0` 时固定在第 1 页；超范围页码通过 `effectivePage` 回退到最后一页后重试。
- Bearer token 只作为 `login()` 参数；未存入 React state、storage、URL 或全局变量。
- 配置视图仅展示 write-only API Key 替换字段，原密钥不渲染。
- 运维结果默认折叠，原始 JSON 放入 `<details>`。
- 审阅视图在未接入 `conflict.*` 前显示明确空态，不调用不存在的方法。

## 测试结果

```text
pnpm --filter @amem/amem-dsh-ui test    # 8 项通过 + tsc 通过
pnpm --filter @amem/amem-dsh-ui build   # 成功，client.js 66.6kb
pnpm --filter @amem/adapter-dsh test    # 65 项通过
```

## 静态可访问性检查

在代码层面验证以下项目，未进行浏览器实机验证：

- **Tab 顺序**：解锁输入 → 解锁按钮 → 导航按钮 → 搜索/筛选下拉 → 列表行 → 分页按钮 → 保存/重载按钮；所有可交互元素均为原生 `<button>`/`<input>`/`<select>`，按 DOM 顺序聚焦。
- **焦点可见**：按钮/输入框/选择框均使用 `:focus-visible`（浏览器默认）且组件样式保留 outline；`focusRing` token 预留但未在组件中显式替代浏览器 ring，避免隐藏焦点。
- **`aria-live`**：`StatusMessage` 使用 `role="status"` 与 `aria-live="polite"`；解锁错误使用 `role="alert"` 与 `aria-live="polite"`。
- **横向滚动**：窄屏工具栏和 Tab 导航设置 `overflowX: "auto"`，可通过键盘/手势滚动容器。
- **结果数宣告**：分页组件始终显示 `{start}-{end} / {total}`。

未在真实浏览器中验证焦点顺序与屏幕阅读器输出。

## 提交

```text
feat(ui): rebuild DSH memory workbench
```

仅提交 `packages/amem-dsh-ui/client/*`、`packages/amem-dsh-ui/package.json`、`packages/amem-dsh-ui/tsconfig.client.json`、`packages/amem-dsh-ui/vitest.config.ts`，未触碰 `ocr-review.md`。
