import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { newId, type CanonicalEvent, type MemoryRecord } from "@amem/core";
import {
  EpisodeStore,
  MemoryStore,
  IndexStore,
  ProposalStore,
  resolveConflict,
  setCrashHooks,
  clearCrashHooks,
  rebuildMemoryIndex,
} from "./index.js";

const homes: string[] = [];
function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), "amem-"));
  homes.push(h);
  return h;
}
afterEach(() => {
  clearCrashHooks();
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function ev(partial: Partial<CanonicalEvent> & Pick<CanonicalEvent, "type" | "session_id">): CanonicalEvent {
  return {
    v: 1,
    ts: new Date().toISOString(),
    host: "cursor",
    user_id: "u",
    payload: {},
    ...partial,
  };
}

describe("EpisodeStore", () => {
  it("seals spool to episode", () => {
    const home = tmpHome();
    const store = new EpisodeStore(home);
    const sid = "sess1";
    store.appendSpool(sid, ev({ type: "session_start", session_id: sid }));
    store.appendSpool(
      sid,
      ev({
        type: "tool_result",
        session_id: sid,
        payload: { output: "Error: Port 3000 is already in use" },
      }),
    );
    const meta = store.seal(sid);
    expect(meta.session_id).toBe(sid);
    expect(store.readEvents(meta)).toHaveLength(2);
    expect(store.episodeBlob(meta)).toContain("Port 3000");
  });

  it("re-sealing unchanged spool reuses the episode instead of duplicating it", () => {
    const home = tmpHome();
    const store = new EpisodeStore(home);
    const sid = "sess-dup";
    store.appendSpool(sid, ev({ type: "session_start", session_id: sid }));

    const first = store.seal(sid);
    const second = store.seal(sid);
    expect(second.episode_id).toBe(first.episode_id);
    expect(second.hash).toBe(first.hash);
    expect(store.listMetas().filter((m) => m.session_id === sid)).toHaveLength(1);

    // New events still produce a fresh episode.
    store.appendSpool(sid, ev({ type: "user_prompt", session_id: sid, payload: { text: "more" } }));
    expect(store.seal(sid).episode_id).not.toBe(first.episode_id);
  });
});

describe("MemoryStore + Index", () => {
  it("writes markdown and rebuilds fts", () => {
    const home = tmpHome();
    const mem = new MemoryStore(home);
    const rec: MemoryRecord = {
      id: newId("mem"),
      kind: "failure",
      title: "dev server port in use",
      content: "Check which process holds the port before changing config.",
      applies_when: "local dev server fails to start with fixed port",
      scope: {
        level: "instance",
        tags: { user: "u", domains: ["vite"], instances: ["abc"] },
      },
      trust: "T3",
      status: "active",
      evidence: {
        episodes: ["ep1"],
        count: 1,
        distinct_instances: 1,
        distinct_domains: 1,
      },
      stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-09-26" },
      created_by: "test",
      updated_at: new Date().toISOString(),
    };
    mem.write(rec);
    expect(mem.readById(rec.id)?.title).toBe(rec.title);
    const idx = new IndexStore(home);
    expect(idx.rebuild(mem)).toBe(1);
    const hits = idx.searchFts("port");
    expect(hits.some((h) => h.id === rec.id)).toBe(true);
    idx.close();
  });

  it("upsert writes new path before removing old on level change", () => {
    const home = tmpHome();
    const mem = new MemoryStore(home);
    const base: MemoryRecord = {
      id: "mem_move",
      kind: "procedure",
      title: "move",
      content: "body",
      applies_when: "when",
      scope: {
        level: "instance",
        tags: { user: "u", domains: ["d"], instances: ["i1"] },
      },
      trust: "T3",
      status: "active",
      evidence: {
        episodes: ["ep1"],
        count: 1,
        distinct_instances: 1,
        distinct_domains: 1,
      },
      stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-09-26" },
      created_by: "test",
      updated_at: new Date().toISOString(),
    };
    const oldPath = mem.write(base);
    expect(existsSync(oldPath)).toBe(true);
    const promoted: MemoryRecord = {
      ...base,
      scope: {
        level: "domain",
        tags: { user: "u", domains: ["d"], instances: ["i1"] },
      },
    };
    const newPath = mem.upsert(promoted, "pipeline");
    expect(newPath).not.toBe(oldPath);
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(oldPath)).toBe(false);
    expect(mem.readById("mem_move")?.scope.level).toBe("domain");
  });

  it("recordRecalled bumps stats without touching updated_at, including T1", () => {
    const home = tmpHome();
    const mem = new MemoryStore(home);
    const updatedAt = "2026-01-01T00:00:00.000Z";
    const rec: MemoryRecord = {
      id: "mem_t1",
      kind: "procedure",
      title: "t1",
      content: "body",
      applies_when: "when",
      scope: { level: "global", tags: { user: "u" } },
      trust: "T1",
      status: "active",
      evidence: { episodes: ["ep1"], count: 1, distinct_instances: 1, distinct_domains: 1 },
      stats: { recalled: 2, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "test",
      updated_at: updatedAt,
    };
    mem.write(rec, "human");
    expect(mem.recordRecalled(["mem_t1", "mem_missing", "mem_t1"])).toBe(1);
    const after = mem.readById("mem_t1");
    expect(after?.stats.recalled).toBe(3);
    expect(after?.updated_at).toBe(updatedAt);
  });
});

describe("ProposalStore", () => {
  it("rejects unsafe proposal ids and skill names", () => {
    const home = tmpHome();
    const ps = new ProposalStore(home);
    expect(() => ps.writeDraft({ id: "../x", skillMd: "s", proposalMd: "p" })).toThrow();
    ps.writeDraft({ id: "prop_ok", skillMd: "---\nname: a\n---\nbody\n", proposalMd: "p" });
    expect(() => ps.apply("prop_ok", "../../escape")).toThrow();
    expect(() => ps.apply("..", "skill")).toThrow();
    expect(() => ps.readSkillMd("../prop_ok")).toThrow();
    expect(existsSync(join(home, "capabilities", "escape"))).toBe(false);
    const dest = ps.apply("prop_ok", "my-skill");
    expect(dest).toBe(join(home, "capabilities", "skills", "my-skill", "SKILL.md"));
  });
});

describe("resolveConflict", () => {
  it("keep_left supersedes right and clears edges", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    const base = {
      kind: "procedure" as const,
      title: "t",
      content: "c",
      applies_when: "w",
      scope: { level: "instance" as const, tags: { user: "u" } },
      trust: "T3" as const,
      status: "conflict" as const,
      evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: { depends_on: [] as string[], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    store.write({ ...base, id: "mem_a", conflicts_with: ["mem_b"] }, "human");
    store.write({ ...base, id: "mem_b", conflicts_with: ["mem_a"] }, "human");
    const r = resolveConflict(home, {
      leftId: "mem_a",
      rightId: "mem_b",
      action: "keep_left",
      leftUpdatedAt: "2026-01-01T00:00:00.000Z",
      rightUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(r.left.status).toBe("active");
    expect(r.right.status).toBe("superseded");
    expect(r.left.conflicts_with ?? []).toEqual([]);
  });
});

describe("crash windows", () => {
  const baseMem = (id: string, level: "instance" | "domain"): MemoryRecord => ({
    id,
    kind: "procedure",
    title: "t",
    content: "body",
    applies_when: "when",
    scope: {
      level,
      tags: { user: "u", domains: ["d"], instances: ["i1"] },
    },
    trust: "T3",
    status: "active",
    evidence: { episodes: ["ep1"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-09-26" },
    created_by: "test",
    updated_at: new Date().toISOString(),
  });

  it("upsert crash after new write keeps new readable (no both-missing)", () => {
    const home = tmpHome();
    const mem = new MemoryStore(home);
    const oldPath = mem.write(baseMem("mem_crash", "instance"));
    setCrashHooks({
      afterUpsertWrite: () => {
        throw new Error("crash after upsert write");
      },
    });
    expect(() => mem.upsert(baseMem("mem_crash", "domain"), "pipeline")).toThrow(/crash after upsert/);
    const hit = mem.readById("mem_crash");
    expect(hit).not.toBeNull();
    expect(hit!.scope.level).toBe("domain");
    expect(existsSync(mem.pathFor(hit!))).toBe(true);
    // Brief dual-file window is acceptable; both-missing is not.
    expect(existsSync(oldPath) || existsSync(mem.pathFor(hit!))).toBe(true);
  });

  it("forget crash after rm leaves dirty index that rebuild clears", () => {
    const home = tmpHome();
    const mem = new MemoryStore(home);
    const rec = baseMem("mem_forget", "domain");
    mem.write(rec);
    const idx = new IndexStore(home);
    idx.rebuild(mem);
    expect(idx.searchFts("body").some((h) => h.id === "mem_forget")).toBe(true);
    idx.close();

    setCrashHooks({
      afterForgetRm: () => {
        throw new Error("crash after forget rm");
      },
    });
    expect(() => mem.forget("mem_forget")).toThrow(/crash after forget/);
    expect(mem.readById("mem_forget")).toBeNull();

    const idx2 = new IndexStore(home);
    // Stale row may still be searchable until rebuild.
    idx2.rebuild(mem);
    expect(idx2.searchFts("body").some((h) => h.id === "mem_forget")).toBe(false);
    idx2.close();
    expect(rebuildMemoryIndex(home)).toBe(0);
  });

  it("seal crash after events leaves jsonl; reseal completes", () => {
    const home = tmpHome();
    const store = new EpisodeStore(home);
    const sid = "sess-crash";
    store.appendSpool(sid, ev({ type: "session_start", session_id: sid }));
    setCrashHooks({
      afterSealEvents: () => {
        throw new Error("crash after seal events");
      },
    });
    expect(() => store.seal(sid)).toThrow(/crash after seal/);
    expect(store.listMetas().filter((m) => m.session_id === sid)).toHaveLength(0);
    clearCrashHooks();
    const meta = store.seal(sid);
    expect(meta.session_id).toBe(sid);
    expect(existsSync(meta.events_path)).toBe(true);
    expect(store.readEvents(meta)).toHaveLength(1);
  });

  it("apply crash after skill staging does not publish incomplete skill", () => {
    const home = tmpHome();
    const ps = new ProposalStore(home);
    ps.writeDraft({
      id: "prop_crash",
      skillMd: "---\nname: crash-skill\ndescription: d\n---\nbody\n",
      proposalMd: "p",
    });
    setCrashHooks({
      afterApplySkill: () => {
        throw new Error("crash after apply skill");
      },
    });
    expect(() => ps.apply("prop_crash", "crash-skill")).toThrow(/crash after apply/);
    const skillsRoot = join(home, "capabilities", "skills");
    expect(existsSync(join(skillsRoot, "crash-skill"))).toBe(false);
    const leftover = existsSync(skillsRoot)
      ? readdirSync(skillsRoot).filter((n) => n.startsWith(".tmp-"))
      : [];
    expect(leftover).toEqual([]);
  });
});
