# Whole-branch review package\n\nSpec: docs/superpowers/specs/2026-09-27-dsh-panel-ops-help-design.md\nPlan: docs/superpowers/plans/2026-09-27-dsh-panel-ops-help.md\n\n## packages/adapter-dsh/src/admin.ts (1 lines)\n\n## packages/adapter-dsh/src/admin-ops.test.ts (1 lines)\n\n## packages/adapter-dsh/src/plugin.ts (2 lines)\n\n## packages/amem-dsh-ui/client/locales.ts (1 lines)\n\n## packages/amem-dsh-ui/client/panel.tsx (1 lines)\n\n\n## README excerpt\n\nDSH Web 扩展（仅 `dsh web`）：**

- Cordis 插件监听 `session/event` 写入 `~/.amem/spool`（fail-open）  
- Host 注册同域 `/amem-api`（需 `export const inject = ['webServer','connection']`，鉴权用 Connection `requestRejection`）  
- 左栏 **amem** 面板：记忆 / 能力 / 提案 / 运维 / 说明（包 `@amem/amem-dsh-ui`）；**运维** Tab 对应 Admin API：`doctor`、`flush`、`rebuild-index`、`consolidate`、`compile --target dsh`（面板内 compile 固定为 dsh，不可改 target）  
- headless / ACP 无面板，仍可用 MCP  

实现对照本地 DSH 源码 API；官网文档可能滞后于当前仓库。

### Claude Code 等其他宿主

`amem install --host cursor` 与 `amem install --host dsh` 为完整安装路径。其他宿主目前需手动配置 MCP（指向 `packages/gateway-mcp/dist/server.js`，并设置 `AMEM_HOME`）；`compile --target claude-code` 可输出对应格式。Adapter 包：`@amem/adapter-claude-code`。

---

## 开发说明

### 仓库结构

```text
amem/
├── package.json              # workspa