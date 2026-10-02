import { z } from "zod";

export const HostIdSchema = z.enum([
  "cursor",
  "claude-code",
  "codex",
  "opencode",
  "gemini",
  "dsh",
  "generic",
]);

export const MemoryKindSchema = z.enum([
  "fact",
  "case",
  "failure",
  "procedure",
  "tool_quirk",
  "strategy",
  "criterion",
  "constraint_hint",
  "preference",
  "open_question",
]);

export const ScopeLevelSchema = z.enum(["instance", "domain", "global"]);
export const TrustSchema = z.enum(["T3", "T2", "T1"]);
export const MemoryStatusSchema = z.enum([
  "candidate",
  "active",
  "superseded",
  "conflict",
  "frozen",
  "expired",
]);

/** Canonical enum arrays for list filters (admin / RPC / UI). */
export const MEMORY_KINDS = MemoryKindSchema.options;
export const SCOPE_LEVELS = ScopeLevelSchema.options;
export const TRUSTS = TrustSchema.options;
export const MEMORY_STATUSES = MemoryStatusSchema.options;
export const MEMORY_PAGE_SIZES = [20, 50, 100] as const;
export type MemoryPageSize = (typeof MEMORY_PAGE_SIZES)[number];

export const CanonicalEventSchema = z.object({
  v: z.literal(1),
  ts: z.string(),
  host: HostIdSchema,
  host_version: z.string().optional(),
  session_id: z.string().min(1),
  turn_id: z.string().optional(),
  workspace: z
    .object({
      roots: z.array(z.string()),
      git_remote: z.string().optional(),
      instance_id: z.string(),
    })
    .optional(),
  user_id: z.string(),
  model: z.string().optional(),
  type: z.enum([
    "session_start",
    "user_prompt",
    "agent_response",
    "tool_call",
    "tool_result",
    "shell_result",
    "file_edit",
    "compact",
    "feedback",
    "session_end",
  ]),
  payload: z.record(z.unknown()),
  refs: z
    .object({
      memory_ids: z.array(z.string()).optional(),
      pack_id: z.string().optional(),
      capability_versions: z.array(z.string()).optional(),
    })
    .optional(),
});

export const ExtractCandidateSchema = z.object({
  kind: MemoryKindSchema,
  title: z.string().max(80),
  content: z.string().max(1200),
  applies_when: z.string().min(1),
  not_applies_when: z.string().optional(),
  domains: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  task_type: z.string().optional(),
  evidence: z
    .array(
      z.object({
        event: z.number().int().nonnegative(),
        quote: z.string().min(1),
      }),
    )
    .min(1),
  confidence: z.number().optional(),
});

export const ExtractCandidatesSchema = z.object({
  candidates: z.array(ExtractCandidateSchema).max(8),
});

export const MemoryFrontmatterSchema = z.object({
  id: z.string(),
  kind: MemoryKindSchema,
  title: z.string(),
  applies_when: z.string(),
  not_applies_when: z.string().optional(),
  scope: z.object({
    level: ScopeLevelSchema,
    tags: z.object({
      user: z.string().optional(),
      domains: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      task_type: z.string().optional(),
      instances: z.array(z.string()).optional(),
      agent_role: z.string().optional(),
      tenant: z.string().optional(),
    }),
  }),
  trust: TrustSchema,
  status: MemoryStatusSchema,
  evidence: z.object({
    episodes: z.array(z.string()),
    quotes: z
      .array(
        z.object({
          ep: z.string(),
          event: z.number().optional(),
          text: z.string(),
        }),
      )
      .optional(),
    count: z.number(),
    distinct_instances: z.number(),
    distinct_domains: z.number(),
  }),
  stats: z.object({
    recalled: z.number(),
    adopted: z.number(),
    helpful: z.number(),
    harmful: z.number(),
    lift: z.number(),
  }),
  validity: z.object({
    depends_on: z.array(z.string()),
    valid_from: z.string(),
    review_by: z.string().optional(),
  }),
  supersedes: z.string().nullable().optional(),
  conflicts_with: z.array(z.string()).optional().default([]),
  created_by: z.string(),
  updated_at: z.string(),
});
