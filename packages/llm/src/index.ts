import {
  type AmemConfig,
  type MemoryCandidate,
  ExtractCandidatesSchema,
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
              "Extract cross-session memories as JSON {candidates:[...]}. Each candidate needs kind,title,content,applies_when,evidence[{event,quote}]. Quotes must be verbatim substrings of the episode. Max 8. No secrets.",
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
    return ExtractCandidatesSchema.parse(JSON.parse(text)).candidates;
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
