# amem

Cross-session agent memory for coding hosts. This glossary covers product language only.

## Memory layers

**Memory**:
A durable L2 record kept across sessions (Markdown + frontmatter), distinct from raw Episode logs.
_Avoid_: Note, snippet, episode

**Proposal**:
A candidate Skill produced by consolidation and waiting for human review; it is not yet in the capability store.
_Avoid_: Draft skill, pending capability, suggestion

**Skill**:
An L3 capability that entered the capability store only after a human applied a Proposal, then may be compiled for a host. Product copy may say「能力」.
_Avoid_: Capability (as a synonym in product language), auto-published memory

## Configuration

**AmemConfig**:
The full on-disk configuration document at `AMEM_HOME/amem.toml`, including LLM, recall, promotion, budget, embedding, privacy, and DSH admin settings.
_Avoid_: Settings file blob, app preferences

**Config Panel**:
The DSH workbench tab that progressively edits AmemConfig. Wave 1 covers LLM connectivity (`mode`, `base_url`, `model`, write-only `api_key`); later waves add recall and other everyday fields. Embedding and privacy may arrive later; they are not forever excluded.
_Avoid_: Config surface (as a permanent reduced product), secrets-only tab

**LLM Connectivity**:
The minimum AmemConfig fields required to leave stub mode and call an external model: `llm.mode`, `llm.base_url`, `llm.model`, and a secret via write-only `api_key` (or later `api_key_env`).
_Avoid_: Just the API key
