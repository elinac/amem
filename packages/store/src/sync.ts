import type { MemoryRecord } from "@amem/core";
import { IndexStore } from "./index-store.js";

/** Keep SQLite FTS in sync after Markdown write (no full rebuild). */
export function syncMemoryIndex(home: string, record: MemoryRecord, filePath: string): void {
  const idx = new IndexStore(home);
  try {
    idx.upsertMemory(record, filePath);
  } finally {
    idx.close();
  }
}

export function dropMemoryIndex(home: string, id: string): void {
  const idx = new IndexStore(home);
  try {
    idx.removeMemory(id);
  } finally {
    idx.close();
  }
}
