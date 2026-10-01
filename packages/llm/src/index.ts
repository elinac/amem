import {
  type AmemConfig,
  type MemoryCandidate,
  type MemoryKind,
  ExtractCandidateSchema,
  ExtractCandidatesSchema,
  MemoryKindSchema,
  resolveLlmApiKey,
} from "@amem/core";

export interface LlmClient {
  extractCandidates(input: {
    summary: string;
    episodeBlob: string;
  }): Promise<MemoryCandidate[]>;
}

/** Deterministic stub: pull one failure candidate if Port/error-like text exists. */
export class StubLlmClient implements LlmClient {
  async extractCandidates(input: {
    summary: string;
    episodeBlob: string;
  }): Promise<MemoryCandidate[]> {
    const blob = input.episodeBlob;
    const m = blob.match(/Error:[^\n]{5,120}/);
    if (!m) {
      // generic fact if user_prompt present
      if (blob.includes('"type":"user_prompt"') || blob.includes("user_prompt")) {
        return [
          {
            kind: "fact",
            title: "session contained a user goal",
            content: "User stated a goal in this session; retain for continuity.",
            applies_when: "starting a follow-up session on the same topic",
            evidence: [{ event: 0, quote: findQuote(blob, 20) }],
            confidence: 0.4,
          },
        ];
      }
      return [];
    }
    const quote = m[0]!;
    return ExtractCandidatesSchema.parse({
      candidates: [
        {
          kind: "failure",
          title: "runtime error observed",
          content: `When seeing "${quote.slice(0, 80)}", investigate root cause before retrying blindly.`,
          applies_when: "similar error text appears in tool output",
          evidence: [{ event: 0, quote }],
          confidence: 0.7,
        },
      ],
    }).candidates;
  }
}

function findQuote(blob: string, minLen: number): string {
  const line = blob.split(/\n/).find((l) => l.length >= minLen) ?? blob.slice(0, minLen);
  return line.slice(0, 80);
}

/**
 * Model output drift: free-form kinds seen in practice (project, environment,
 * constraint, known_issue, ...) mapped onto the fixed enum.
 */
const KIND_ALIASES: Record<string, MemoryKind> = {
  project: "fact",
  project_fact: "fact",
  repo_fact: "fact",
  environment: "fact",
  environment_fact: "fact",
  setup: "fact",
  knowledge: "fact",
  info: "fact",
  note: "fact",
  constraint: "constraint_hint",
  constraints: "constraint_hint",
  rule: "constraint_hint",
  hard_constraint: "constraint_hint",
  policy: "constraint_hint",
  requirement: "constraint_hint",
  known_issue: "failure",
  issue: "failure",
  bug: "failure",
  gotcha: "failure",
  pitfall: "failure",
  error: "failure",
  case_study: "case",
  example: "case",
  observed: "case",
  workflow: "procedure",
  process: "procedure",
  steps: "procedure",
  how_to: "procedure",
  howto: "procedure",
  skill: "procedure",
  technique: "procedure",
  tool: "tool_quirk",
  tooling: "tool_quirk",
  tool_tip: "tool_quirk",
  tool_issue: "tool_quirk",
  decision: "strategy",
  tradeoff: "strategy",
  rationale: "strategy",
  approach: "strategy",
  acceptance_criteria: "criterion",
  criteria: "criterion",
  acceptance: "criterion",
  check: "criterion",
  preference: "preference",
  user_preference: "preference",
  style: "preference",
  question: "open_question",
  unknown: "open_question",
  todo: "open_question",
  follow_up: "open_question",
};

/**
 * Deliberately `fact`, never `procedure`: a mislabelled candidate may still be
 * recalled, but it can never satisfy the L3 proposal gate (procedure only).
 */
const FALLBACK_KIND: MemoryKind = "fact";

function normalizeKind(raw: unknown): MemoryKind {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const direct = MemoryKindSchema.safeParse(s);
  if (direct.success) return direct.data;
  return KIND_ALIASES[s] ?? FALLBACK_KIND;
}

function clampText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function optionalStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return out.length ? out : undefined;
}

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const i of v) collectStrings(i, out);
  else if (v && typeof v === "object") for (const i of Object.values(v)) collectStrings(i, out);
}

/** Raw line plus its decoded string leaves, so escaped quotes still match. */
function searchableLines(lines: string[]): string[] {
  return lines.map((line) => {
    try {
      const hits: string[] = [];
      collectStrings(JSON.parse(line), hits);
      return `${line}\n${hits.join("\n")}`;
    } catch {
      return line;
    }
  });
}

/**
 * Resolve the numeric event index the schema requires. Models often answer with
 * a label ("tool_result: ...") instead, so fall back to the quote, then to the
 * label's event-type hint. Returns undefined when the index cannot be grounded.
 */
