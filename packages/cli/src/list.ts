import { listProposalsData, listSkillsData } from "@amem/compiler";
import { MemoryStore } from "@amem/store";

export type ListKind = "memories" | "skills" | "proposals" | "all";

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, n - 1)}…` : s;
  return t.padEnd(n);
}

function printTable(headers: string[], rows: string[][], widths: number[]): void {
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i]!)).join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

export function listMemories(home: string, limit = 50): void {
  const all = new MemoryStore(home).listAll();
  all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const rows = all
    .slice(0, limit)
    .map((m) => [
      m.id,
      m.kind,
      m.scope.level,
      m.trust,
      m.status,
      String(m.stats.helpful),
      String(m.stats.harmful),
      m.title,
    ]);
  console.log(`# memories (${all.length}${all.length > limit ? `, showing ${limit}` : ""})`);
  if (!rows.length) {
    console.log("(empty)");
    return;
  }
  printTable(
    ["id", "kind", "level", "trust", "status", "help", "harm", "title"],
    rows,
    [22, 14, 8, 5, 10, 4, 4, 40],
  );
}

export function listSkills(home: string): void {
  const rows = listSkillsData(home).map((s) => [
    s.name,
    s.version,
    s.hasSkillMd ? "yes" : "no",
    s.description,
  ]);
  console.log(`# skills (${rows.length})`);
  if (!rows.length) {
    console.log("(empty)");
    return;
  }
  printTable(["name", "version", "skill.md", "description"], rows, [24, 10, 8, 48]);
}

export function listProposals(home: string): void {
  const rows = listProposalsData(home).map((p) => [p.id, p.hasProposalMd ? "yes" : "no", p.title]);
  console.log(`# proposals (${rows.length})`);
  if (!rows.length) {
    console.log("(empty)");
    return;
  }
  printTable(["id", "proposal.md", "title"], rows, [28, 11, 48]);
}

export function runList(home: string, kind: ListKind, limit = 50): void {
  if (kind === "memories" || kind === "all") listMemories(home, limit);
  if (kind === "all") console.log("");
  if (kind === "skills" || kind === "all") listSkills(home);
  if (kind === "all") console.log("");
  if (kind === "proposals" || kind === "all") listProposals(home);
}
