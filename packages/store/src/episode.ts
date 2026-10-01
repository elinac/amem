import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";
import {
  type CanonicalEvent,
  type EpisodeMeta,
  CanonicalEventSchema,
  newId,
  paths,
  sanitizeId,
} from "@amem/core";

export class EpisodeStore {
  constructor(private readonly home: string) {}

  spoolPath(sessionId: string): string {
    return join(paths(this.home).spool, `${sanitizeId(sessionId)}.jsonl`);
  }

  appendSpool(sessionId: string, event: CanonicalEvent): void {
    const parsed = CanonicalEventSchema.parse(event);
    const p = this.spoolPath(sessionId);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, `${JSON.stringify(parsed)}\n`);
  }

  readSpool(sessionId: string): CanonicalEvent[] {
    const p = this.spoolPath(sessionId);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => CanonicalEventSchema.parse(JSON.parse(l)));
  }

  seal(sessionId: string, opts?: Partial<EpisodeMeta>): EpisodeMeta {
    const events = this.readSpool(sessionId);
    if (!events.length) {
      throw new Error(`no spool events for session ${sessionId}`);
    }
    const episodeId = opts?.episode_id ?? newId("ep");
    const started = events[0]!.ts;
    const ended = events[events.length - 1]!.ts;
    const host = events[0]!.host;
    const instanceId = events.find((e) => e.workspace)?.workspace?.instance_id;
    const ym = ended.slice(0, 7).replace("-", "/"); // 2026/09
    const dir = join(paths(this.home).episodes, ym);
    mkdirSync(dir, { recursive: true });
    const eventsPath = join(dir, `${episodeId}.jsonl`);
    const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const hash = createHash("sha256").update(body).digest("hex");
    // Re-sealing unchanged spool is a no-op: retries must not litter duplicate episodes.
    const existing = this.listMetas().find((m) => m.session_id === sessionId && m.hash === hash);
    if (existing) return existing;
    writeFileSync(eventsPath, body);
    const meta: EpisodeMeta = {
      episode_id: episodeId,
      session_id: sessionId,
      host,
      started_at: started,
      ended_at: ended,
      instance_id: instanceId,
      domains_guess: opts?.domains_guess ?? [],
      events_path: eventsPath,
      outcome: opts?.outcome ?? { signals: {}, label: "unknown" },
      transcript_source: opts?.transcript_source ?? "hook",
      hash,
    };
    writeFileSync(join(dir, `${episodeId}.meta.yaml`), yamlStringify(meta));
    return meta;
  }

  readEvents(meta: EpisodeMeta): CanonicalEvent[] {
    return readFileSync(meta.events_path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => CanonicalEventSchema.parse(JSON.parse(l)));
  }

  episodeBlob(meta: EpisodeMeta): string {
    return readFileSync(meta.events_path, "utf8");
  }

  listMetas(): EpisodeMeta[] {
    const root = paths(this.home).episodes;
    if (!existsSync(root)) return [];
    const out: EpisodeMeta[] = [];
    for (const y of readdirSync(root)) {
      const yp = join(root, y);
      for (const m of readdirSync(yp)) {
        const mp = join(yp, m);
        for (const f of readdirSync(mp).filter((x) => x.endsWith(".meta.yaml"))) {
          out.push(yamlParse(readFileSync(join(mp, f), "utf8")) as EpisodeMeta);
        }
      }
    }
    return out;
  }
}