function eventIndexFor(
  lines: string[],
  searchable: string[],
  quote: string,
  raw: unknown,
): number | undefined {
  const asNumber =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : undefined;
  if (
    asNumber !== undefined &&
    Number.isInteger(asNumber) &&
    asNumber >= 0 &&
    asNumber < lines.length
  ) {
    return asNumber;
  }
  const byQuote = searchable.findIndex((t) => t.includes(quote));
  if (byQuote >= 0) return byQuote;
  if (typeof raw === "string") {
    const hint = raw.split(/[:：]/)[0]!.trim().toLowerCase();
    if (hint.length > 2) {
      const byHint = lines.findIndex((l) => l.toLowerCase().includes(hint));
      if (byHint >= 0) return byHint;
    }
  }
  return undefined;
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    process.stderr.write(`[amem] llm returned non-JSON content (${trimmed.length} chars)\n`);
    return { candidates: [] };
  }
}

/**
 * Make model output safe for the fixed schema: alias the kind, coerce the
 * evidence event index, drop candidates/evidence that cannot be grounded.
 * Quotes are never fabricated - I3 still governs what reaches the store.
 */
export function normalizeCandidates(raw: unknown, episodeBlob: string): MemoryCandidate[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { candidates?: unknown }).candidates)
      ? (raw as { candidates: unknown[] }).candidates
      : [];
  const lines = episodeBlob.split(/\r?\n/).filter(Boolean);
  const searchable = searchableLines(lines);
  const out: MemoryCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const title = clampText(c.title, 80);
    const content = clampText(c.content, 1200);
    const appliesWhen = clampText(c.applies_when, 400);
    if (!title || !content || !appliesWhen) continue;
    const evidence: { event: number; quote: string }[] = [];
    for (const e of Array.isArray(c.evidence) ? c.evidence : []) {
      if (!e || typeof e !== "object") continue;
      const eo = e as Record<string, unknown>;
      const quote = clampText(eo.quote, 500);
      if (!quote) continue;
      const event = eventIndexFor(lines, searchable, quote, eo.event);
      if (event === undefined) continue;
      evidence.push({ event, quote });
    }
    if (!evidence.length) continue;
    const domains = optionalStringArray(c.domains);
    const tools = optionalStringArray(c.tools);
    const notApplies = clampText(c.not_applies_when, 400);
    const taskType = clampText(c.task_type, 120);
    const parsed = ExtractCandidateSchema.safeParse({
      kind: normalizeKind(c.kind),
      title,
      content,
      applies_when: appliesWhen,
      ...(notApplies ? { not_applies_when: notApplies } : {}),
      ...(domains ? { domains } : {}),
      ...(tools ? { tools } : {}),
      ...(taskType ? { task_type: taskType } : {}),
      evidence,
      ...(typeof c.confidence === "number" && Number.isFinite(c.confidence)
        ? { confidence: c.confidence }
        : {}),
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out.slice(0, 8);
}

export class OpenAiCompatibleClient implements LlmClient {
  constructor(private readonly cfg: AmemConfig) {}

  async extractCandidates(input: {
    summary: string;
    episodeBlob: string;
  }): Promise<MemoryCandidate[]> {
    const key = resolveLlmApiKey(this.cfg);
    if (!key) {
      throw new Error(
        "missing llm.api_key in amem.toml (or set the env named by llm.api_key_env)",
      );
    }
    const res = await fetch(`${this.cfg.llm.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.cfg.llm.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Extract cross-session memories as JSON {"candidates":[...]}. ` +
              `Allowed kind values (use exactly one): ${MemoryKindSchema.options.join(", ")}. ` +
              `Each candidate: {kind, title (<=80 chars), content (<=1200 chars), applies_when, evidence:[{event, quote}]}. ` +
              `"event" MUST be the 0-based index of the episode line containing the quote; ` +
              `"quote" MUST be a verbatim substring of the episode. 1-8 candidates. No secrets.`,
          },
          {
            role: "user",
            content: `Summary:\n${input.summary}\n\nEpisode (truncated):\n${input.episodeBlob.slice(0, 12000)}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "{}";
    return normalizeCandidates(parseJsonLoose(text), input.episodeBlob);
  }
}

/**
 * Optionally refine a Proposal SKILL.md body. Returns null to signal fallback to template
 * (non-external mode, missing key, or any LLM failure).
 */
export async function tryRefineProposalSkill(
  cfg: AmemConfig,
  input: { id: string; title: string; content: string },
): Promise<string | null> {
  if (cfg.llm.mode !== "external") return null;
  const key = resolveLlmApiKey(cfg);
  if (!key) return null;
  try {
    const res = await fetch(`${cfg.llm.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        messages: [
          {
            role: "system",
            content:
              "Rewrite the memory into a concise coding-agent SKILL.md. Keep YAML frontmatter with name and description. Body: clear steps. No secrets. Return only the markdown file.",
          },
          {
            role: "user",
            content: `name: ${input.id}\ntitle: ${input.title}\n\n${input.content}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text || !text.includes("---")) return null;
    return text.endsWith("\n") ? text : `${text}\n`;
  } catch {
    return null;
  }
}

export function createLlmClient(cfg: AmemConfig): LlmClient {
  if (cfg.llm.mode === "stub" || cfg.llm.mode === "host") return new StubLlmClient();
  return new OpenAiCompatibleClient(cfg);
}
