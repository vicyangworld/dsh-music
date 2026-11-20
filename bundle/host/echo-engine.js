// src/schema.ts
var SCHEMA_VERSION = 1;
var LIFE_STAGES = ["egg", "newborn", "juvenile", "growth", "mature"];

// src/events.ts
var CHANNEL_CREDIBILITY = {
  "local-player": "verified",
  "user-share": "attested",
  "mood-session": "subjective",
  interaction: "verified",
  system: "system"
};
var CHANNEL_LICENSE_KINDS = {
  "local-player": ["user-owned-local", "original-builtin"],
  "user-share": ["user-provided-metadata"],
  "mood-session": ["user-provided-metadata", "user-mood-input"],
  interaction: ["user-provided-metadata", "original-builtin"],
  system: ["original-builtin"]
};
var finite = (x) => typeof x === "number" && Number.isFinite(x);
function validateInput(input) {
  if (!input || typeof input !== "object") return { ok: false, reason: "input-not-object" };
  if (!input.eventId || typeof input.eventId !== "string") return { ok: false, reason: "missing-eventId" };
  if (input.petId !== null && typeof input.petId !== "string") return { ok: false, reason: "bad-petId" };
  if (!finite(input.occurredAt) || input.occurredAt < 0) return { ok: false, reason: "bad-occurredAt" };
  if (!finite(input.ingestedAt)) return { ok: false, reason: "bad-ingestedAt" };
  const p = input.provenance;
  if (!p || typeof p !== "object") return { ok: false, reason: "missing-provenance" };
  if (!finite(p.confidence) || p.confidence < 0 || p.confidence > 1) return { ok: false, reason: "bad-confidence" };
  if (!p.license || typeof p.license.kind !== "string") return { ok: false, reason: "missing-license" };
  const data = input.data;
  if (!data || typeof data !== "object") return { ok: false, reason: "missing-data" };
  const channelByType = {
    listening: "local-player",
    share: "user-share",
    mood: "mood-session",
    interaction: "interaction",
    system: "system"
  };
  const expectedChannel = channelByType[data.type];
  if (!expectedChannel) return { ok: false, reason: `engine-only-or-unknown-type:${data.type}` };
  if (p.channel !== expectedChannel) return { ok: false, reason: "channel-type-mismatch" };
  if (p.credibility !== CHANNEL_CREDIBILITY[p.channel]) return { ok: false, reason: "credibility-channel-mismatch" };
  if (!CHANNEL_LICENSE_KINDS[p.channel].includes(p.license.kind)) return { ok: false, reason: "license-not-allowed-for-channel" };
  switch (data.type) {
    case "listening": {
      const d = data.payload;
      if (!d.trackId || !d.sourceId) return { ok: false, reason: "listening-missing-track-or-source" };
      if (!finite(d.durationMs) || d.durationMs <= 0) return { ok: false, reason: "bad-durationMs" };
      if (!finite(d.playedMs) || d.playedMs < 0) return { ok: false, reason: "bad-playedMs" };
      if (d.playedMs > d.durationMs) return { ok: false, reason: "playedMs-exceeds-duration" };
      if (!Array.isArray(d.styleTags)) return { ok: false, reason: "bad-styleTags" };
      if (d.playbackId !== void 0 && typeof d.playbackId !== "string") return { ok: false, reason: "bad-playbackId" };
      return { ok: true };
    }
    case "share": {
      const d = data.payload;
      if (!d.trackKey || !d.title) return { ok: false, reason: "share-missing-trackKey-or-title" };
      if (!Array.isArray(d.styleTags)) return { ok: false, reason: "bad-styleTags" };
      return { ok: true };
    }
    case "mood": {
      const d = data.payload;
      if (!Array.isArray(d.targetStyles)) return { ok: false, reason: "bad-targetStyles" };
      if (!["work", "rest", "focus", "relax", "commute", "other"].includes(d.scene)) return { ok: false, reason: "bad-scene" };
      if (d.session) {
        const s = d.session;
        if (!finite(s.startedAt) || !finite(s.endedAt) || s.endedAt < s.startedAt) return { ok: false, reason: "bad-session-times" };
        if (!finite(s.durationMinutes) || s.durationMinutes < 1 || s.durationMinutes > 600) return { ok: false, reason: "bad-session-duration" };
      }
      return { ok: true };
    }
    case "interaction": {
      const d = data.payload;
      if (!["touch", "stroke", "talk", "play"].includes(d.kind)) return { ok: false, reason: "bad-interaction-kind" };
      return { ok: true };
    }
    case "system": {
      const d = data.payload;
      if (!["preferences-changed", "memory-cleared", "tick", "memory-proposed"].includes(d.kind)) return { ok: false, reason: "bad-system-kind" };
      if (d.kind === "preferences-changed" && !d.preferences) return { ok: false, reason: "missing-preferences" };
      if (d.kind === "memory-proposed" && (!d.entry || !d.entry.id || !Array.isArray(d.entry.evidenceRefs) || d.entry.evidenceRefs.length === 0)) {
        return { ok: false, reason: "bad-memory-entry" };
      }
      return { ok: true };
    }
  }
}

