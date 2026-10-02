export { EpisodeStore } from "./episode.js";
export { MemoryStore } from "./memory.js";
export {
  IndexStore,
  INDEX_SCHEMA_VERSION,
  type EnsureResult,
} from "./index-store.js";
export { ProposalStore, type ProposalRow } from "./proposal.js";
export { syncMemoryIndex, dropMemoryIndex } from "./sync.js";
export {
  listConflicts,
  computeResolveTargets,
  type ConflictPair,
  type ResolveConflictAction,
} from "./conflict.js";
export {
  resolveConflict,
  resolveConflictTransactional,
  recoverJournals,
  listBlockedMemoryIds,
  migrateLinkConflict,
  commitPairedMutation,
  ConflictError,
  type ConflictActor,
  type ConflictErrorCode,
  type ConflictJournal,
} from "./conflict-journal.js";
export {
  setCrashHooks,
  clearCrashHooks,
  type CrashHooks,
} from "./crash-hooks.js";
export {
  revokeEpochsReferencing,
  revokeEpoch,
  readEpoch,
  writeEpoch,
  casEpochState,
  tryCreateOpenEpoch,
  epochKeyHash,
  epochPath,
  assertEpochIds,
  type EpochRecord,
  type EpochState,
  type EpochItem,
} from "./epoch-store.js";
export { gcManifests } from "./gc-manifests.js";
export {
  setEmbedProvider,
  getEmbedProvider,
  scheduleEmbed,
  embedAllMemories,
  type EmbedTextsFn,
} from "./embed-provider.js";
export {
  runDoctor,
  listFailedJobs,
  purgeFailedJobs,
  countFailedJobs,
  countPendingJobs,
  type DoctorReport,
  type DoctorStatus,
  type DoctorCheck,
  type DoctorAction,
  type FailedJobInfo,
} from "./doctor.js";

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
