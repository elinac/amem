import type { CanonicalEvent, EpisodeMeta, MemoryRecord } from "@amem/core";

/**
 * Evidence for an agent note must come from an external signal. The note's own
 * `tool_call` (which carries `evidence_hint` verbatim in the DSH transcript) is
 * excluded on purpose: matching it would be self-fulfilling.
 */
export const EXTERNAL_EVIDENCE_TYPES = [
  "user_prompt",
  "tool_result",
  "shell_result",
  "feedback",
] as const;

/** Short hints match by accident; require a distinctive verbatim string. */
export const MIN_CANDIDATE_EVIDENCE_LENGTH = 16;

export type ExternalEventLine = { index: number; type: string; line: string };

/**
 * Episode files store JSON, so a quote is only "verbatim" there in its escaped form.
 * Hints containing backslashes or quotes must be recorded the way the LLM path
 * records them, otherwise the I3 verbatim check rejects the evidence.
 */
function escapedForm(needle: string): string {
  return JSON.stringify(needle).slice(1, -1);
}

/** Raw JSON line per external event, keeping its index in the full event list. */
export function externalEventLines(events: CanonicalEvent[]): ExternalEventLine[] {
  return events
    .map((e, index) => ({ index, type: e.type as string, line: JSON.stringify(e) }))
    .filter((e) => (EXTERNAL_EVIDENCE_TYPES as readonly string[]).includes(e.type));
}

/**
 * First needle that occurs verbatim in an external event line, trying both the raw
 * and JSON-escaped form. Longest needle first, so the quote is the most specific match.
 */
export function externalEvidenceFor(
  needles: string[],
  external: ExternalEventLine[],
): { event: number; quote: string } | undefined {
  const usable = needles
    .map((n) => n.trim())
    .filter((n) => n.length >= MIN_CANDIDATE_EVIDENCE_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const needle of usable) {
    const escaped = escapedForm(needle);
    for (const form of new Set([needle, escaped])) {
      const hit = external.find((e) => e.line.includes(form));
      if (hit) return { event: hit.index, quote: form };
    }
  }
  return undefined;
}

/**
 * Agent notes (`memory_note`) are written as `candidate` with no Episode evidence,
 * while recall only injects `active`/`conflict` memories. A candidate is grounded
 * here when one of its recorded evidence texts occurs verbatim in an external
 * signal of a sealed Episode. Returns undefined when the note stays unvalidated.
 */
export function verifiedCandidateEvidence(
  memory: MemoryRecord,
  meta: EpisodeMeta,
  external: ExternalEventLine[],
): { event: number; quote: string } | undefined {
  if (memory.status !== "candidate") return undefined;
  if (memory.evidence.episodes.includes(meta.episode_id)) return undefined;
  return externalEvidenceFor(
    (memory.evidence.quotes ?? []).map((q) => q.text),
    external,
  );
}