// src/rng.ts
function hashSeed(str2) {
  let h = 1779033703 ^ str2.length;
  for (let i = 0; i < str2.length; i++) {
    h = Math.imul(h ^ str2.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  h = Math.imul(h ^ h >>> 16, 2246822507);
  h = Math.imul(h ^ h >>> 13, 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function petRng(seed, purpose, key = "") {
  return mulberry32(hashSeed(`${seed}:${purpose}:${key}`));
}
function randomSeed() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// src/util.ts
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function saturate(current, k) {
  return clamp01(current + (1 - current) * k);
}
function utcDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
function fnv1a(str2) {
  let h = 2166136261;
  for (let i = 0; i < str2.length; i++) {
    h ^= str2.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function stateHashOf(state) {
  return fnv1a(canonicalJson(state));
}
function deepFreeze(obj) {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

// src/rules.ts
var RULES_VERSION = "0.1.0";
var NUTRITION = {
  listening: {
    ruleId: "R-VALID-001",
    basePoints: 10,
    // 一次完整有效播放的基础营养
    minPlayedMs: 3e4,
    // 极短播放阈值：<30s 零收益（R-VALID-001）
    fullRatio: 0.8,
    // 播放完成度 ≥0.8 记完整喂养
    dailyCap: 60,
    // R-DAYCAP-003：本地播放每日营养封顶（UTC 日）
    repeatFloor: 0.1
    // R-REPEAT-002：同曲当日重复收益谐波递减 1/(1+n)，下限 0.1
  },
  share: { ruleId: "R-SHARE-004", points: 4, dailyCap: 12 },
  // 主动分享：每曲一次，≠播放完成
  mood: { ruleId: "R-MOOD-005", points: 2, dailyCap: 6 },
  // 心境/共鸣时段：主观兴趣，不计播放
  interaction: { ruleId: "R-INTERACT-006", points: 1, dailyCap: 6 }
  // 轻互动：少量营养，不强制签到
};
var GROWTH = {
  hatch: { ruleId: "R-HATCH-010", nutrition: 30, minValidFeeds: 1 },
  traitShift: { ruleId: "R-TRAIT-011", nutrition: 60 },
  // 初生期内首次可见变化（部件解锁）
  juvenile: { ruleId: "R-JUVENILE-012", nutrition: 120, minStyles: 2, minInteractions: 5 }
};
var DORMANCY = { ruleId: "R-DORMANT-020", gapMs: 7 * 24 * 3600 * 1e3, driftKeep: 0.8 };
var PART_CATALOG_DRAFT = [
  "fin-dorsal",
  "veil-tail",
  "crest-glass",
  "gill-lumen",
  "spot-kintsugi",
  "ridge-echo"
];
var MEMORY_CAPS = { sharedListening: 50, discovery: 30 };
var LOCI_PATHS = [
  "body.silhouette",
  "body.elongation",
  "body.appendages",
  "material.glassiness",
  "material.iridescence",
  "material.opacity",
  "texture.veinDensity",
  "texture.patternScale",
  "motion.tempo",
  "motion.fluidity",
  "motion.stillness"
];
function getLocus(g, path2) {
  const [a, b] = path2.split(".");
  return g[a][b];
}
function setLocus(g, path2, value) {
  const [a, b] = path2.split(".");
  g[a][b] = clamp01(value);
}
function seedAlleles(seed) {
  const g = {
    body: { silhouette: 0, elongation: 0, appendages: 0 },
    material: { glassiness: 0, iridescence: 0, opacity: 0 },
    texture: { veinDensity: 0, patternScale: 0 },
    motion: { tempo: 0, fluidity: 0, stillness: 0 }
  };
  for (const path2 of LOCI_PATHS) setLocus(g, path2, petRng(seed, "genome", path2)());
  return g;
}
function genomeTarget(imprint) {
  const f = imprint.features;
  const breadth = imprint.breadth;
  const loyalty = 1 - breadth;
  return {
    body: { silhouette: f.energy, elongation: f.tempo, appendages: breadth },
    material: { glassiness: f.acousticness, iridescence: f.valence, opacity: 1 - f.energy },
    texture: { veinDensity: loyalty, patternScale: 1 - breadth },
    motion: { tempo: f.tempo, fluidity: f.valence, stillness: f.acousticness }
  };
}
function blendLoci(seedLoci, target, seedWeight) {
  const out = structuredClone(seedLoci);
  for (const path2 of LOCI_PATHS) {
    setLocus(out, path2, seedWeight * getLocus(seedLoci, path2) + (1 - seedWeight) * getLocus(target, path2));
  }
  return out;
}
function blendFeatures(current, weight, incoming, w) {
  const total = weight + w;
  if (total <= 0) return { features: current, weight };
  const mix = (a, b) => (a * weight + b * w) / total;
  return {
    features: {
      energy: mix(current.energy, incoming.energy),
      valence: mix(current.valence, incoming.valence),
      tempo: mix(current.tempo, incoming.tempo),
      acousticness: mix(current.acousticness, incoming.acousticness)
    },
    weight: total
  };
}
var NEUTRAL_FEATURES = { energy: 0.5, valence: 0.5, tempo: 0.5, acousticness: 0.5 };
var STYLE_FEATURE_PRIORS = {
  punk: { energy: 0.9, valence: 0.6, tempo: 0.85, acousticness: 0.1 },
  rock: { energy: 0.8, valence: 0.55, tempo: 0.7, acousticness: 0.2 },
  metal: { energy: 0.95, valence: 0.35, tempo: 0.9, acousticness: 0.05 },
  pop: { energy: 0.6, valence: 0.7, tempo: 0.6, acousticness: 0.3 },
  piano: { energy: 0.2, valence: 0.5, tempo: 0.35, acousticness: 0.95 },
  classical: { energy: 0.25, valence: 0.5, tempo: 0.4, acousticness: 0.9 },
  ambient: { energy: 0.15, valence: 0.4, tempo: 0.2, acousticness: 0.7 },
  electronic: { energy: 0.75, valence: 0.6, tempo: 0.8, acousticness: 0.1 },
  jazz: { energy: 0.45, valence: 0.6, tempo: 0.5, acousticness: 0.6 },
  folk: { energy: 0.4, valence: 0.6, tempo: 0.5, acousticness: 0.8 },
  hiphop: { energy: 0.7, valence: 0.6, tempo: 0.75, acousticness: 0.15 },
  lofi: { energy: 0.3, valence: 0.5, tempo: 0.4, acousticness: 0.5 }
};
function styleFeatures(tag) {
  const known = STYLE_FEATURE_PRIORS[tag.toLowerCase()];
  if (known) return known;
  const h = hashSeed(`style:${tag.toLowerCase()}`);
  const r = petRng(h.toString(16), "style-prior", tag);
  return { energy: r(), valence: r(), tempo: r(), acousticness: r() };
}
function blendStylePriors(tags) {
  if (tags.length === 0) return { ...NEUTRAL_FEATURES };
  const acc = { energy: 0, valence: 0, tempo: 0, acousticness: 0 };
  for (const t of tags) {
    const f = styleFeatures(t);
    acc.energy += f.energy;
    acc.valence += f.valence;
    acc.tempo += f.tempo;
    acc.acousticness += f.acousticness;
  }
  const n = tags.length;
  return { energy: acc.energy / n, valence: acc.valence / n, tempo: acc.tempo / n, acousticness: acc.acousticness / n };
}
var EXTRACTED_BY_WEIGHT = {
  tags: 1,
  rules: 0.8,
  filename: 0.5,
  musicbrainz: 1,
  ai: 0.3
};

// src/eventlog.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
function safePetId(petId) {
  if (!petId || petId.includes("/") || petId.includes("\\") || petId.includes("..")) {
    throw new Error(`unsafe petId: ${petId}`);
  }
  return petId;
}
var InMemoryLogStore = class {
  logs = /* @__PURE__ */ new Map();
  records = /* @__PURE__ */ new Map();
  async append(petId, event) {
    const log = this.logs.get(petId) ?? [];
    log.push(structuredClone(event));
    this.logs.set(petId, log);
  }
  async readAll(petId) {
    return structuredClone(this.logs.get(petId) ?? []);
  }
  async saveSeedRecord(record) {
    this.records.set(record.petId, structuredClone(record));
  }
  async loadSeedRecord(petId) {
    const r = this.records.get(petId);
    return r ? structuredClone(r) : null;
  }
};
var JsonlLogStore = class {
  dir;
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  petDir(petId) {
    const d = join(this.dir, safePetId(petId));
    mkdirSync(d, { recursive: true });
    return d;
  }
  async append(petId, event) {
    appendFileSync(join(this.petDir(petId), "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
  }
  async readAll(petId) {
    const f = join(this.petDir(petId), "events.jsonl");
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  }
  async saveSeedRecord(record) {
    writeFileSync(join(this.petDir(record.petId), "pet.json"), JSON.stringify(record, null, 2), "utf8");
  }
  async loadSeedRecord(petId) {
    const f = join(this.petDir(petId), "pet.json");
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, "utf8"));
  }
};

// src/engine.ts
function defaultPreferences(petId, updatedAt) {
  return {
    petId,
    longTermMemoryEnabled: true,
    proactiveSuggestionsEnabled: false,
    // 默认低频主动性（草案默认值，用户可改）
    changeNotificationsEnabled: true,
    explorationInvitesEnabled: false,
    quietHours: { start: "22:00", end: "08:00" },
    updatedAt,
    schemaVersion: SCHEMA_VERSION
  };
}
function emptyDaily(day) {
  return {
    day,
    nutritionListening: 0,
    nutritionShare: 0,
    nutritionMood: 0,
    nutritionInteraction: 0,
    trackPlays: {},
    moodSessions: 0,
    interactions: 0
  };
}
function createPetState(input) {
  const rulesVersion = input.rulesVersion ?? RULES_VERSION;
  const seedLoci = seedAlleles(input.seed);
  const trait = (name, lo, hi) => lo + (hi - lo) * petRng(input.seed, "personality", name)();
  const baseline = {
    curiosity: trait("curiosity", 0.3, 0.7),
    activity: trait("activity", 0.3, 0.7),
    exploration: trait("exploration", 0.3, 0.7),
    affinity: trait("affinity", 0.3, 0.6)
  };
  return {
    pet: {
      petId: input.petId,
      seed: input.seed,
      schemaVersion: SCHEMA_VERSION,
      rulesVersion,
      createdAt: input.createdAt,
      stage: "egg",
      stageEnteredAt: input.createdAt,
      nutritionTotal: 0
    },
    genome: { petId: input.petId, rulesVersion, ...seedLoci, parts: [], expressedAtSeq: -1 },
    personality: { petId: input.petId, rulesVersion, current: { ...baseline }, baseline },
    imprint: {
      petId: input.petId,
      rulesVersion,
      updatedAtSeq: 0,
      styleWeights: {},
      interestTags: {},
      features: { ...NEUTRAL_FEATURES },
      featureWeight: 0,
      distinctStyles: 0,
      breadth: 0,
      listening: { validPlays: 0, fullPlays: 0, trackedMs: 0, distinctTracks: 0 },
      feeding: { validFeeds: 0, shareCount: 0, moodSessions: 0, interactionCount: 0 },
      nutritionByChannel: {}
    },
    memory: { petId: input.petId, entries: [] },
    preferences: { ...defaultPreferences(input.petId, input.createdAt), ...input.preferences, petId: input.petId },
    discoveries: [],
    growthEvents: [],
    lastSeq: 0,
    lastEventAt: 0,
    lastFeedAt: input.createdAt,
    daily: emptyDaily(""),
    seenEventKeys: {},
    nutritionEventIds: [],
    sharedTrackKeys: {},
    listenedTracks: {},
    lastGrowthNutritionIdx: 0
  };
}
function addNutrition(s, ev, points) {
  if (points <= 0) return;
  s.pet.nutritionTotal += points;
  s.nutritionEventIds.push(ev.eventId);
  s.imprint.feeding.validFeeds += 1;
  const ch = ev.provenance.channel;
  s.imprint.nutritionByChannel[ch] = (s.imprint.nutritionByChannel[ch] ?? 0) + points;
  if (ch !== "interaction") s.lastFeedAt = ev.occurredAt;
}
function addStyleWeight(s, ev, tag, weight) {
  const before = s.imprint.styleWeights[tag] ?? 0;
  if (before <= 0 && weight > 0) {
    s.discoveries.push({
      discoveryId: `de-${s.pet.petId}-${ev.seq}-${tag}`,
      petId: s.pet.petId,
      kind: "new-style",
      tag,
      evidenceEventIds: [ev.eventId],
      atSeq: ev.seq,
      occurredAt: ev.occurredAt,
      rulesVersion: s.pet.rulesVersion
    });
    s.personality.current.curiosity = saturate(s.personality.current.curiosity, 0.05);
    s.personality.current.exploration = saturate(s.personality.current.exploration, 0.03);
    addMemory(s, "discovery", `\u53D1\u73B0\u4E86\u65B0\u66F2\u98CE\u300C${tag}\u300D`, [`de-${s.pet.petId}-${ev.seq}-${tag}`], "engine", "original-builtin", ev.occurredAt, ev.seq);
    s.imprint.styleWeights[tag] = weight;
    return true;
  }
  s.imprint.styleWeights[tag] = before + weight;
  return false;
}
function refreshImprintDerived(s, seq) {
  const styles = Object.keys(s.imprint.styleWeights).filter((k) => s.imprint.styleWeights[k] > 0);
  s.imprint.distinctStyles = styles.length;
  s.imprint.breadth = styles.length / (styles.length + 3);
  s.imprint.updatedAtSeq = seq;
}
function countKind(s, kind) {
  return s.memory.entries.filter((m) => m.kind === kind && !m.tombstoned).length;
}
function addMemory(s, kind, summary, evidenceRefs, sourceCredibility, authorizationScope, atMs, seq) {
  if (!s.preferences.longTermMemoryEnabled) return;
  if (kind === "shared-listening" && countKind(s, "shared-listening") >= MEMORY_CAPS.sharedListening) return;
  if (kind === "discovery" && countKind(s, "discovery") >= MEMORY_CAPS.discovery) return;
  s.memory.entries.push({
    id: `mem-${s.pet.petId}-${seq}-${kind}-${s.memory.entries.length}`,
    petId: s.pet.petId,
    kind,
    summary: summary.slice(0, 60),
    evidenceRefs,
    sourceCredibility,
    authorizationScope,
    createdAt: new Date(atMs).toISOString(),
    createdAtSeq: seq,
    rulesVersion: s.pet.rulesVersion,
    tombstoned: false
  });
}
function listeningNutrition(daily, d) {
  const L = NUTRITION.listening;
  const validPlay = d.playedMs >= L.minPlayedMs;
  const ratio = d.playedMs / d.durationMs;
  const fullPlay = validPlay && ratio >= L.fullRatio;
  if (!validPlay) return { points: 0, validPlay, fullPlay, completion: 0, repeatFactor: 0 };
  const completion = fullPlay ? 1 : ratio;
  const n = daily.trackPlays[d.trackId] ?? 0;
  const repeatFactor = Math.max(1 / (1 + n), L.repeatFloor);
  const raw = L.basePoints * completion * repeatFactor;
  const room = Math.max(0, L.dailyCap - daily.nutritionListening);
  return { points: Math.min(raw, room), validPlay, fullPlay, completion, repeatFactor };
}
function foldEvent(s, ev) {
  const day = utcDay(ev.occurredAt);
  if (s.daily.day !== day) s.daily = emptyDaily(day);
  if (s.lastEventAt > 0 && ev.occurredAt - s.lastEventAt > DORMANCY.gapMs) {
    const c = s.personality.current;
    const b = s.personality.baseline;
    for (const k of ["curiosity", "activity", "exploration", "affinity"]) {
      c[k] = b[k] + (c[k] - b[k]) * DORMANCY.driftKeep;
    }
  }
  const data = ev.data;
  switch (data.type) {
    case "listening": {
      const d = data.payload;
      const nut = listeningNutrition(s.daily, d);
      if (nut.validPlay) {
        s.daily.trackPlays[d.trackId] = (s.daily.trackPlays[d.trackId] ?? 0) + 1;
        s.imprint.listening.validPlays += 1;
        s.imprint.listening.trackedMs += d.playedMs;
        if (nut.fullPlay) s.imprint.listening.fullPlays += 1;
        if (!s.listenedTracks[d.trackId]) {
          s.listenedTracks[d.trackId] = 1;
          s.imprint.listening.distinctTracks += 1;
          addMemory(s, "shared-listening", `\u4E00\u8D77\u542C\u4E86\u300A${d.title ?? d.trackId}\u300B\uFF08\u672C\u5730\u64AD\u653E\uFF09`, [ev.eventId], "reliable-play", ev.provenance.license.kind, ev.occurredAt, ev.seq);
        }
      }
      s.daily.nutritionListening += nut.points;
      addNutrition(s, ev, nut.points);
      if (nut.points > 0) {
        const metaWeight = nut.points * EXTRACTED_BY_WEIGHT[d.extractedBy ?? "tags"];
        const incoming = { ...blendStylePriors(d.styleTags), ...d.features };
        const blended = blendFeatures(s.imprint.features, s.imprint.featureWeight, incoming, metaWeight);
        s.imprint.features = blended.features;
        s.imprint.featureWeight = blended.weight;
        for (const tag of d.styleTags) addStyleWeight(s, ev, tag, metaWeight);
        s.personality.current.activity = saturate(s.personality.current.activity, 0.02 * nut.completion);
      }
      break;
    }
    case "share": {
      const d = data.payload;
      s.imprint.feeding.shareCount += 1;
      let points = 0;
      if (!s.sharedTrackKeys[d.trackKey]) {
        s.sharedTrackKeys[d.trackKey] = 1;
        const room = Math.max(0, NUTRITION.share.dailyCap - s.daily.nutritionShare);
        points = Math.min(NUTRITION.share.points, room);
        s.daily.nutritionShare += points;
        addNutrition(s, ev, points);
        const metaWeight = points * 0.5 * EXTRACTED_BY_WEIGHT[d.extractedBy ?? "tags"];
        for (const tag of d.styleTags) addStyleWeight(s, ev, tag, metaWeight);
        s.personality.current.curiosity = saturate(s.personality.current.curiosity, 0.01);
      }
      break;
    }
    case "mood": {
      const d = data.payload;
      s.imprint.feeding.moodSessions += 1;
      s.daily.moodSessions += 1;
      const room = Math.max(0, NUTRITION.mood.dailyCap - s.daily.nutritionMood);
      const points = Math.min(NUTRITION.mood.points, room);
      s.daily.nutritionMood += points;
      addNutrition(s, ev, points);
      for (const tag of d.targetStyles) {
        s.imprint.interestTags[tag] = (s.imprint.interestTags[tag] ?? 0) + 1;
      }
      s.personality.current.curiosity = saturate(s.personality.current.curiosity, 0.01);
      s.personality.current.affinity = saturate(s.personality.current.affinity, 0.01);
      break;
    }
    case "interaction": {
      s.imprint.feeding.interactionCount += 1;
      s.daily.interactions += 1;
      const room = Math.max(0, NUTRITION.interaction.dailyCap - s.daily.nutritionInteraction);
      const points = Math.min(NUTRITION.interaction.points, room);
      s.daily.nutritionInteraction += points;
      addNutrition(s, ev, points);
      s.personality.current.affinity = saturate(s.personality.current.affinity, 0.03);
      s.personality.current.activity = saturate(s.personality.current.activity, 0.01);
      break;
    }
    case "system": {
      const d = data.payload;
      if (d.kind === "preferences-changed" && d.preferences) {
        s.preferences = { ...d.preferences, petId: s.pet.petId };
      } else if (d.kind === "memory-cleared") {
        for (const m of s.memory.entries) m.tombstoned = true;
      } else if (d.kind === "memory-proposed" && d.entry) {
        s.memory.entries.push(structuredClone(d.entry));
      }
      break;
    }
  }
  if (data.type !== "system") refreshImprintDerived(s, ev.seq);
  const growth = checkGrowth(s, ev);
  s.lastEventAt = ev.occurredAt;
  return growth;
}
function growthDeltasGenome(before, after) {
  const deltas = [];
  for (const path2 of LOCI_PATHS) {
    const b = getLocus(before, path2);
    const a = getLocus(after, path2);
    if (Math.abs(a - b) > 1e-9) deltas.push({ target: `genome.${path2}`, before: b, after: a });
  }
  return deltas;
}
function unlockPart(s, ev, growthEventId) {
  const unlocked = new Set(s.genome.parts.map((p) => p.partId));
  const r = petRng(s.pet.seed, "part", s.genome.parts.length);
  let idx = Math.floor(r() * PART_CATALOG_DRAFT.length);
  while (unlocked.has(PART_CATALOG_DRAFT[idx])) idx = (idx + 1) % PART_CATALOG_DRAFT.length;
  const partId = PART_CATALOG_DRAFT[idx];
  const target = genomeTarget(s.imprint);
  const allele = clamp01(0.5 * petRng(s.pet.seed, "allele", partId)() + 0.5 * target.motion.fluidity);
  s.genome.parts.push({ partId, allele, unlockedByGrowthEventId: growthEventId });
  return { partId, allele };
}
function makeGrowth(s, ev, kind, ruleId, fromStage, toStage, deltas, summary, contributing) {
  const ge = {
    growthEventId: `ge-${s.pet.petId}-${ev.seq}-${kind}`,
    petId: s.pet.petId,
    kind,
    ruleId,
    rulesVersion: s.pet.rulesVersion,
    atSeq: ev.seq,
    occurredAt: ev.occurredAt,
    fromStage,
    toStage,
    contributingEventIds: contributing,
    deltas,
    summary
  };
  s.growthEvents.push(ge);
  s.lastGrowthNutritionIdx = s.nutritionEventIds.length;
  addMemory(s, kind === "hatch" ? "hatch" : "evolution", summary, [ge.growthEventId], "engine", "original-builtin", ev.occurredAt, ev.seq);
  return ge;
}
function checkGrowth(s, ev) {
  const out = [];
  const nutrition = s.pet.nutritionTotal;
  if (s.pet.stage === "egg" && nutrition >= GROWTH.hatch.nutrition && s.imprint.feeding.validFeeds >= GROWTH.hatch.minValidFeeds) {
    const before = structuredClone(s.genome);
    const expressed = blendLoci(seedAlleles(s.pet.seed), genomeTarget(s.imprint), 0.5);
    Object.assign(s.genome, expressed);
    s.genome.expressedAtSeq = ev.seq;
    s.pet.stage = "newborn";
    s.pet.stageEnteredAt = ev.occurredAt;
    const deltas = [
      { target: "stage", before: "egg", after: "newborn" },
      ...growthDeltasGenome(before, s.genome)
    ];
    out.push(makeGrowth(s, ev, "hatch", GROWTH.hatch.ruleId, "egg", "newborn", deltas, "\u5171\u9E23\u5375\u5B75\u5316\uFF0C\u8FDB\u5165\u521D\u751F\u671F", [...s.nutritionEventIds]));
  }
  if (s.pet.stage === "newborn" && nutrition >= GROWTH.traitShift.nutrition && !s.growthEvents.some((g) => g.kind === "trait-shift")) {
    const geId = `ge-${s.pet.petId}-${ev.seq}-trait-shift`;
    const before = structuredClone(s.genome);
    const target = genomeTarget(s.imprint);
    for (const path2 of LOCI_PATHS) setLocus(s.genome, path2, getLocus(s.genome, path2) + 0.2 * (getLocus(target, path2) - getLocus(s.genome, path2)));
    const { partId, allele } = unlockPart(s, ev, geId);
    const deltas = [
      { target: `genome.parts.${partId}`, before: "absent", after: allele },
      ...growthDeltasGenome(before, s.genome)
    ];
    out.push(makeGrowth(s, ev, "trait-shift", GROWTH.traitShift.ruleId, "newborn", "newborn", deltas, `\u9996\u6B21\u53EF\u89C1\u53D8\u5316\uFF1A\u89E3\u9501\u90E8\u4EF6 ${partId}`, s.nutritionEventIds.slice(s.lastGrowthNutritionIdx)));
  }
  if (s.pet.stage === "newborn" && nutrition >= GROWTH.juvenile.nutrition && s.imprint.distinctStyles >= GROWTH.juvenile.minStyles && s.imprint.feeding.interactionCount >= GROWTH.juvenile.minInteractions) {
    const geId = `ge-${s.pet.petId}-${ev.seq}-stage-evolution`;
    const before = structuredClone(s.genome);
    const target = genomeTarget(s.imprint);
    for (const path2 of LOCI_PATHS) setLocus(s.genome, path2, getLocus(s.genome, path2) + 0.2 * (getLocus(target, path2) - getLocus(s.genome, path2)));
    const { partId, allele } = unlockPart(s, ev, geId);
    s.pet.stage = "juvenile";
    s.pet.stageEnteredAt = ev.occurredAt;
    const deltas = [
      { target: "stage", before: "newborn", after: "juvenile" },
      { target: `genome.parts.${partId}`, before: "absent", after: allele },
      ...growthDeltasGenome(before, s.genome)
    ];
    out.push(makeGrowth(s, ev, "stage-evolution", GROWTH.juvenile.ruleId, "newborn", "juvenile", deltas, "\u504F\u597D\u5206\u5316\uFF0C\u8FDB\u5165\u5E7C\u751F\u671F", s.nutritionEventIds.slice(s.lastGrowthNutritionIdx)));
  }
  return out;
}
var LifeEngine = class {
  rulesVersion;
  constructor(rulesVersion = RULES_VERSION) {
    this.rulesVersion = rulesVersion;
  }
  createPet(input) {
    return createPetState({ ...input, rulesVersion: this.rulesVersion });
  }
  seedRecordOf(state) {
    return {
      petId: state.pet.petId,
      seed: state.pet.seed,
      rulesVersion: state.pet.rulesVersion,
      createdAt: state.pet.createdAt,
      preferences: structuredClone(state.preferences),
      schemaVersion: SCHEMA_VERSION
    };
  }
  /** 受控事件入口：校验 → 去重 → append → fold。拒收/重复不影响状态。 */
  ingest(state, input) {
    const v = validateInput(input);
    if (!v.ok) return { state, growth: [], rejected: v.reason };
    if (input.petId !== null && input.petId !== state.pet.petId) return { state, growth: [], rejected: "petId-mismatch" };
    const key = `${input.provenance.channel}:${input.eventId}`;
    if (state.seenEventKeys[key]) return { state, growth: [], duplicate: true };
    const pbKey = input.data.type === "listening" && input.data.payload.playbackId ? `playback:${input.data.payload.playbackId}` : void 0;
    if (pbKey && state.seenEventKeys[pbKey]) return { state, growth: [], duplicate: true };
    const s = structuredClone(state);
    const ev = {
      eventId: input.eventId,
      seq: s.lastSeq + 1,
      petId: state.pet.petId,
      type: input.data.type,
      occurredAt: input.occurredAt,
      ingestedAt: input.ingestedAt,
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: this.rulesVersion,
      producer: "input.v0",
      provenance: input.provenance,
      data: input.data
    };
    s.seenEventKeys[key] = 1;
    if (pbKey) s.seenEventKeys[pbKey] = 1;
    s.lastSeq = ev.seq;
    const growth = foldEvent(s, ev);
    return { state: s, event: ev, growth };
  }
  /** 回放：种子记录 + 事件日志 → 完整状态（重启保留/跨设备迁移的重建路径） */
  replay(record, log) {
    if (record.rulesVersion !== this.rulesVersion) {
      throw new Error(`rules-version-mismatch: record=${record.rulesVersion} engine=${this.rulesVersion}`);
    }
    const s = createPetState({
      petId: record.petId,
      seed: record.seed,
      createdAt: record.createdAt,
      rulesVersion: record.rulesVersion,
      preferences: record.preferences
    });
    for (const ev of log) {
      if (ev.petId !== record.petId) throw new Error(`replay-petId-mismatch: ${ev.eventId}`);
      if (ev.rulesVersion !== record.rulesVersion) throw new Error(`replay-rules-version-mismatch: ${ev.eventId}`);
      const key = `${ev.provenance.channel}:${ev.eventId}`;
      if (s.seenEventKeys[key]) continue;
      s.seenEventKeys[key] = 1;
      if (ev.data.type === "listening" && ev.data.payload.playbackId) s.seenEventKeys[`playback:${ev.data.payload.playbackId}`] = 1;
      s.lastSeq = ev.seq;
      foldEvent(s, ev);
    }
    return s;
  }
  /** 只读快照：深冻结。知微/绘灵唯一可见接口。 */
  snapshot(state) {
    const snap = {
      pet: structuredClone(state.pet),
      genome: structuredClone(state.genome),
      personality: structuredClone(state.personality),
      imprint: structuredClone(state.imprint),
      memory: { petId: state.pet.petId, entries: structuredClone(state.memory.entries.filter((m) => !m.tombstoned)) },
      preferences: structuredClone(state.preferences),
      discoveries: structuredClone(state.discoveries),
      growthEvents: structuredClone(state.growthEvents),
      hatchProgress: state.pet.stage === "egg" ? clamp01(state.pet.nutritionTotal / GROWTH.hatch.nutrition) : 1,
      lastEventSeq: state.lastSeq,
      lastEventAt: state.lastEventAt,
      lastFeedAt: state.lastFeedAt,
      rulesVersion: state.pet.rulesVersion,
      schemaVersion: SCHEMA_VERSION,
      stateHash: stateHashOf(state),
      growthHash: stateHashOf({
        nutritionTotal: state.pet.nutritionTotal,
        stage: state.pet.stage,
        stageEnteredAt: state.pet.stageEnteredAt,
        genome: state.genome,
        imprint: state.imprint,
        growthEvents: state.growthEvents,
        discoveries: state.discoveries
      })
    };
    return deepFreeze(snap);
  }
  /** 可解释：关键进化由哪些可用事件促成 */
  explain(state, log, growthEventId) {
    const growth = state.growthEvents.find((g) => g.growthEventId === growthEventId);
    if (!growth) return void 0;
    const byId = new Map(log.map((e) => [e.eventId, e]));
    const events = growth.contributingEventIds.map((id) => byId.get(id)).filter((e) => !!e);
    return { growth, events };
  }
  /**
   * 知微记忆写入的唯一通道：证据校验（无据不写、种类与证据匹配、关闭记忆不写）。
   * AI 只能提案，引擎验证并落库；summary 必须是 ≤60 字事实句。
   */
  proposeMemory(state, log, proposal) {
    if (!state.preferences.longTermMemoryEnabled) return { state, rejected: "memory-disabled" };
    if (!proposal.summary || proposal.summary.length > 60) return { state, rejected: "summary-missing-or-too-long" };
    if (!Array.isArray(proposal.evidenceRefs) || proposal.evidenceRefs.length === 0) return { state, rejected: "evidenceRefs-empty" };
    const logById = new Map(log.map((e) => [e.eventId, e]));
    const growthById = new Map(state.growthEvents.map((g) => [g.growthEventId, g]));
    const discoveryById = new Map(state.discoveries.map((d) => [d.discoveryId, d]));
    const refs = proposal.evidenceRefs;
    if (refs.some((r2) => !logById.has(r2) && !growthById.has(r2) && !discoveryById.has(r2))) {
      return { state, rejected: "evidence-not-found" };
    }
    const hasListening = refs.some((r2) => logById.get(r2)?.type === "listening" && logById.get(r2)?.provenance.credibility === "verified");
    const hasType = (t) => refs.some((r2) => logById.get(r2)?.type === t);
    const hasGrowth = (kinds) => refs.some((r2) => {
      const g = growthById.get(r2);
      return !!g && kinds.includes(g.kind);
    });
    const okByKind = {
      "shared-listening": hasListening,
      share: hasType("share"),
      "mood-note": hasType("mood"),
      interaction: hasType("interaction"),
      hatch: hasGrowth(["hatch"]),
      evolution: hasGrowth(["stage-evolution", "trait-shift", "part-unlock"]),
      discovery: refs.some((r2) => discoveryById.has(r2))
    };
    if (!okByKind[proposal.kind]) return { state, rejected: "kind-evidence-mismatch" };
    const primary = logById.get(refs[0]) ?? growthById.get(refs[0]) ?? discoveryById.get(refs[0]);
    const cred = "provenance" in primary ? primary.provenance.channel === "local-player" ? "reliable-play" : primary.provenance.channel === "user-share" ? "user-share" : primary.provenance.channel === "mood-session" ? "user-mood" : primary.provenance.channel === "interaction" ? "user-interaction" : "engine" : "engine";
    const scope = "provenance" in primary ? primary.provenance.license.kind : "original-builtin";
    const entry = {
      id: `mem-${state.pet.petId}-${state.lastSeq}-${proposal.kind}-${state.memory.entries.length}`,
      petId: state.pet.petId,
      kind: proposal.kind,
      summary: proposal.summary,
      evidenceRefs: refs,
      sourceCredibility: cred,
      authorizationScope: scope,
      createdAt: new Date(primary.occurredAt).toISOString(),
      createdAtSeq: state.lastSeq,
      rulesVersion: state.pet.rulesVersion,
      tombstoned: false
    };
    const at = state.lastEventAt;
    const input = {
      eventId: `memory-proposed:${entry.id}`,
      petId: state.pet.petId,
      occurredAt: at,
      ingestedAt: at,
      provenance: {
        channel: "system",
        sourceId: "engine",
        credibility: "system",
        confidence: 1,
        license: { kind: "original-builtin", commercialUse: false, redistribution: false }
      },
      data: { type: "system", payload: { kind: "memory-proposed", entry } }
    };
    const r = this.ingest(state, input);
    if (r.rejected) return { state, rejected: r.rejected };
    return { state: r.state, entry, event: r.event };
  }
  /** 完整生命导出（免费核心能力；重建以 seedRecord + eventLog 回放为准） */
  exportBundle(state, log, sources, exportedAt) {
    return {
      format: "echo-life-export",
      formatVersion: 1,
      exportedAt,
      seedRecord: this.seedRecordOf(state),
      sources: structuredClone(sources),
      eventLog: structuredClone(log),
      snapshot: this.snapshot(state)
    };
  }
};

// src/snapshot.ts
function projectPersonaSnapshot(snap) {
  const total = Object.values(snap.imprint.styleWeights).reduce((a, b) => a + b, 0);
  const styleProfile = Object.entries(snap.imprint.styleWeights).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([style, w]) => ({ style, weight: total > 0 ? w / total : 0 }));
  const latest = snap.growthEvents[snap.growthEvents.length - 1];
  const partDelta = latest?.deltas.find((d) => d.target.startsWith("genome.parts."));
  return {
    petId: snap.pet.petId,
    seed: hashSeed(snap.pet.seed),
    rulesVersion: snap.rulesVersion,
    stage: snap.pet.stage,
    personality: { ...snap.personality.current },
    styleProfile,
    latestGrowthEvent: latest ? {
      id: latest.growthEventId,
      at: new Date(latest.occurredAt).toISOString(),
      causes: [...latest.contributingEventIds],
      partOrBehavior: partDelta ? partDelta.target.replace("genome.parts.", "") : latest.summary
    } : void 0,
    memoryEnabled: snap.preferences.longTermMemoryEnabled,
    quietHours: { ...snap.preferences.quietHours },
    proactiveToggles: {
      recommend: snap.preferences.proactiveSuggestionsEnabled,
      showChange: snap.preferences.changeNotificationsEnabled,
      exploreInvite: snap.preferences.explorationInvitesEnabled
    }
  };
}

// src/render.ts
var RENDER_CONTRACT = "echo.snapshot/v0";
var SPECIES_ID = "pearl-ling";
var DORMANT_RENDER_GAP_MS = 3 * 24 * 60 * 60 * 1e3;
var SLOT_IDS = ["body", "fins", "texture", "eyes", "aura", "mark"];
var SLOT_CATALOG = {
  body: ["pearl-ling"],
  fins: ["veil", "ribbon", "sail"],
  texture: ["pearl-matte", "frosted", "irid-film"],
  eyes: ["dot", "soft-dot"],
  aura: ["none", "warm-halo", "bubbles"],
  mark: ["none", "kintsugi-line", "orbit-ring"]
};
var PART_SLOT_MAP = {
  "fin-dorsal": { slot: "fins", partId: "sail" },
  // 背鳍加大 → 帆
  "veil-tail": { slot: "fins", partId: "veil" },
  // 纱幕尾 → 纱幕
  "crest-glass": { slot: "texture", partId: "irid-film" },
  // 玻璃冠 → 虹彩膜
  "gill-lumen": { slot: "aura", partId: "warm-halo" },
  // 发光鳃 → 暖金光晕
  "spot-kintsugi": { slot: "mark", partId: "kintsugi-line" },
  // 金缮斑 → 金缮线
  "ridge-echo": { slot: "mark", partId: "orbit-ring" }
  // 脊纹回声 → 轨道环
};
function fallbackPartSlot(partId) {
  const slot = SLOT_IDS[hashSeed(partId) % SLOT_IDS.length];
  const catalog = SLOT_CATALOG[slot];
  return { slot, partId: catalog[hashSeed(`${partId}:part`) % catalog.length] };
}
function slotPartId(slot, g, stage, breadth) {
  switch (slot) {
    case "body":
      return SPECIES_ID;
    case "fins":
      return g.body.appendages < 1 / 3 ? "ribbon" : g.body.appendages < 2 / 3 ? "veil" : "sail";
    case "texture":
      return g.material.iridescence >= 0.66 ? "irid-film" : g.texture.veinDensity >= 0.5 ? "frosted" : "pearl-matte";
    case "eyes":
      return g.motion.stillness >= 0.5 ? "soft-dot" : "dot";
    case "aura":
      return g.material.iridescence < 0.34 ? "none" : g.material.iridescence < 0.67 ? "warm-halo" : "bubbles";
    case "mark":
      return stage === "egg" ? "none" : stage === "newborn" ? "kintsugi-line" : breadth >= 0.5 ? "orbit-ring" : "kintsugi-line";
  }
}
function appearanceOf(g, stage, seed, breadth) {
  const parts = {};
  for (const slot of SLOT_IDS) {
    parts[slot] = { partId: slotPartId(slot, g, stage, breadth), seed: hashSeed(`${seed}:${slot}`) };
  }
  for (const p of g.parts) {
    const mapped = PART_SLOT_MAP[p.partId] ?? fallbackPartSlot(p.partId);
    const slot = mapped.slot;
    const catalog = SLOT_CATALOG[slot];
    const current = parts[slot].partId;
    let target = mapped.partId;
    if (target === current && catalog.length > 1) {
      target = catalog[(catalog.indexOf(current) + 1) % catalog.length];
    }
    parts[slot] = { partId: target, seed: hashSeed(`${seed}:${slot}:${p.partId}:${p.allele.toFixed(4)}`) };
  }
  return { speciesId: SPECIES_ID, parts };
}
var LOCUS_SLOTS = {
  "genome.body.silhouette": ["body"],
  "genome.body.elongation": ["body"],
  "genome.body.appendages": ["fins"],
  "genome.material.glassiness": ["texture"],
  "genome.material.iridescence": ["texture", "aura"],
  "genome.material.opacity": ["eyes"],
  "genome.texture.veinDensity": ["texture"],
  "genome.texture.patternScale": ["mark"],
  "genome.motion.tempo": ["fins"],
  "genome.motion.fluidity": ["fins", "eyes"],
  "genome.motion.stillness": ["eyes"]
};
function changedSlotsOf(ge) {
  const set = /* @__PURE__ */ new Set();
  if (ge.fromStage !== ge.toStage) set.add("mark");
  for (const d of ge.deltas) {
    if (d.target.startsWith("genome.parts.")) {
      const pid = d.target.slice("genome.parts.".length);
      const mapped = PART_SLOT_MAP[pid] ?? fallbackPartSlot(pid);
      set.add(mapped.slot);
      set.add("mark");
      continue;
    }
    for (const s of LOCUS_SLOTS[d.target] ?? []) set.add(s);
  }
  return SLOT_IDS.filter((s) => set.has(s));
}
function presentationOf(snap) {
  const ge = snap.growthEvents[snap.growthEvents.length - 1];
  if (!ge) return null;
  if (ge.kind === "hatch") return { kind: "hatch", eventId: ge.growthEventId };
  return { kind: "evolve", eventId: ge.growthEventId, changedSlots: changedSlotsOf(ge) };
}
function projectRenderSnapshot(snap, opts = {}) {
  const dormant = snap.pet.stage !== "egg" && opts.now !== void 0 && opts.now - snap.lastFeedAt >= DORMANT_RENDER_GAP_MS;
  return {
    contract: RENDER_CONTRACT,
    petId: snap.pet.petId,
    seed: hashSeed(snap.pet.seed),
    stage: snap.pet.stage,
    appearance: appearanceOf(snap.genome, snap.pet.stage, snap.pet.seed, snap.imprint.breadth),
    personality: { ...snap.personality.current },
    dormant,
    ambient: opts.ambient,
    presentation: opts.presentation !== void 0 ? opts.presentation : presentationOf(snap)
  };
}

// src/wire.ts
var WIRE_AUTHORIZATION_MAP = {
  user_imported_local: "user-owned-local",
  user_shared_metadata: "user-provided-metadata",
  user_mood_input: "user-mood-input",
  public_metadata: "user-provided-metadata",
  public_domain_audio: "user-owned-local"
};
var WIRE_CHANNEL = {
  local_file: "local-player",
  user_share: "user-share",
  mood: "mood-session"
};
var finite2 = (x) => typeof x === "number" && Number.isFinite(x);
var str = (x) => typeof x === "string" ? x : "";
var strArray = (x) => Array.isArray(x) ? x.filter((v) => typeof v === "string") : [];
function genreTags(features) {
  const genre = features?.genre;
  if (!genre || typeof genre !== "object") return [];
  return Object.entries(genre).filter(([, w]) => finite2(w) && w > 0).map(([k]) => k);
}
function wireFeatures(features) {
  const f = features ?? {};
  const out = {};
  if (finite2(f.energy)) out.energy = Math.min(1, Math.max(0, f.energy));
  if (finite2(f.valence)) out.valence = Math.min(1, Math.max(0, f.valence));
  if (finite2(f.tempo)) out.tempo = f.tempo > 1 ? Math.min(1, Math.max(0, (f.tempo - 60) / 120)) : Math.min(1, Math.max(0, f.tempo));
  return out;
}
function extractedByOf(imprintFeatures) {
  const e = imprintFeatures?.extractedBy;
  return typeof e === "string" && ["tags", "filename", "rules", "musicbrainz", "ai"].includes(e) ? e : void 0;
}
function fromWireEvent(wire, bindPetId) {
  if (!wire || typeof wire !== "object") return { ok: false, reason: "wire-not-object" };
  if (wire.producer !== "input.v0") return { ok: false, reason: "producer-not-input" };
  if (wire.type === "growth" || wire.type === "discovery") return { ok: false, reason: "engine-only-type" };
  if (wire.ruleVersion !== null && wire.ruleVersion !== void 0) return { ok: false, reason: "input-must-not-claim-ruleVersion" };
  if (!str(wire.id)) return { ok: false, reason: "missing-id" };
  if (!finite2(wire.ts) || wire.ts < 0) return { ok: false, reason: "bad-ts" };
  const p = wire.payload ?? {};
  const isMood = wire.type === "interaction" && p.kind === "mood";
  const channel = wire.type === "listening" ? "local-player" : wire.type === "imprint" ? "user-share" : isMood ? "mood-session" : wire.type === "interaction" ? "interaction" : WIRE_CHANNEL[wire.source?.kind ?? ""] ?? "interaction";
  const licenseKind = WIRE_AUTHORIZATION_MAP[str(wire.authorization)];
  if (!licenseKind) return { ok: false, reason: "unknown-authorization" };
  if (licenseKind === "platform-licensed") return { ok: false, reason: "platform-licensed-forbidden-p0" };
  const credibility = CHANNEL_CREDIBILITY[channel];
  const provenance = {
    channel,
    sourceId: str(wire.source?.sourceId) || (channel === "interaction" ? "user" : "engine"),
    credibility,
    confidence: finite2(wire.credibility) ? Math.min(1, Math.max(0, wire.credibility)) : credibility === "verified" ? 1 : credibility === "attested" ? 0.5 : 0.3,
    license: { kind: licenseKind, commercialUse: false, redistribution: false }
  };
  let data;
  if (wire.type === "listening") {
    const playedSeconds = finite2(p.playedSeconds) ? p.playedSeconds : 0;
    const durationSeconds = finite2(p.durationSeconds) ? p.durationSeconds : null;
    const playedMs = Math.round(playedSeconds * 1e3);
    const durationMs = durationSeconds !== null && durationSeconds > 0 ? Math.round(durationSeconds * 1e3) : Math.max(playedMs, 1);
    const imprintFeatures = p.imprint?.features ?? p.features;
    data = {
      type: "listening",
      payload: {
        trackId: str(p.trackId),
        sourceId: provenance.sourceId,
        playbackId: str(p.playbackId) || void 0,
        title: str(p.title) || void 0,
        artist: str(p.artist) || void 0,
        styleTags: strArray(p.styleTags).length ? strArray(p.styleTags) : genreTags(imprintFeatures),
        features: wireFeatures(imprintFeatures),
        extractedBy: extractedByOf(imprintFeatures),
        durationMs,
        playedMs,
        startedAt: wire.ts,
        endedAt: wire.ts + playedMs
      }
    };
  } else if (wire.type === "imprint") {
    const title = str(p.title);
    const artist = str(p.artist);
    const norm = (s) => s.toLowerCase().trim().replace(/\s+/g, " ");
    const imprintFeatures = p.imprint?.features ?? p.features;
    data = {
      type: "share",
      payload: {
        trackKey: `share:${norm(title)}|${norm(artist)}`,
        title,
        artist: artist || void 0,
        styleTags: strArray(p.styleTags).length ? strArray(p.styleTags) : genreTags(imprintFeatures),
        shareText: str(p.note) || void 0,
        features: wireFeatures(imprintFeatures),
        extractedBy: extractedByOf(imprintFeatures)
      }
    };
  } else if (isMood) {
    const session = p.session;
    const atmosphere = str(p.atmosphere);
    const scene = ["work", "rest", "focus", "relax", "commute", "other"].includes(atmosphere) ? atmosphere : "other";
    data = {
      type: "mood",
      payload: {
        moodText: str(p.text) || void 0,
        targetStyles: strArray(p.genres),
        scene,
        durationMs: session && finite2(session.durationMinutes) ? Math.round(session.durationMinutes * 6e4) : void 0,
        session: session && finite2(session.startedAt) && finite2(session.endedAt) && finite2(session.durationMinutes) ? { startedAt: session.startedAt, endedAt: session.endedAt, durationMinutes: session.durationMinutes } : void 0
      }
    };
  } else if (wire.type === "interaction") {
    const kind = str(p.kind);
    if (!["touch", "stroke", "talk", "play"].includes(kind)) return { ok: false, reason: "bad-interaction-kind" };
    data = { type: "interaction", payload: { kind, text: str(p.text) || void 0 } };
  } else {
    return { ok: false, reason: `unsupported-wire-type:${wire.type}` };
  }
  return {
    ok: true,
    input: {
      eventId: wire.id,
      petId: wire.petId ?? bindPetId,
      // 对齐点⑤
      occurredAt: wire.ts,
      ingestedAt: wire.ts,
      provenance,
      data
    }
  };
}

// src/host.ts
var LifeHost = class {
  engine;
  persistence;
  now;
  logger;
  fixedPetId;
  state = null;
  log = [];
  sysNonce = 0;
  constructor(opts) {
    this.engine = new LifeEngine(opts.rulesVersion ?? RULES_VERSION);
    this.persistence = opts.persistence;
    this.now = opts.now;
    this.logger = opts.logger;
    this.fixedPetId = opts.petId;
  }
  get petId() {
    return this.state?.pet.petId ?? null;
  }
  get rulesVersion() {
    return this.engine.rulesVersion;
  }
  /** 启动：读回种子记录（无则创建灵宠）→ 读密封日志 → replay 重建状态。重启后状态完整保留。 */
  async init() {
    let record = await this.persistence.loadSeedRecord();
    let created = false;
    if (!record) {
      const petId = this.fixedPetId ?? `pet-${randomSeed().slice(0, 12)}`;
      const seed = randomSeed();
      const createdAt = this.now();
      const fresh = this.engine.createPet({ petId, seed, createdAt });
      record = this.engine.seedRecordOf(fresh);
      await this.persistence.saveSeedRecord(record);
      created = true;
    } else if (this.fixedPetId && record.petId !== this.fixedPetId) {
      this.logger?.warn(`life-host: seedRecord petId ${record.petId} != fixed ${this.fixedPetId}; using stored`);
    }
    this.log = await this.persistence.readEvents();
    this.state = this.engine.replay(record, this.log);
    return { petId: record.petId, created, eventCount: this.log.length, snapshot: this.engine.snapshot(this.state) };
  }
  /** 唯一输入入口：纳音 wire 事件 → 适配 → 引擎 ingest → 密封落库 → 返回三投影。 */
  async ingestWire(wire) {
    if (!this.state) return { ok: false, reason: "not-initialized", growth: [] };
    const adapt = fromWireEvent(wire, this.state.pet.petId);
    if (!adapt.ok) return { ok: false, reason: adapt.reason, growth: [] };
    return this.ingestInput(adapt.input);
  }
  async ingestInput(input) {
    if (!this.state) return { ok: false, reason: "not-initialized", growth: [] };
    const r = this.engine.ingest(this.state, input);
    if (r.rejected) return { ok: false, rejected: r.rejected, growth: [] };
    if (r.duplicate) return { ok: true, duplicate: true, growth: [], projections: this.projections() };
    this.state = r.state;
    if (r.event) {
      this.log.push(r.event);
      await this.persistence.appendEvent(r.event);
    }
    return { ok: true, growth: r.growth, projections: this.projections() };
  }
  /** 系统元事件：时间流逝/休眠检测（无营养）。宿主定时或互动前调用。 */
  async tick(at) {
    return this.systemEvent({ kind: "tick" }, at);
  }
  /** 更新偏好（关闭记忆/静音时段/主动开关）；同时刷新种子记录里的 preferences。 */
  async setPreferences(preferences) {
    const r = await this.systemEvent({ kind: "preferences-changed", preferences });
    if (r.ok && this.state) await this.persistence.saveSeedRecord(this.engine.seedRecordOf(this.state));
    return r;
  }
  /** 清除长期记忆（打墓碑，不动日志、成长不倒退）。 */
  async clearMemory() {
    return this.systemEvent({ kind: "memory-cleared" });
  }
  async systemEvent(payload, at) {
    if (!this.state) return { ok: false, reason: "not-initialized", growth: [] };
    const t = at ?? this.now();
    const eventId = `system:${payload.kind}:${this.state.lastSeq + 1}:${this.sysNonce++}`;
    const input = {
      eventId,
      petId: this.state.pet.petId,
      occurredAt: t,
      ingestedAt: t,
      provenance: {
        channel: "system",
        sourceId: "engine",
        credibility: "system",
        confidence: 1,
        license: { kind: "original-builtin", commercialUse: false, redistribution: false }
      },
      data: { type: "system", payload }
    };
    return this.ingestInput(input);
  }
  /** 知微唯一记忆写入通道：引擎证据校验 + 日志 backing（重启可重现）。AI 只提案。 */
  async proposeMemory(proposal) {
    if (!this.state) return { ok: false, rejected: "not-initialized" };
    const r = this.engine.proposeMemory(this.state, this.log, proposal);
    if (r.rejected) return { ok: false, rejected: r.rejected };
    this.state = r.state;
    if (r.event) {
      this.log.push(r.event);
      await this.persistence.appendEvent(r.event);
    }
    return { ok: true, entry: r.entry, projections: this.projections() };
  }
  // ---------- 只读快照（知微/绘灵消费；深冻结，AI 不可改） ----------
  getSnapshot() {
    return this.state ? this.engine.snapshot(this.state) : null;
  }
  getRender(opts = {}) {
    if (!this.state) return null;
    const snap = this.engine.snapshot(this.state);
    return projectRenderSnapshot(snap, {
      now: opts.now ?? this.now(),
      ambient: opts.ambient,
      presentation: opts.presentation
    });
  }
  getPersona() {
    return this.state ? projectPersonaSnapshot(this.engine.snapshot(this.state)) : null;
  }
  /** 可解释：关键进化由哪些可用事件促成。 */
  explain(growthEventId) {
    if (!this.state) return void 0;
    return this.engine.explain(this.state, this.log, growthEventId);
  }
  // ---------- 导出 / 重建 / 清除 ----------
  exportEntities() {
    if (!this.state) return null;
    const snap = this.engine.snapshot(this.state);
    return {
      pet: snap.pet,
      genome: snap.genome,
      personality: snap.personality,
      memories: this.state.memory.entries.filter((m) => !m.tombstoned),
      imprint: snap.imprint,
      preferences: snap.preferences,
      growthEvents: snap.growthEvents,
      discoveries: snap.discoveries
    };
  }
  exportBundle(sources, exportedAt) {
    if (!this.state) return null;
    return this.engine.exportBundle(this.state, this.log, sources, exportedAt ?? this.now());
  }
  /**
   * 跨设备迁移导入（完整生命状态导出的重建侧）：把导出包写进本机持久化 → 回放重建 → 逐字校验。
   * 语义：替换本机当前生命（先 clearAll，再写 seedRecord + 密封日志），一律 seed+eventLog 回放，不直接写实体（W-1）。
   * 密封日志含 system 元事件（偏好/删记忆/知微记忆提案），故偏好、墓碑、知微记忆全部精确重现（Path A）。
   * 校验：rulesVersion 必须匹配；回放 stateHash/growthHash 与导出参考快照比对，返回 match 标志供调用方拒收不一致包。
   */
  async importBundle(bundle) {
    if (!bundle || bundle.format !== "echo-life-export" || bundle.formatVersion !== 1) {
      throw new Error("import-bundle-format: expected echo-life-export v1");
    }
    const record = bundle.seedRecord;
    if (!record?.petId || !record.seed || !Array.isArray(bundle.eventLog) || !bundle.snapshot) {
      throw new Error("import-bundle-incomplete: missing seedRecord/eventLog/snapshot");
    }
    if (record.rulesVersion !== this.engine.rulesVersion) {
      throw new Error(`rules-version-mismatch: bundle=${record.rulesVersion} engine=${this.engine.rulesVersion}`);
    }
    await this.persistence.clearAll();
    await this.persistence.saveSeedRecord(record);
    for (const ev of bundle.eventLog) await this.persistence.appendEvent(ev);
    this.log = structuredClone(bundle.eventLog);
    this.state = this.engine.replay(record, this.log);
    this.sysNonce = 0;
    const snapshot = this.engine.snapshot(this.state);
    return {
      petId: record.petId,
      eventCount: this.log.length,
      snapshot,
      stateHashMatch: snapshot.stateHash === bundle.snapshot.stateHash,
      growthHashMatch: snapshot.growthHash === bundle.snapshot.growthHash
    };
  }
  /** 从持久化重新回放（不创建新灵宠）；用于校验/热重建。 */
  async rebuild() {
    const record = await this.persistence.loadSeedRecord();
    if (!record) throw new Error("life-host: no seed record to rebuild");
    this.log = await this.persistence.readEvents();
    this.state = this.engine.replay(record, this.log);
    return { eventCount: this.log.length, snapshot: this.engine.snapshot(this.state) };
  }
  /** 清除全部生命数据（宿主 DELETE /api/data confirm 后调用）。 */
  async clear() {
    await this.persistence.clearAll();
    this.state = null;
    this.log = [];
    this.sysNonce = 0;
  }
  projections() {
    const snapshot = this.engine.snapshot(this.state);
    return {
      snapshot,
      render: projectRenderSnapshot(snapshot, { now: this.now() }),
      persona: projectPersonaSnapshot(snapshot)
    };
  }
};
function createLifeHost(opts) {
  return new LifeHost(opts);
}

// src/host-fs.ts
import * as fs from "node:fs";
import * as path from "node:path";
function createFilePersistence(dir) {
  const petFile = path.join(dir, "pet.json");
  const logFile = path.join(dir, "events.jsonl");
  const atomicWrite = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
  };
  return {
    async loadSeedRecord() {
      if (!fs.existsSync(petFile)) return null;
      try {
        return JSON.parse(fs.readFileSync(petFile, "utf8"));
      } catch {
        return null;
      }
    },
    async saveSeedRecord(record) {
      atomicWrite(petFile, JSON.stringify(record, null, 2));
    },
    async appendEvent(event) {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(event) + "\n", "utf8");
    },
    async readEvents() {
      if (!fs.existsSync(logFile)) return [];
      const out = [];
      for (const line of fs.readFileSync(logFile, "utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          out.push(JSON.parse(t));
        } catch {
        }
      }
      return out;
    },
    async clearAll() {
      if (fs.existsSync(petFile)) fs.rmSync(petFile);
      if (fs.existsSync(logFile)) fs.rmSync(logFile);
    }
  };
}
export {
  CHANNEL_CREDIBILITY,
  CHANNEL_LICENSE_KINDS,
  DORMANCY,
  DORMANT_RENDER_GAP_MS,
  EXTRACTED_BY_WEIGHT,
  GROWTH,
  InMemoryLogStore,
  JsonlLogStore,
  LIFE_STAGES,
  LOCI_PATHS,
  LifeEngine,
  LifeHost,
  MEMORY_CAPS,
  NEUTRAL_FEATURES,
  NUTRITION,
  PART_CATALOG_DRAFT,
  PART_SLOT_MAP,
  RENDER_CONTRACT,
  RULES_VERSION,
  SCHEMA_VERSION,
  SLOT_CATALOG,
  SLOT_IDS,
  SPECIES_ID,
  STYLE_FEATURE_PRIORS,
  WIRE_AUTHORIZATION_MAP,
  appearanceOf,
  blendFeatures,
  blendLoci,
  blendStylePriors,
  canonicalJson,
  changedSlotsOf,
  clamp01,
  createFilePersistence,
  createLifeHost,
  createPetState,
  deepFreeze,
  defaultPreferences,
  fnv1a,
  fromWireEvent,
  genomeTarget,
  getLocus,
  hashSeed,
  listeningNutrition,
  mulberry32,
  petRng,
  presentationOf,
  projectPersonaSnapshot,
  projectRenderSnapshot,
  randomSeed,
  saturate,
  seedAlleles,
  setLocus,
  stateHashOf,
  styleFeatures,
  utcDay,
  validateInput
};
