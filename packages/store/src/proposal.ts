import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteText, isSafeId, paths } from "@amem/core";
import { crashHooks } from "./crash-hooks.js";

function assertSegment(value: string, label: string): void {
  if (!isSafeId(value)) throw new Error(`unsafe ${label}: ${JSON.stringify(value)}`);
}

export type ProposalRow = {
  id: string;
  hasProposalMd: boolean;
  title: string;
  summary: string;
};

function skillFrontmatterAndBody(text: string): {
  description: string;
  name: string;
  body: string;
} {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { description: "", name: "", body: normalized.trim() };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return { description: "", name: "", body: normalized.trim() };
  }
  const head = lines.slice(1, close).join("\n");
  const body = lines
    .slice(close + 1)
    .join("\n")
    .trim();
  const description = head.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const name = head.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { description, name, body };
}

/** Pending Proposal drafts under capabilities/.proposals — layout private to this module. */
export class ProposalStore {
  constructor(private readonly home: string) {}

  proposalsRoot(): string {
    return join(paths(this.home).capabilities, ".proposals");
  }

  writeDraft(input: { id: string; skillMd: string; proposalMd: string }): void {
    assertSegment(input.id, "proposal id");
    const dir = join(this.proposalsRoot(), input.id);
    mkdirSync(dir, { recursive: true });
    atomicWriteText(join(dir, "SKILL.md"), input.skillMd);
    atomicWriteText(join(dir, "proposal.md"), input.proposalMd);
  }

  list(): ProposalRow[] {
    const dir = this.proposalsRoot();
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .map((id) => {
        const skill = join(dir, id, "SKILL.md");
        const proposal = join(dir, id, "proposal.md");
        let title = id;
        let summary = "";
        if (existsSync(skill)) {
          const text = readFileSync(skill, "utf8");
          const parsed = skillFrontmatterAndBody(text);
          title = parsed.description || parsed.name || id;
          summary = parsed.body.replace(/\s+/g, " ").slice(0, 200);
        }
        return {
          id,
          hasProposalMd: existsSync(proposal),
          title,
          summary,
        };
      });
  }

  readSkillMd(id: string): string | null {
    assertSegment(id, "proposal id");
    const src = join(this.proposalsRoot(), id, "SKILL.md");
    if (!existsSync(src)) return null;
    return readFileSync(src, "utf8");
  }

  apply(proposalId: string, skillName: string): string {
    assertSegment(proposalId, "proposal id");
    assertSegment(skillName, "skill name");
    const src = join(this.proposalsRoot(), proposalId, "SKILL.md");
    if (!existsSync(src)) throw new Error(`proposal not found: ${proposalId}`);
    const skillsRoot = join(paths(this.home).capabilities, "skills");
    mkdirSync(skillsRoot, { recursive: true });
    const stagingDir = join(skillsRoot, `.tmp-${skillName}.${process.pid}.${Date.now()}`);
    const destDir = join(skillsRoot, skillName);
    mkdirSync(stagingDir, { recursive: true });
    try {
      atomicWriteText(join(stagingDir, "SKILL.md"), readFileSync(src, "utf8"));
      crashHooks().afterApplySkill?.({ stagingDir, skillName });
      atomicWriteText(
        join(stagingDir, "capability.yaml"),
        `id: ${skillName}\nversion: 0.1.0\nstatus: active\nsource_proposal: ${proposalId}\n`,
      );
      rmSync(destDir, { recursive: true, force: true });
      renameSync(stagingDir, destDir);
    } catch (e) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw e;
    }
    return join(destDir, "SKILL.md");
  }

  exportAll(destDir: string): boolean {
    const src = this.proposalsRoot();
    if (!existsSync(src)) return false;
    mkdirSync(destDir, { recursive: true });
    cpSync(src, destDir, { recursive: true });
    return true;
  }
}
