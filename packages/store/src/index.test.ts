import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { newId, type CanonicalEvent, type MemoryRecord } from "@amem/core";
import { EpisodeStore, MemoryStore, IndexStore } from "./index.js";

const homes: string[] = [];
function tmpHome(): string {
  const h = mkdtempSync(join(tmpdir(), "amem-"));
  homes.push(h);
  return h;
}
afterEach(() => {
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
});
