# Eval fixtures (Phase 2)

Offline recall-effectiveness corpus, judgments, baselines, and signal samples.

| Path | Purpose |
|------|---------|
| `corpus/v0/` | Synthetic desensitized Memory rows (jsonl) |
| `judgments/` | Query → relevant / harmful / conflict labels |
| `baselines/` | Frozen metric snapshots for A/B rollback |
| `signals/` | Offline feedback / external-signal association samples |
| `schema/` | JSON Schema for corpus and judgment lines |

Do not commit real `~/.amem` exports or unredacted transcripts. Raw dumps (if ever local) belong outside git.

Frozen quality baseline: `baselines/v0.json`. Spec: [memory-effectiveness-eval](../../docs/superpowers/specs/2026-10-02-memory-effectiveness-eval.md).
