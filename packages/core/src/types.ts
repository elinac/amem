export type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "dsh"
  | "generic";

export type CanonicalEventType =
  | "session_start"
  | "user_prompt"
  | "agent_response"
  | "tool_call"
  | "tool_result"
  | "shell_result"
  | "file_edit"
  | "compact"
  | "feedback"
  | "session_end";

export type MemoryKind =
  | "fact"
  | "case"
  | "failure"
  | "procedure"
  | "tool_quirk"
  | "strategy"
  | "criterion"
  | "constraint_hint"
  | "preference"
  | "open_question";

export type ScopeLevel = "instance" | "domain" | "global";
export type Trust = "T3" | "T2" | "T1";
export type MemoryStatus =
  | "candidate"
  | "active"
  | "superseded"
  | "conflict"
  | "frozen"
  | "expired";

export type OutcomeLabel = "success" | "partial" | "failure" | "unknown";

export interface CanonicalEvent {
  v: 1;
  ts: string;
  host: HostId;
  host_version?: string;
  session_id: string;
  turn_id?: string;
  workspace?: {
    roots: string[];
    git_remote?: string;
    instance_id: string;
  };
  user_id: string;
  model?: string;
  type: CanonicalEventType;
  payload: Record<string, unknown>;
  refs?: {
    memory_ids?: string[];
    pack_id?: string;
    capability_versions?: string[];
  };
}

export interface EpisodeOutcome {
  signals: {
    tests?: { passed: number; failed: number };
    user_confirmations?: number;
    user_corrections?: number;
    reverted_edits?: number;
  };
  label: OutcomeLabel;
}

export interface EpisodeMeta {
  episode_id: string;
  session_id: string;
  host: HostId;
  started_at: string;
  ended_at: string;
  instance_id?: string;
  domains_guess: string[];
  events_path: string;
  outcome: EpisodeOutcome;
  transcript_source: "hook" | "transcript_import" | "agent_summary";
  hash: string;
}

export interface MemoryEvidence {
  episodes: string[];
  quotes?: { ep: string; event?: number; text: string }[];
  count: number;
  distinct_instances: number;
  distinct_domains: number;
}

export interface MemoryStats {
  recalled: number;
  adopted: number;
  helpful: number;
  harmful: number;
  lift: number;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  applies_when: string;
  not_applies_when?: string;
  scope: {
    level: ScopeLevel;
    tags: {
      user?: string;
      domains?: string[];
      tools?: string[];
      task_type?: string;
      instances?: string[];
      agent_role?: string;
      tenant?: string;
    };
  };
  trust: Trust;
  status: MemoryStatus;
  evidence: MemoryEvidence;
  stats: MemoryStats;
  validity: {
    depends_on: string[];
    valid_from: string;
    review_by?: string;
  };
  supersedes?: string | null;
  created_by: string;
  updated_at: string;
}

export interface Situation {
  query: string;
  task_type?: string;
  domains: string[];
  tools: string[];
  instance_id?: string;
  user_id: string;
}

export interface PackItem {
  layer: "constraint" | "process" | "skill" | "knowledge" | "memory" | "preference";
  ref: string;
  level?: ScopeLevel;
  score?: number;
  tokens: number;
}

export interface ContextPack {
  pack_id: string;
  session_id: string;
  host: HostId;
  situation: Situation;
  budget_tokens: number;
  items: PackItem[];
  dropped: { ref: string; reason: string }[];
  created_at: string;
}

export interface MemoryCandidate {
  kind: MemoryKind;
  title: string;
  content: string;
  applies_when: string;
  not_applies_when?: string;
  domains?: string[];
  tools?: string[];
  task_type?: string;
  evidence: { event: number; quote: string }[];
  confidence?: number;
}
