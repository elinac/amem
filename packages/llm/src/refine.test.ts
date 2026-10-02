import { defaultConfig } from "@amem/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tryRefineProposalSkill } from "./index.js";

describe("tryRefineProposalSkill", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null in stub mode", async () => {
    const cfg = defaultConfig();
    cfg.llm.mode = "stub";
    cfg.budget.consolidate.refine_proposals = true;
    await expect(
      tryRefineProposalSkill(cfg, { id: "m1", title: "t", content: "c" }),
    ).resolves.toBeNull();
  });

  it("returns refined markdown when external LLM succeeds", async () => {
    const cfg = defaultConfig();
    cfg.llm.mode = "external";
    cfg.llm.api_key = "test-key";
    cfg.llm.base_url = "https://llm.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "---\nname: m1\ndescription: refined\n---\n\nrefined body\n",
              },
            },
          ],
        }),
      })),
    );
    const out = await tryRefineProposalSkill(cfg, {
      id: "m1",
      title: "t",
      content: "original",
    });
    expect(out).toContain("refined body");
    expect(out).toContain("name: m1");
  });

  it("returns null when external LLM fails", async () => {
    const cfg = defaultConfig();
    cfg.llm.mode = "external";
    cfg.llm.api_key = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    await expect(
      tryRefineProposalSkill(cfg, { id: "m1", title: "t", content: "c" }),
    ).resolves.toBeNull();
  });
});
