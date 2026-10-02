/**
 * Test-only crash injection points. Production code never sets these.
 * Hooks throw to simulate process death mid-operation.
 */
export type CrashHooks = {
  /** After new memory path is written, before old paths are removed. */
  afterUpsertWrite?: (ctx: { id: string; newPath: string; oldPaths: string[] }) => void;
  /** After memory markdown is deleted, before index drop. */
  afterForgetRm?: (ctx: { id: string }) => void;
  /** After episode events jsonl is written, before meta yaml. */
  afterSealEvents?: (ctx: { eventsPath: string; episodeId: string }) => void;
  /** After SKILL.md is written in staging, before capability.yaml. */
  afterApplySkill?: (ctx: { stagingDir: string; skillName: string }) => void;
};

let hooks: CrashHooks = {};

export function setCrashHooks(next: CrashHooks): void {
  hooks = next;
}

export function clearCrashHooks(): void {
  hooks = {};
}

export function crashHooks(): CrashHooks {
  return hooks;
}
