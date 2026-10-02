export { EpisodeStore } from "./episode.js";
export { MemoryStore } from "./memory.js";
export { IndexStore } from "./index-store.js";
export { ProposalStore, type ProposalRow } from "./proposal.js";
export { syncMemoryIndex, dropMemoryIndex } from "./sync.js";
export {
  listConflicts,
  resolveConflict,
  type ConflictPair,
  type ResolveConflictAction,
} from "./conflict.js";
export {
  setCrashHooks,
  clearCrashHooks,
  type CrashHooks,
} from "./crash-hooks.js";

import { IndexStore as Idx } from "./index-store.js";
import { MemoryStore as Mem } from "./memory.js";

export function rebuildMemoryIndex(home: string): number {
  const store = new Mem(home);
  const idx = new Idx(home);
  try {
    return idx.rebuild(store);
  } finally {
    idx.close();
  }
}
