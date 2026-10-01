# Memory → Proposal → Skill path (Waves A → D1 → D2 → C)

Status: draft for issue tracker (`ready-for-agent` pending tracker setup)  
Seams agreed: S1 `consolidate`, S2 DSH Admin/RPC accept, S3 CLI `accept-p2` extension, S4 proposal-gate gap pure function, S5 AmemConfig + Config Panel for refine flag  
Glossary: Memory, Proposal, Skill, AmemConfig, Config Panel, LLM Connectivity  
ADR constraint: automatic flows must not write the capability store; humans apply Proposals.

## Problem Statement

Operators and agents can store Memories and the workbench claims a path from Memory to Proposal to Skill, but that path is only partially trustworthy. A Memory that is promoted in the same consolidate pass may not emit a Proposal; DSH lacks an end-to-end acceptance path equivalent to the CLI; the workbench does not make gate gaps or successful consolidation outcomes obvious; Proposal bodies are template dumps with no optional LLM refinement. Users discover these gaps only when they try to save, consolidate, or apply in a real DSH session.

## Solution

Ship the fix in four ordered waves, without auto-applying Proposals and without lowering promotion or proposal gates:

1. **Wave A — Reliability:** Fix same-pass promote-then-propose; prove the path with vitest at `consolidate`, DSH RPC acceptance (including real panel `Sec-Fetch-Site: same-site` headers), and an extended CLI acceptance that starts from instance-level Memory.
2. **Wave D1 — Light workbench UX:** Static gate help; after consolidate, jump to the Proposal tab and refresh; tighten accelerate/manual guidance copy.
3. **Wave D2 — Gate diagnostics:** Library-level gap summary when there are no Proposals; per-Memory gap display on the Memory list, driven by one pure gap function.
4. **Wave C — Proposal quality:** Optional `budget.consolidate.refine_proposals` (default false), exposed on the Config Panel; when on and LLM Connectivity works, refine candidate Skill markdown; on failure fall back to the template; count toward consolidate LLM budget. Real-session spool acceptance and a short ADR for refine stay after this wave.

## User Stories

1. As a DSH operator, I want a Memory that is promoted to domain in one consolidate run to also become a Proposal in that same run when other gates pass, so that I do not have to click consolidate twice for an obvious case.
2. As a DSH operator, I want consolidate to keep rejecting Memories that fail kind, level, trust, or evidence gates, so that gate strictness is unchanged.
3. As a maintainer, I want vitest to assert that consolidate writes real `.proposals` artifacts, so that proposal emission cannot regress silently.
4. As a maintainer, I want Admin/RPC tests for applying a Proposal, so that materialize-into-Skill stays wired through the DSH management API.
5. As a maintainer, I want a DSH acceptance script that runs Memory → consolidate → list Proposals → apply → compile with panel-like headers, so that host auth and RPC contracts match production.
6. As a maintainer, I want CLI acceptance to start from an instance-level procedure Memory, promote, emit a Proposal, apply, and compile, so that the promote-then-propose fix is locked end-to-end.
7. As a DSH operator, I want a short explanation when a second consolidate might still be needed in edge cases, so that residual behavior is not mysterious.
8. As a DSH operator, I want static help that lists the four Proposal gates, so that I know what “合格 Memory” means without reading source.
9. As a DSH operator, I want consolidate success to take me to the Proposal tab with a fresh list, so that new Proposals are immediately visible.
10. As a DSH operator, I want apply to remain a separate explicit action, so that Skills never enter the capability store without human approval.
11. As a DSH operator, I want accelerate / manual frontmatter guidance to stay accurate and short, so that demo paths do not contradict the real gates.
12. As a DSH operator, I want a library-level summary of why Proposals are empty when Memories exist, so that I can see the dominant missing gate without opening every record.
13. As a DSH operator, I want each Memory row to show which Proposal gates it fails, so that I can fix or wait on the right field.
14. As a DSH operator, I want gap diagnostics to use the same rules as consolidate, so that UI advice matches what the pipeline will do.
15. As a developer, I want gate-gap logic in one pure function, so that UI and tests do not fork rule copies.
16. As an operator who enabled external LLM Connectivity, I want an explicit refine-proposals switch defaulting off, so that consolidate does not spend tokens until I opt in.
17. As an operator with refine on, I want failed refinement to still leave a template Proposal, so that consolidate never fails closed on LLM errors.
18. As an operator with refine on, I want LLM calls to count against consolidate’s max LLM calls, so that budgets remain enforceable.
19. As a DSH operator, I want to toggle refine proposals in the Config Panel under budget/consolidate fields, with copy that mentions template fallback, so that I do not have to hand-edit TOML for this flag.
20. As a DSH operator, I want AmemConfig load/save to preserve `budget.consolidate.refine_proposals`, so that the flag survives restarts.
21. As a security-conscious operator, I want automatic flows to remain unable to write Skills into the capability store, so that ADR thin-core governance holds.
22. As a maintainer, I want Waves ordered A → D1 → D2 → C, so that reliability is proven before deep UX and before LLM spend.
23. As a maintainer, I want real spool→extract→feedback→Proposal session acceptance deferred until after Wave C, so that flaky LLM sessions do not block earlier waves.
24. As a maintainer, I want any ADR for refine defaults deferred until Wave C starts, so that the ADR records the shipped trade-off rather than speculation.
25. As a product reader, I want glossary terms Memory, Proposal, and Skill to stay aligned with UI「能力」copy, so that specs and panels share one language.
26. As a DSH operator with auth disabled, I want the acceptance and panel mutating RPCs to succeed with same-site ported Origin headers, so that local workbench saves and consolidate match fixed access checks.
27. As a DSH operator with auth enabled, I want apply and consolidate to still require the existing session and CSRF rules, so that optional auth mode is not weakened.
28. As an operator running stub LLM mode, I want refine-off consolidate to keep working without external keys, so that demos and CI stay offline-capable.
29. As an operator who applied a Proposal, I want compile to remain a separate ops action targeting DSH from the panel, so that host publish stays intentional.
30. As a reviewer, I want Out of Scope to explicitly exclude lowering gates and auto-apply, so that agents do not “helpfully” widen the blast radius.

