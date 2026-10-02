import type { MemoryKind, MemoryRecord, ScopeLevel, Trust } from "./types.js";

export class InvariantError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "InvariantError";
  }
}

/** I2/I5: pipeline may not create T1 or promote preference / write L3 markers */
export function assertWritableMemory(
  m: Pick<MemoryRecord, "kind" | "trust" | "status" | "scope">,
  source: "pipeline" | "human" | "agent-note",
): void {
  if (source === "pipeline" || source === "agent-note") {
    if (m.trust === "T1") {
      throw new InvariantError("I2", "automatic writers cannot create T1 trust");
    }
    if (m.kind === "preference" && m.scope.level !== "instance") {
      throw new InvariantError("I5", "preference cannot leave instance scope");
    }
  }
}

export function canPromoteKind(kind: MemoryKind): boolean {
  return kind !== "preference" && kind !== "open_question";
}

export function canAutoRaiseTrust(from: Trust, to: Trust): boolean {
  if (to === "T1") return false;
  const order: Trust[] = ["T3", "T2", "T1"];
  return order.indexOf(to) > order.indexOf(from);
}

export function scopePriority(level: ScopeLevel): number {
  // higher = more specific wins (I6)
  return level === "instance" ? 3 : level === "domain" ? 2 : 1;
}

export function contextLayerPriority(layer: string): number {
  const order = ["constraint", "process", "skill", "knowledge", "memory", "preference"];
  const i = order.indexOf(layer);
  return i === -1 ? 99 : i;
}

/** I3: every evidence quote must appear verbatim in episode text blob */
export function evidenceQuotesValid(quotes: { quote: string }[], episodeBlob: string): boolean {
  return quotes.every((q) => q.quote.length > 0 && episodeBlob.includes(q.quote));
}
