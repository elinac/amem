import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, type CanonicalEvent, type MemoryRecord } from "@amem/core";
import { EpisodeStore, MemoryStore } from "@amem/store";

const { extractCandidates } = vi.hoisted(() => ({ extractCandidates: vi.fn() }));

vi.mock("@amem/llm", () => ({
  createLlmClient: () => ({ extractCandidates }),
  tryRefineProposalSkill: vi.fn(async () => null),
}));

import { extractSession } from "./extract.js";

const HINT = "SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\\dev\\workspaces\\amem)";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
  extractCandidates.mockReset();
});

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "amem-verify-"));
  homes.push(home);
  return home;
}

function ev(
  partial: Partial<CanonicalEvent> & Pick<CanonicalEvent, "type" | "session_id">,
): CanonicalEvent {
  return {
    v: 1,
    ts: new Date().toISOString(),
    host: "dsh",
    user_id: "u",
    payload: {},
    ...partial,
  };
}

function agentNote(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_note",
    kind: "tool_quirk",
    title: "amem workspace root write denied",
    content: "Shell calls fail before running; prefer read/grep/glob while the ACL is broken.",
    applies_when: "probing the amem workspace through shell commands",
    scope: { level: "instance", tags: { user: "u" } },
    trust: "T3",
    status: "candidate",
    evidence: {
      episodes: [],
      quotes: [{ ep: "agent-note", text: HINT }],
      count: 0,
      distinct_instances: 1,
      distinct_domains: 1,
    },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-10-01" },
    supersedes: null,
    created_by: "agent-note",
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe("extractSession promotes validated agent notes", () => {
  it("promotes a candidate whose hint occurs in an external signal of the sealed episode", async () => {
    const home = newHome();
    const sid = "s-promote";
    const ep = new EpisodeStore(home);
    // The note's own tool call carries the hint - it must not count as evidence.
    ep.appendSpool(
      sid,
      ev({
        type: "tool_call",
        session_id: sid,
        payload: { tool_name: "memory_note", tool_input: { evidence_hint: HINT } },
      }),
    );
    ep.appendSpool(
      sid,
      ev({ type: "tool_result", session_id: sid, payload: { output: `pwsh failed: ${HINT}` } }),
    );

    const notes = new MemoryStore(home);
    notes.write(agentNote(), "agent-note");
    extractCandidates.mockResolvedValue([]);

    const r = await extractSession(home, sid, defaultConfig("u"));

    const after = notes.readById("mem_note")!;
    expect(after.status).toBe("active");
    expect(after.evidence.episodes).toHaveLength(1);
    expect(after.evidence.quotes?.[0]?.ep).toBe("agent-note"); // original hint kept
    const stored = after.evidence.quotes!.find((q) => q.ep !== "agent-note")!;
    expect(stored.event).toBe(1); // the tool_result event
    // I3 still holds: the recorded quote is verbatim in the stored Episode.
    const sealed = ep.listMetas().find((m) => m.session_id === sid)!;
    expect(ep.episodeBlob(sealed).includes(stored.text)).toBe(true);
    expect(after.evidence.count).toBe(1);
    expect(after.trust).toBe("T3");
    expect(after.scope.level).toBe("instance");
    expect(r.written).toContain("mem_note");
  });

  it("keeps a candidate when its hint only occurs in its own tool call", async () => {
    const home = newHome();
    const sid = "s-selffulfilling";
    const ep = new EpisodeStore(home);
    ep.appendSpool(
      sid,
      ev({
        type: "tool_call",
        session_id: sid,
        payload: { tool_name: "memory_note", tool_input: { evidence_hint: HINT } },
      }),
    );
    ep.appendSpool(
      sid,
      ev({ type: "tool_result", session_id: sid, payload: { output: "unrelated output" } }),
    );

    const notes = new MemoryStore(home);
    notes.write(agentNote(), "agent-note");
    extractCandidates.mockResolvedValue([]);

    const r = await extractSession(home, sid, defaultConfig("u"));

    expect(notes.readById("mem_note")!.status).toBe("candidate");
    expect(notes.readById("mem_note")!.evidence.episodes).toEqual([]);
    expect(r.written).not.toContain("mem_note");
  });

  it("refuses short hints that match by accident", async () => {
    const home = newHome();
    const sid = "s-short";
    const ep = new EpisodeStore(home);
    ep.appendSpool(
      sid,
      ev({ type: "tool_result", session_id: sid, payload: { output: "port in use somewhere" } }),
    );

    const notes = new MemoryStore(home);
    notes.write(
      agentNote({ evidence: {
        episodes: [],
        quotes: [{ ep: "agent-note", text: "port in use" }],
        count: 0,
        distinct_instances: 1,
        distinct_domains: 1,
      } }),
      "agent-note",
    );
    extractCandidates.mockResolvedValue([]);

    await extractSession(home, sid, defaultConfig("u"));
    expect(notes.readById("mem_note")!.status).toBe("candidate");
  });

  it("promotes through reconcile when the LLM re-derives the same memory with valid evidence", async () => {
    const home = newHome();
    const sid = "s-reconcile";
    const ep = new EpisodeStore(home);
    ep.appendSpool(
      sid,
      ev({
        type: "tool_result",
        session_id: sid,
        payload: { output: "Error: Port 3000 is already in use" },
      }),
    );

    const notes = new MemoryStore(home);
    const base = agentNote({
      id: "mem_port",
      kind: "failure",
      title: "dev server port conflict",
      content: "Check which process holds the port before changing the config.",
      applies_when: "local dev server fails to start on a fixed port",
      evidence: { episodes: [], count: 0, distinct_instances: 1, distinct_domains: 1 },
    });
    notes.write(base, "agent-note");

    extractCandidates.mockResolvedValue([
      {
        kind: "failure",
        title: "dev server port conflict",
        content: `${base.content} Verified with netstat -ano | findstr :3000.`,
        applies_when: "local dev server fails to start on a fixed port",
        evidence: [{ event: 0, quote: "Error: Port 3000 is already in use" }],
      },
    ]);

    const r = await extractSession(home, sid, defaultConfig("u"));

    const after = notes.readById("mem_port")!;
    expect(after.status).toBe("active");
    expect(after.evidence.count).toBe(1);
    expect(after.evidence.episodes).toHaveLength(1);
    expect(after.evidence.quotes?.[0]?.text).toBe("Error: Port 3000 is already in use");
    expect(r.written).toContain("mem_port");
    // No duplicate record was created for the same lesson.
    expect(notes.listAll().filter((m) => m.title === "dev server port conflict")).toHaveLength(1);
  });

  it("leaves a candidate alone when the LLM evidence is not verbatim in the episode", async () => {
    const home = newHome();
    const sid = "s-badevidence";
    const ep = new EpisodeStore(home);
    ep.appendSpool(
      sid,
      ev({ type: "tool_result", session_id: sid, payload: { output: "nothing relevant" } }),
    );

    const notes = new MemoryStore(home);
    notes.write(
      agentNote({
        id: "mem_port",
        kind: "failure",
        title: "dev server port conflict",
        content: "Check which process holds the port before changing the config.",
        applies_when: "local dev server fails to start on a fixed port",
        evidence: { episodes: [], count: 0, distinct_instances: 1, distinct_domains: 1 },
      }),
      "agent-note",
    );

    extractCandidates.mockResolvedValue([
      {
        kind: "failure",
        title: "dev server port conflict",
        content: "Invented content that no episode supports, but long enough to compare.",
        applies_when: "local dev server fails to start on a fixed port",
        evidence: [{ event: 0, quote: "Error: Port 3000 is already in use" }],
      },
    ]);

    const r = await extractSession(home, sid, defaultConfig("u"));
    expect(notes.readById("mem_port")!.status).toBe("candidate");
    expect(notes.readById("mem_port")!.evidence.count).toBe(0);
    expect(r.written).not.toContain("mem_port");
  });
});
