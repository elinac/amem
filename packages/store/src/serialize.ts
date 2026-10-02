import { MemoryFrontmatterSchema, type MemoryRecord } from "@amem/core";
import matter from "gray-matter";

/** Serialize a memory to Markdown+frontmatter without writing. */
export function serializeMemoryRecord(record: MemoryRecord): string {
  const fm = MemoryFrontmatterSchema.parse({
    id: record.id,
    kind: record.kind,
    title: record.title,
    applies_when: record.applies_when,
    not_applies_when: record.not_applies_when,
    scope: record.scope,
    trust: record.trust,
    status: record.status,
    evidence: record.evidence,
    stats: record.stats,
    validity: record.validity,
    supersedes: record.supersedes ?? null,
    conflicts_with: record.conflicts_with ?? [],
    created_by: record.created_by,
    updated_at: record.updated_at,
  });
  const data = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
  return matter.stringify(`${record.content.trim()}\n`, data);
}
