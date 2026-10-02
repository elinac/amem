# 真实 DSH session smoke

自动化硬门使用合成 spool（`pnpm accept:dsh-session`），**不**依赖本机 `dsh web`。

本页描述对**正在运行的** DSH 做最小 RPC 探测。

## 前置

1. 已安装 amem DSH 插件：`pnpm amem -- install --host dsh`（或等价）
2. `dsh web` 已启动，面板可打开
3. 记下面板同源 Origin（例如 `http://127.0.0.1:7788`）
4. 若 `dsh.admin.auth_enabled=true`：用 `amem auth issue --target dsh --scopes ...` 发 token

## 环境变量

| 变量 | 含义 |
|------|------|
| `AMEM_DSH_SMOKE_URL` | DSH web 根 URL（必填才会跑脚本，否则 skip exit 0） |
| `AMEM_DSH_SMOKE_TOKEN` | 可选 Bearer token |

## 命令

```bash
# 未设置 URL → skip
pnpm exec node scripts/smoke-dsh-session.mjs

# 对本机 DSH
AMEM_DSH_SMOKE_URL=http://127.0.0.1:7788 pnpm exec node scripts/smoke-dsh-session.mjs

# 鉴权开启时
AMEM_DSH_SMOKE_URL=http://127.0.0.1:7788 AMEM_DSH_SMOKE_TOKEN=<token> pnpm exec node scripts/smoke-dsh-session.mjs
```

## 期望

- `ops.doctor` 返回 `ok` 与结构化 `status` / `checks`
- `conflict.list` 返回 `ok`（可为 empty）

## 手工补充（可选）

1. 在 DSH 会话里触发一次可抽取错误（如 port in use）
2. 运维 Tab → flush → doctor 看 `queue_*` / `index_*`
3. 审阅 Tab：若有冲突对，执行 keep_left / keep_right
4. 配置 Tab：改 LLM mode 保存后 reload，确认 dirty 指纹只跟可编辑 put 面有关