## Implementation Decisions

- Deliver as four sequential waves: A (reliability), D1 (light UX), D2 (diagnostics), C (optional refine). Do not reorder; do not start C before D2 completes.
- Keep human `proposal.apply` as the only path from Proposal to Skill. No auto-materialize, no demo-only auto-apply flag in this spec.
- Do not change promotion thresholds, proposal eligibility thresholds, or trust/kind/level/evidence rules except to evaluate them against the post-promotion Memory in the same consolidate pass.
- Wave A behavioral fix: within one `consolidate` invocation, after a Memory is promoted (and rewritten), Proposal eligibility must consider the promoted snapshot (or an equivalent end-of-pass rescan), not only the pre-promotion record.
- Wave A verification: extend CLI acceptance to cover instance → promote → Proposal → apply → compile; add DSH RPC acceptance for the same logical path with panel-like mutating headers; add tests at the `consolidate` seam for on-disk Proposal output and at Admin/RPC for apply.
- Wave D1: static four-gate help; consolidate success navigates to Proposal tab and refreshes list; tighten accelerate/manual copy; no new wizard page; compile stays a separate control.
- Wave D2: introduce one pure “proposal gate gaps” function returning structured missing gates for a Memory and a rollup for a Memory set; Memory list renders per-row gaps; when Proposal list is empty but Memories exist, show rollup summary. UI must not reimplement gate arithmetic.
- Wave C: add `budget.consolidate.refine_proposals` boolean to AmemConfig, default `false`. When true and LLM Connectivity can call an external model, refine the candidate Skill markdown before writing the Proposal; on any failure, write the existing template body; increment consolidate LLM call budget for successful or attempted refine calls per existing budget semantics.
- Wave C Config Panel: expose the refine flag with neighboring budget/consolidate fields and short fallback help text. Do not conflate this flag with LLM Connectivity fields (`mode`, `base_url`, `model`, `api_key`).
- Auth posture unchanged: access checks already allowing loopback + `same-site` remain; this work consumes that contract in acceptance headers rather than redesigning auth.
- Defer: real multi-turn session acceptance; ADR for refine defaults until Wave C implementation begins; conflict-review RPC; lowering gates; browser UI E2E.

### Agreed test seams

- **S1** — `consolidate(home, cfg)`: promote-then-propose; Proposal files on disk; refine on/off and fallback.
- **S2** — DSH Admin/RPC HTTP acceptance: full apply path with real panel headers.
- **S3** — CLI acceptance extension of the existing p2 path: instance-start promote-then-propose.
- **S4** — Pure proposal-gate gap function: per-Memory and rollup (D2).
- **S5** — AmemConfig parse/serialize + Config Panel field behavior for `refine_proposals` (C).

## Testing Decisions

- Good tests assert externally visible behavior through the agreed seams only: on-disk Proposal/Skill outcomes, RPC status and payloads, Config defaults, and pure gap structures. They do not assert private loop variable names or internal helper call order.
- Prefer extending existing acceptance scripts and vitest suites that already cover consolidate gates, Admin ops, plugin RPC, Config Panel, and CLI accept-p2, over new parallel harnesses.
- Wave A must fail if same-pass promotion does not emit a Proposal for an otherwise eligible Memory; acceptance must fail on access-check 401 under panel-like `same-site` headers.
- Wave D2 tests bind to S4 outputs (which gates are missing), not to CSS or tab chrome.
- Wave C tests cover: default false; true + LLM success writes refined body; true + LLM failure still writes template Proposal; budget accounting; Config Panel round-trip of the flag.
- Out of test scope for this spec: full browser automation of the panel; live provider bills; spool→extract multi-turn sessions (post-Wave C).

## Out of Scope

- Lowering or bypassing Memory promotion or Proposal eligibility gates.
- Automatic apply of Proposals or any automatic write into the capability store.
- Conflict / review adjudication RPC and UI beyond existing placeholders.
- Real session spool → extract → feedback → Proposal automation (scheduled after Wave C).
- Writing the refine ADR before Wave C starts.
- Changing LLM Connectivity Wave 1 field set except to coexist with the new budget flag.
- Non-DSH compile targets in the DSH Admin UI.
- Reworking Episode ingestion or MCP `memory_note` shapes.

## Further Notes

- Product copy may say「能力」where the glossary says Skill; keep that mapping stable.
- Research baseline: `docs/research/memory-proposal-skill-path.md` (partial path; CLI accept-p2 with pre-qualified Memory; DSH gap).
- Prior grill decisions: goals A+C+D; human apply; accept scripts then later real sessions; sequence A→D→C refined to A→D1→D2→C; fix same-pass bug with residual copy; refine behind default-off flag; DSH accept + vitest; D1 light UX then D2 diagnostics; Config Panel exposes refine flag.
- Publish to the project issue tracker with triage label `ready-for-agent` once `/setup-matt-pocock-skills` (or equivalent) provides tracker access and label vocabulary.
