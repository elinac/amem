import type { MemoryRecord } from "@amem/core";
import { IndexStore } from "./index-store.js";

export type EmbedTextsFn = (texts: string[]) => Promise<(number[] | null)[] | null>;

let embedFn: EmbedTextsFn | null = null;

/** Register optional embed provider (set when embedding.enabled). */
export function setEmbedProvider(fn: EmbedTextsFn | null): void {
  embedFn = fn;
}

export function getEmbedProvider(): EmbedTextsFn | null {
  return embedFn;
}

function embedTextFor(m: MemoryRecord): string {
  return `${m.title}\n${m.applies_when}\n${m.content.slice(0, 800)}`;
}

/** Best-effort write-time embed; never throws into caller. */
export function scheduleEmbed(home: string, record: MemoryRecord): void {
  const fn = embedFn;
  if (!fn) return;
  void (async () => {
    try {
      const vecs = await fn([embedTextFor(record)]);
      const v = vecs?.[0];
      if (!v?.length) return;
      const idx = new IndexStore(home);
      try {
        idx.upsertEmbedding(record.id, v);
      } finally {
        idx.close();
      }
    } catch {
      /* observable degradation: FTS-only */
    }
  })();
}

/** Rebuild-time embed for all memories when provider set. */
export async function embedAllMemories(home: string, records: MemoryRecord[]): Promise<number> {
  const fn = embedFn;
  if (!fn || records.length === 0) return 0;
  let n = 0;
  const idx = new IndexStore(home);
  try {
    for (const m of records) {
      try {
        const vecs = await fn([embedTextFor(m)]);
        const v = vecs?.[0];
        if (v?.length) {
          idx.upsertEmbedding(m.id, v);
          n += 1;
        }
      } catch {
        /* skip */
      }
    }
  } finally {
    idx.close();
  }
  return n;
}
