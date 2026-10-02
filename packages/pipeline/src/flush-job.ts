/** Single source of truth for queue flush job shape. */

export type FlushJob = {
  type: "flush";
  sessionId: string;
  at: string;
};

export function createFlushJob(sessionId: string, at = new Date().toISOString()): FlushJob {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("flush job sessionId must be a non-empty string");
  }
  return { type: "flush", sessionId, at };
}

export function parseFlushJob(raw: unknown): FlushJob {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("flush job must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.type !== "flush") {
    throw new Error(`flush job type must be "flush", got ${String(o.type)}`);
  }
  if (typeof o.sessionId !== "string" || !o.sessionId) {
    throw new Error("flush job sessionId must be a non-empty string");
  }
  if (typeof o.at !== "string" || !o.at) {
    throw new Error("flush job at must be a non-empty ISO timestamp string");
  }
  return { type: "flush", sessionId: o.sessionId, at: o.at };
}
