# 记忆有效性离线评测（Phase 2）

## 目标

在不引入向量库、不改线上 lift/晋升公式的前提下，让每次召回算法变更都能与冻结基线做离线对照，并有明确回滚门。

## 语料与目录

根目录：`fixtures/eval/`

| 路径 | 说明 |
|------|------|
| `corpus/v0/` | 合成脱敏 Memory（jsonl） |
| `judgments/` | query → relevant / harmful / conflict_ids |
| `baselines/` | 冻结指标快照；`v0.json` 为质量基线 |
| `signals/` | 离线反馈样本（不驱动线上） |
| `schema/` | judgment / corpus JSON Schema |

**非目标：** 真实 `~/.amem`、未脱敏 transcript、默认打开 `embedding.enabled`、独立向量库、改线上 lift。

## 指标（K = 8）

主指标：**macro Precision@K**（对各 judgment 的 P@K 取平均）。

辅指标：

- **Recall@K**：相关 id 命中率（macro）
- **有害注入率**：`|injectable ∩ harmful| / |injectable|`（`assist` 门控后的可注入集）
- **冲突暴露**：Top-K 中 `status=conflict` 或带 `conflicts_with` 的占比（不要求写入 pack）
- **预算利用率**：`pack` 已用 tokens / budget；另报 budget drop 数

## 通道

生产默认仍为 `fts+tags`。评测可选：

- `fts` | `tags` | `fts+tags`
- `embedding` 行在消融报告中保留但标 `skipped`

## 门控与回滚

CI / `pnpm eval:recall`：相对 `DEFAULT_GATES`（见 `scripts/lib/eval-metrics.mjs`），v0 校准后主阈值为：

- `minPrecisionAtK ≥ 0.5`
- `maxHarmfulInjectionRate ≤ 0.02`

相对冻结基线 `fixtures/eval/baselines/v0.json`（`pnpm eval:ab`）：

- ΔP@8 ≤ −0.05 → fail
- 有害注入率绝对升幅 > 0.01 → fail

瘦 pack（利用率很低且无 budget drop）跳过「最低预算利用率」门，避免合成短记忆误杀。

## 命令

```bash
pnpm eval:recall
pnpm eval:ablate
pnpm eval:ab -- --baseline fixtures/eval/baselines/v0.json --candidate fixtures/eval/baselines/v0.json
pnpm eval:signals
```

`eval-signals` 仅输出 recalled × feedback label 列联与条件概率，**不修改**线上 lift。

## 退出门（阶段 2）

- `pnpm test` 绿
- `pnpm eval:recall` 对当前实现绿
- `eval-ab` 以 v0 对 v0 通过
- 三通道消融可跑通且报告非空（embedding 可为 skipped）
