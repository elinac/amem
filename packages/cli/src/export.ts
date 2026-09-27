import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { paths } from "@amem/core";

export interface ExportOptions {
  /** skill name, or "*" / "all" for every skill */
  skills: string;
  /** include L2 memories (domain+global by default when true) */
  memories?: boolean;
  /** include pending proposals */
  proposals?: boolean;
  out: string;
}

function winExe(name: "tar" | "powershell"): string {
  const root = process.env.SystemRoot || "C:\\Windows";
  if (name === "tar") return join(root, "System32", "tar.exe");
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function zipDir(sourceDir: string, zipPath: string): void {
  mkdirSync(dirname(zipPath), { recursive: true });
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });

  const tarBin = process.platform === "win32" ? winExe("tar") : "tar";
  const tar = spawnSync(
    tarBin,
    ["-a", "-c", "-f", zipPath, "-C", sourceDir, "."],
    { encoding: "utf8" },
  );
  if (tar.status === 0 && existsSync(zipPath)) return;

  if (process.platform === "win32") {
    const src = sourceDir.replace(/'/g, "''");
    const dest = zipPath.replace(/'/g, "''");
    const ps = `
$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath '${src}' -Force | ForEach-Object FullName) -DestinationPath '${dest}' -Force
`;
    const r = spawnSync(
      winExe("powershell"),
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { encoding: "utf8" },
    );
    if (r.status === 0 && existsSync(zipPath)) return;
    throw new Error(
      `zip failed: ${r.stderr || r.stdout || tar.stderr || tar.stdout || tar.error || "unknown"}`,
    );
  }

  const r = spawnSync("zip", ["-r", zipPath, "."], {
    cwd: sourceDir,
    encoding: "utf8",
  });
  if (r.status !== 0 || !existsSync(zipPath)) {
    throw new Error(
      `zip failed (install zip or pass --out <dir>): ${r.stderr || r.stdout || tar.stderr || "unknown"}`,
    );
  }
}

function copySkill(home: string, name: string, destRoot: string): boolean {
  const src = join(paths(home).capabilities, "skills", name);
  if (!existsSync(src)) return false;
  const dest = join(destRoot, "skills", name);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  return true;
}

export function runExport(home: string, opts: ExportOptions): { out: string; items: string[] } {
  const outPath = resolve(opts.out);
  const wantZip = outPath.toLowerCase().endsWith(".zip");
  const staging = wantZip
    ? mkdtempSync(join(tmpdir(), "amem-export-"))
    : outPath;

  mkdirSync(staging, { recursive: true });
  const items: string[] = [];

  const skillsDir = join(paths(home).capabilities, "skills");
  const skillNames =
    opts.skills === "*" || opts.skills === "all"
      ? existsSync(skillsDir)
        ? readdirSync(skillsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
        : []
      : opts.skills.split(",").map((s) => s.trim()).filter(Boolean);

  for (const name of skillNames) {
    if (copySkill(home, name, staging)) items.push(`skills/${name}`);
    else console.error(`warn: skill not found: ${name}`);
  }

  if (opts.proposals) {
    const propSrc = join(paths(home).capabilities, ".proposals");
    if (existsSync(propSrc)) {
      const dest = join(staging, "proposals");
      cpSync(propSrc, dest, { recursive: true });
      items.push("proposals/");
    }
  }

  if (opts.memories) {
    const memRoot = paths(home).memories;
    for (const level of ["domain", "global"] as const) {
      const src = join(memRoot, level);
      if (!existsSync(src)) continue;
      const dest = join(staging, "memories", level);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true });
      items.push(`memories/${level}/`);
    }
  }

  writeFileSync(
    join(staging, "EXPORT.md"),
    `# amem export

Exported: ${new Date().toISOString()}
Items: ${items.length ? items.join(", ") : "(none)"}

## Import (recipient)

### Skills into amem
Copy \`skills/<name>\` into \`\$AMEM_HOME/capabilities/skills/\`, then:

\`\`\`
amem compile --target cursor
\`\`\`

### Skills into Cursor only
Copy \`skills/<name>\` contents into \`~/.cursor/skills/<name>/\`.

### Memories
Copy \`memories/\` into \`\$AMEM_HOME/memories/\`, then \`amem rebuild-index\`.
`,
  );
  items.push("EXPORT.md");

  if (!items.filter((i) => i !== "EXPORT.md").length) {
    if (wantZip) rmSync(staging, { recursive: true, force: true });
    throw new Error("nothing to export (no matching skills/memories/proposals)");
  }

  if (wantZip) {
    try {
      zipDir(staging, outPath);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    return { out: outPath, items };
  }

  return { out: staging, items };
}

export function defaultExportName(skills: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const label =
    skills === "*" || skills === "all" ? "all-skills" : skills.replace(/[^\w.-]+/g, "_");
  return `amem-export-${label}-${stamp}.zip`;
}

export { basename };
