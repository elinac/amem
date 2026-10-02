import { describe, expect, it } from "vitest";
import { _skillFrontmatterAndBodyForTest as parse } from "./index.js";

describe("skillFrontmatterAndBody", () => {
  it("parses simple frontmatter", () => {
    const r = parse("---\nname: mem_x\ndescription: My Title\n---\n\nBody text\n");
    expect(r.name).toBe("mem_x");
    expect(r.description).toBe("My Title");
    expect(r.body).toBe("Body text");
  });

  it("keeps body when body contains a markdown HR line of ---", () => {
    const r = parse("---\nname: mem_x\ndescription: My Title\n---\n\nIntro\n\n---\n\nAfter HR\n");
    expect(r.description).toBe("My Title");
    expect(r.name).toBe("mem_x");
    expect(r.body).toContain("Intro");
    expect(r.body).toContain("---");
    expect(r.body).toContain("After HR");
  });

  it("keeps body when --- appears inline in prose", () => {
    const r = parse(
      "---\nname: mem_x\ndescription: Title\n---\n\nUse --- as a separator in prose.\n",
    );
    expect(r.description).toBe("Title");
    expect(r.body).toBe("Use --- as a separator in prose.");
  });

  it("does not treat mid-frontmatter --- as body when malformed (closes at first delimiter line)", () => {
    // A lone --- line ends frontmatter; remaining lines are body.
    const r = parse("---\nname: mem_x\n---\ndescription: lost\n---\n\nBody\n");
    expect(r.name).toBe("mem_x");
    expect(r.description).toBe("");
    expect(r.body).toContain("description: lost");
    expect(r.body).toContain("Body");
  });
});
