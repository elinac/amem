import { type AmemConfig, type ContextPack, type HostId, type Situation, newId } from "@amem/core";
import {
  type EpochItem,
  type EpochRecord,
  assertEpochIds,
  casEpochState,
  epochKeyHash,
  readEpoch,
  tryCreateOpenEpoch,
} from "@amem/store";
import { buildContextPack } from "./pack.js";

export type EpochPackResult = {
  pack: ContextPack;
  epoch: EpochRecord;
  /** True when reused committed snapshot without rebuilding. */
  reused: boolean;
  /** True when returned empty pack due to revoked/degraded/timeout. */
  degraded: boolean;
};

const OPEN_WAIT_MS = 2_000;
const OPEN_POLL_MS = 50;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function emptyPack(
  sessionId: string,
  situation: Situation,
  host: HostId,
  budget: number,
): ContextPack {
  return {
    pack_id: newId("cp"),
    session_id: sessionId,
    host,
    situation,
    budget_tokens: budget,
    items: [],
    dropped: [{ ref: "*", reason: "epoch_degraded" }],
    created_at: new Date().toISOString(),
  };
}

function packFromEpoch(
  ep: EpochRecord,
  situation: Situation,
  host: HostId,
  budget: number,
): ContextPack {
  return {
    pack_id: ep.pack_id ?? newId("cp"),
    session_id: ep.sessionId,
    host,
    situation,
    budget_tokens: budget,
    items: (ep.items ?? []).map((it) => ({
      layer: (it.layer as ContextPack["items"][number]["layer"]) ?? "memory",
      ref: it.ref,
      level: it.level as ContextPack["items"][number]["level"],
      score: it.score,
      tokens: it.tokens ?? 1,
      decision: it.decision as ContextPack["items"][number]["decision"] | undefined,
      decision_id: it.decision_id,
    })),
    dropped: [],
    created_at: ep.created_at,
  };
}

/**
 * Explicit epoch snapshot: open → decide+render → CAS committed.
 * Losers wait for committed or return degraded empty pack.
 */
export function getOrCreateEpochPack(opts: {
  home: string;
  cfg: AmemConfig;
  situation: Situation;
  userId: string;
  sessionId: string;
  epochId: string;
  host?: HostId;
}): EpochPackResult {
  const { home, cfg, situation, userId, sessionId, epochId } = opts;
  const host = opts.host ?? "cursor";
  assertEpochIds(userId, sessionId, epochId);
  const key = epochKeyHash(userId, sessionId, epochId);

  const existing = readEpoch(home, key);
  if (existing?.state === "committed") {
    return {
      pack: packFromEpoch(existing, situation, host, cfg.recall.budget_tokens),
      epoch: existing,
      reused: true,
      degraded: false,
    };
  }
  if (existing?.state === "revoked") {
    return {
      pack: emptyPack(sessionId, situation, host, cfg.recall.budget_tokens),
      epoch: existing,
      reused: false,
      degraded: true,
    };
  }

  const created = tryCreateOpenEpoch(home, userId, sessionId, epochId);
  if (created) {
    const pack = buildContextPack({
      home,
      cfg,
      situation,
      sessionId,
      host,
      trackStats: false,
    });
    const items: EpochItem[] = pack.items.map((it) => ({
      ref: it.ref,
      layer: it.layer,
      level: it.level,
      score: it.score,
      tokens: it.tokens,
      decision: it.decision,
      decision_id: it.decision_id,
    }));
    const committed = casEpochState(home, key, "open", "committed", {
      pack_id: pack.pack_id,
      items,
      safety: {},
    });
    if (!committed) {
      const won = readEpoch(home, key);
      if (won?.state === "committed") {
        return {
          pack: packFromEpoch(won, situation, host, cfg.recall.budget_tokens),
          epoch: won,
          reused: true,
          degraded: false,
        };
      }
      return {
        pack: emptyPack(sessionId, situation, host, cfg.recall.budget_tokens),
        epoch: won ?? created,
        reused: false,
        degraded: true,
      };
    }
    return { pack, epoch: committed, reused: false, degraded: false };
  }

  const deadline = Date.now() + OPEN_WAIT_MS;
  while (Date.now() < deadline) {
    const cur = readEpoch(home, key);
    if (cur?.state === "committed") {
      return {
        pack: packFromEpoch(cur, situation, host, cfg.recall.budget_tokens),
        epoch: cur,
        reused: true,
        degraded: false,
      };
    }
    if (cur?.state === "revoked") {
      return {
        pack: emptyPack(sessionId, situation, host, cfg.recall.budget_tokens),
        epoch: cur,
        reused: false,
        degraded: true,
      };
    }
    sleep(OPEN_POLL_MS);
  }
  const last = readEpoch(home, key);
  return {
    pack: emptyPack(sessionId, situation, host, cfg.recall.budget_tokens),
    epoch: last ?? {
      key,
      userId,
      sessionId,
      epochId,
      state: "open",
      items: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    reused: false,
    degraded: true,
  };
}

export { appendDecisionAudit, readDecisionAudit } from "./decision-audit.js";
