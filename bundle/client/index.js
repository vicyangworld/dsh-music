/* Generated from src/client/index.js. Run npm run build. React is provided by Harness. */
(() => {
  // bundle/shared/life-core.js
  var LIFE_VERSION = 1;
  var RULES_VERSION = "echo-life/1";
  var LIFE_LIMITS = Object.freeze({ events: 1e5, memories: 64, timeline: 96 });
  var STRUCTURES = ["fold", "shell", "ribbon"];
  var BODY_KEYS = ["elongation", "spread", "curvature", "folds", "texture", "warmth", "buoyancy"];
  var FEATURE_KEYS = ["energy", "brightness", "rhythm", "texture"];
  var CHECKPOINT_MS = 5 * 60 * 1e3;
  var TRAIT_TIME_MS = 12 * 60 * 1e3;
  var MAX_DATE = 864e13;
  var clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  var rounded = (n) => Math.round(clamp(n) * 1e6) / 1e6;
  var ValidationError = class extends Error {
    constructor(message, code = "INVALID_LIFE_EVENT") {
      super(message);
      this.name = "ValidationError";
      this.code = code;
    }
  };
  function fail(message, code) {
    throw new ValidationError(message, code);
  }
  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}\u5FC5\u987B\u662F\u5BF9\u8C61`);
    return value;
  }
  function text(value, label, max, optional = false, multiline = false) {
    if (optional && (value === void 0 || value === null || value === "")) return "";
    if (typeof value !== "string") fail(`${label}\u5FC5\u987B\u662F\u6587\u5B57`);
    const clean = value.trim().normalize("NFC");
    const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (!optional && !clean || clean.length > max || controls.test(clean)) fail(`${label}\u4E3A\u7A7A\u3001\u8FC7\u957F\u6216\u5305\u542B\u65E0\u6548\u5B57\u7B26`);
    return clean;
  }
  function number(value, label, min = 0, max = 1, integer = false) {
    if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) {
      fail(`${label}\u4E0D\u662F\u6709\u6548\u6570\u503C`);
    }
    return value;
  }
  function timestamp(value) {
    return number(value, "\u65F6\u95F4", 0, MAX_DATE, true);
  }
  function validatePattern(pattern) {
    if (!Array.isArray(pattern) || pattern.length < 2 || pattern.length > 8) fail("\u62DB\u547C\u9700\u8981 2 \u81F3 8 \u4E2A\u6572\u51FB\u95F4\u9694");
    return pattern.map((n) => Math.round(number(n, "\u6572\u51FB\u95F4\u9694", 50, 5e3)));
  }
  function track(value) {
    object(value, "\u6B4C\u66F2");
    return {
      id: text(value.id, "\u6B4C\u66F2\u6807\u8BC6", 160),
      title: text(value.title, "\u6B4C\u540D", 160),
      artist: text(value.artist, "\u6B4C\u624B", 160, true)
    };
  }
  function hash(value, basis = 2166136261) {
    let h = basis >>> 0;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 2146121005) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 2221713035) >>> 0;
    return (h ^ h >>> 16) >>> 0;
  }
  function fieldHash(seed, label) {
    return hash(seed, hash(`echo-life/1:${label}`, 2654435769));
  }
  function unit(seed, label) {
    return fieldHash(seed, label) / 4294967295;
  }
  function identity(seed) {
    return `echo-${hash(seed).toString(16).padStart(8, "0")}${hash(seed, 2654435769).toString(16).padStart(8, "0")}`;
  }
  function genomeFor(seed) {
    return {
      structure: STRUCTURES[fieldHash(seed, "structure") % STRUCTURES.length],
      base: Object.fromEntries(BODY_KEYS.map((key) => [key, rounded(0.28 + unit(seed, key) * 0.44)])),
      response: Object.fromEntries(BODY_KEYS.map((key) => [key, rounded(0.55 + unit(seed, `response:${key}`) * 0.45)])),
      phase: rounded(unit(seed, "phase")),
      accent: rounded(unit(seed, "accent"))
    };
  }
  function validateLifeEvent(input) {
    object(input, "\u4E8B\u4EF6");
    const event = { id: text(input.id, "\u4E8B\u4EF6\u6807\u8BC6", 160), type: text(input.type, "\u4E8B\u4EF6\u7C7B\u578B", 24), at: timestamp(input.at) };
    switch (event.type) {
      case "listening": {
        event.sessionId = text(input.sessionId, "\u64AD\u653E\u65F6\u6BB5\u6807\u8BC6", 160);
        event.track = track(input.track);
        event.listenedMs = number(input.listenedMs, "\u6709\u6548\u64AD\u653E\u65F6\u957F", 1, 6e4, true);
        if (!["audio", "none"].includes(input.featureSource)) fail("\u9700\u8981\u6CE8\u660E\u97F3\u9891\u7279\u5F81\u6765\u6E90");
        event.featureSource = input.featureSource;
        if (event.featureSource === "audio") {
          object(input.features, "\u97F3\u9891\u7279\u5F81");
          event.features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, number(input.features[key], `\u97F3\u9891\u7279\u5F81 ${key}`)]));
        } else if (input.features !== void 0 && input.features !== null) {
          fail("\u6CA1\u6709\u5B9E\u9645\u97F3\u9891\u7279\u5F81\u65F6\uFF0C\u4E0D\u80FD\u63D0\u4EA4\u63A8\u6D4B\u7684\u97F3\u9891\u7279\u5F81");
        }
        break;
      }
      case "share":
        event.title = text(input.title, "\u6B4C\u540D", 160);
        event.artist = text(input.artist, "\u6B4C\u624B", 160, true);
        event.note = text(input.note, "\u5206\u4EAB\u8BB0\u5F55", 1e3, true, true);
        break;
      case "greeting":
        event.pattern = validatePattern(input.pattern);
        break;
      case "interaction":
        if (!["touch", "greet", "rest"].includes(input.action)) fail("\u4E0D\u652F\u6301\u8FD9\u4E2A\u4E92\u52A8\u52A8\u4F5C");
        event.action = input.action;
        break;
      case "memory":
        event.title = text(input.title, "\u8BB0\u5FC6\u6807\u9898", 160);
        event.note = text(input.note, "\u8BB0\u5FC6\u5185\u5BB9", 1e3, true, true);
        if (input.track !== void 0 && input.track !== null) event.track = track(input.track);
        break;
      case "rename":
        event.name = text(input.name, "\u540D\u5B57", 40);
        break;
      default:
        fail("\u4E0D\u652F\u6301\u8FD9\u4E2A\u751F\u547D\u4E8B\u4EF6");
    }
    return event;
  }
  function assertCore(life) {
    object(life, "\u751F\u547D\u6863\u6848");
    if (life.version !== LIFE_VERSION || life.rulesVersion !== RULES_VERSION) fail("\u751F\u547D\u89C4\u5219\u7248\u672C\u4E0D\u517C\u5BB9", "UNSUPPORTED_LIFE_VERSION");
    const seed = text(life.seed, "\u751F\u547D\u79CD\u5B50", 128);
    if (life.id !== identity(seed)) fail("\u751F\u547D\u8EAB\u4EFD\u4E0E\u79CD\u5B50\u4E0D\u4E00\u81F4", "INVALID_LIFE_STATE");
    text(life.name, "\u540D\u5B57", 40);
    timestamp(life.createdAt);
    timestamp(life.updatedAt);
    if (life.updatedAt < life.createdAt) fail("\u751F\u547D\u6863\u6848\u65F6\u95F4\u5012\u9000", "INVALID_LIFE_STATE");
    object(life.genome, "\u5148\u5929\u5F62\u6001");
    if (!STRUCTURES.includes(life.genome.structure)) fail("\u672A\u77E5\u7684\u8EAB\u4F53\u7ED3\u6784", "INVALID_LIFE_STATE");
    for (const key of BODY_KEYS) {
      number(life.genome.base?.[key], `\u5148\u5929\u5F62\u6001 ${key}`);
      number(life.genome.response?.[key], `\u751F\u957F\u54CD\u5E94 ${key}`);
    }
    number(life.genome.phase, "\u52A8\u4F5C\u7B7E\u540D");
    number(life.genome.accent, "\u5916\u89C2\u7B7E\u540D");
    object(life.growth, "\u6210\u957F\u72B6\u6001");
    number(life.growth.audioMs, "\u97F3\u9891\u89C2\u5BDF\u65F6\u957F", 0, Number.MAX_SAFE_INTEGER, true);
    number(life.growth.lastCheckpointAudioMs, "\u6210\u957F\u8282\u70B9\u65F6\u957F", 0, life.growth.audioMs, true);
    for (const key of FEATURE_KEYS) number(life.growth.traits?.[key], `\u6210\u957F\u7279\u5F81 ${key}`);
    object(life.stats, "\u7ECF\u5386\u7EDF\u8BA1");
    for (const key of ["listenedMs", "listeningSessions", "interactions", "sharedSongs"]) {
      number(life.stats[key], `\u7ECF\u5386\u7EDF\u8BA1 ${key}`, 0, Number.MAX_SAFE_INTEGER, true);
    }
    if (life.growth.audioMs > life.stats.listenedMs) fail("\u97F3\u9891\u89C2\u5BDF\u65F6\u957F\u8D85\u8FC7\u64AD\u653E\u65F6\u957F", "INVALID_LIFE_STATE");
    for (const [key, max] of [["processedEventIds", LIFE_LIMITS.events], ["listeningSessionIds", LIFE_LIMITS.events], ["memories", LIFE_LIMITS.memories], ["timeline", LIFE_LIMITS.timeline]]) {
      if (!Array.isArray(life[key]) || life[key].length > max) fail(`${key}\u8D85\u51FA\u6863\u6848\u9650\u5236`, "INVALID_LIFE_STATE");
    }
    if (life.greeting !== null) {
      object(life.greeting, "\u4E13\u5C5E\u62DB\u547C");
      validatePattern(life.greeting.pattern);
      timestamp(life.greeting.learnedAt);
      text(life.greeting.eventId, "\u62DB\u547C\u4E8B\u4EF6", 160);
      number(life.greeting.recognitions, "\u62DB\u547C\u56DE\u5E94\u6B21\u6570", 0, Number.MAX_SAFE_INTEGER, true);
    }
    for (const memory of life.memories) {
      object(memory, "\u5171\u540C\u8BB0\u5FC6");
      text(memory.id, "\u8BB0\u5FC6\u6807\u8BC6", 160);
      text(memory.title, "\u8BB0\u5FC6\u6807\u9898", 160);
      text(memory.note, "\u8BB0\u5FC6\u5185\u5BB9", 1e3, true, true);
      timestamp(memory.at);
      if (memory.track) track(memory.track);
    }
    return life;
  }
  function createLife({ seed, now, name = "\u97F3\u7075" } = {}) {
    seed = text(seed, "\u751F\u547D\u79CD\u5B50", 128);
    now = timestamp(now);
    name = text(name, "\u540D\u5B57", 40);
    const life = {
      version: LIFE_VERSION,
      rulesVersion: RULES_VERSION,
      id: identity(seed),
      seed,
      name,
      createdAt: now,
      updatedAt: now,
      genome: genomeFor(seed),
      growth: { audioMs: 0, traits: Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0.5])), lastCheckpointAudioMs: 0 },
      stats: { listenedMs: 0, listeningSessions: 0, interactions: 0, sharedSongs: 0 },
      greeting: null,
      memories: [],
      timeline: [],
      timelineOmitted: 0,
      processedEventIds: [],
      listeningSessionIds: []
    };
    life.timeline.push({ id: "birth", at: now, kind: "birth", reason: "\u521D\u6B21\u76F8\u9047", eventId: null, morphology: getMorphology(life) });
    return life;
  }
  var RESPONSE_WEIGHTS = {
    elongation: [0.4, 0.15, 0.3, 0.15],
    spread: [0.1, 0.35, 0.35, 0.2],
    curvature: [-0.25, 0.15, -0.15, 0.45],
    folds: [0.15, 0.1, 0.5, 0.25],
    texture: [0.1, 0.2, 0.15, 0.55],
    warmth: [-0.25, -0.35, 0.1, 0.3],
    buoyancy: [0.3, 0.4, 0.1, -0.2]
  };
  function getMorphology(life) {
    assertCore(life);
    const maturity = 1 - Math.exp(-life.growth.audioMs / (30 * 60 * 1e3));
    const centered = FEATURE_KEYS.map((k) => life.growth.traits[k] * 2 - 1);
    const morphology = {
      structure: life.genome.structure,
      seed: rounded(unit(life.seed, "render"))
    };
    for (const key of BODY_KEYS) {
      const response = RESPONSE_WEIGHTS[key].reduce((sum, weight, i) => sum + weight * centered[i], 0);
      morphology[key] = rounded(life.genome.base[key] + response * maturity * life.genome.response[key] * 0.24);
    }
    morphology.phase = life.genome.phase;
    morphology.accent = life.genome.accent;
    morphology.marks = life.memories.slice(-8).map((memory) => ({
      id: memory.id,
      position: rounded(unit(life.seed, `mark:${memory.id}`)),
      strength: rounded(0.45 + unit(life.seed, `mark-strength:${memory.id}`) * 0.4)
    }));
    return morphology;
  }
  function checkpoint(life, event, reason) {
    life.timeline.push({
      id: `point:${event.id}`,
      at: event.at,
      kind: event.type,
      reason,
      eventId: event.id,
      morphology: getMorphology(life)
    });
    if (life.timeline.length > LIFE_LIMITS.timeline) {
      let index = life.timeline.findIndex((point2, i) => i > 0 && i < life.timeline.length - 1 && point2.kind === "listening");
      if (index < 0) index = life.timeline.findIndex((point2, i) => i > 0 && i < life.timeline.length - 1 && point2.kind !== "memory");
      if (index < 0) index = 1;
      life.timeline.splice(index, 1);
      life.timelineOmitted++;
    }
  }
  function applyLifeEvent(life, input) {
    assertCore(life);
    object(input, "\u4E8B\u4EF6");
    const id = text(input.id, "\u4E8B\u4EF6\u6807\u8BC6", 160);
    if (life.processedEventIds.includes(id)) return life;
    if (life.processedEventIds.length >= LIFE_LIMITS.events) fail("\u751F\u547D\u6863\u6848\u5DF2\u8FBE\u5230\u672C\u7248\u4E8B\u4EF6\u4E0A\u9650\uFF0C\u8BF7\u5148\u5BFC\u51FA\u6863\u6848", "LIFE_EVENT_LIMIT");
    const event = validateLifeEvent(input);
    if (event.at < life.createdAt) fail("\u4E8B\u4EF6\u65F6\u95F4\u65E9\u4E8E\u751F\u547D\u8BDE\u751F\u65F6\u95F4");
    if (event.type === "memory" && life.memories.length >= LIFE_LIMITS.memories) fail("\u672C\u7248\u6700\u591A\u4FDD\u7559 64 \u6BB5\u5171\u540C\u8BB0\u5FC6", "LIFE_MEMORY_LIMIT");
    const next = {
      ...life,
      updatedAt: Math.max(life.updatedAt, event.at),
      stats: { ...life.stats },
      growth: { ...life.growth, traits: { ...life.growth.traits } },
      greeting: life.greeting ? { ...life.greeting, pattern: [...life.greeting.pattern] } : null,
      memories: [...life.memories],
      timeline: [...life.timeline],
      processedEventIds: [...life.processedEventIds, id],
      listeningSessionIds: [...life.listeningSessionIds]
    };
    switch (event.type) {
      case "listening": {
        next.stats.listenedMs = number(next.stats.listenedMs + event.listenedMs, "\u7D2F\u8BA1\u64AD\u653E\u65F6\u957F", 0, Number.MAX_SAFE_INTEGER, true);
        if (!next.listeningSessionIds.includes(event.sessionId)) {
          next.listeningSessionIds.push(event.sessionId);
          next.stats.listeningSessions++;
        }
        if (event.featureSource === "audio") {
          const alpha = 1 - Math.exp(-event.listenedMs / TRAIT_TIME_MS);
          for (const key of FEATURE_KEYS) next.growth.traits[key] += alpha * (event.features[key] - next.growth.traits[key]);
          next.growth.audioMs = number(next.growth.audioMs + event.listenedMs, "\u7D2F\u8BA1\u97F3\u9891\u89C2\u5BDF\u65F6\u957F", 0, Number.MAX_SAFE_INTEGER, true);
          if (next.growth.audioMs - next.growth.lastCheckpointAudioMs >= CHECKPOINT_MS) {
            next.growth.lastCheckpointAudioMs = next.growth.audioMs;
            checkpoint(next, event, "\u5171\u540C\u8046\u542C\u4E2D\u7684\u53D8\u5316");
          }
        }
        break;
      }
      case "share":
        next.stats.sharedSongs = number(next.stats.sharedSongs + 1, "\u5206\u4EAB\u6B21\u6570", 0, Number.MAX_SAFE_INTEGER, true);
        break;
      case "greeting":
        next.greeting = { pattern: event.pattern, learnedAt: event.at, eventId: event.id, recognitions: 0 };
        checkpoint(next, event, "\u5B66\u4F1A\u4E86\u4F60\u7684\u62DB\u547C");
        break;
      case "interaction":
        next.stats.interactions = number(next.stats.interactions + 1, "\u4E92\u52A8\u6B21\u6570", 0, Number.MAX_SAFE_INTEGER, true);
        if (event.action === "greet" && next.greeting) next.greeting.recognitions = number(next.greeting.recognitions + 1, "\u62DB\u547C\u56DE\u5E94\u6B21\u6570", 0, Number.MAX_SAFE_INTEGER, true);
        break;
      case "memory":
        next.memories.push({ id: event.id, title: event.title, note: event.note, at: event.at, ...event.track ? { track: event.track } : {} });
        checkpoint(next, event, event.title);
        break;
      case "rename":
        next.name = event.name;
        break;
    }
    return next;
  }

  // src/client/echo/creature.js
  var clamp2 = (value, fallback = 0.5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  var mix = (a, b, t) => a + (b - a) * t;
  var round = (n) => Math.round(n * 100) / 100;
  var point = ([x, y]) => `${round(x)} ${round(y)}`;
  var defaults = { structure: "fold", seed: 0.37, elongation: 0.5, spread: 0.5, curvature: 0.5, folds: 0.5, texture: 0.5, warmth: 0.5, buoyancy: 0.5, phase: 0.5, accent: 0.5, marks: [] };
  function normalizeMorphology(input) {
    const m = { ...defaults, ...input || {} };
    for (const key of Object.keys(defaults)) if (typeof defaults[key] === "number") m[key] = clamp2(m[key], defaults[key]);
    if (!["fold", "shell", "ribbon"].includes(m.structure)) m.structure = "fold";
    m.marks = Array.isArray(m.marks) ? m.marks.filter((mark) => mark && typeof mark.id === "string").slice(0, 8) : [];
    return m;
  }
  function palette(m, tone) {
    const hue = round(34 + m.accent * 114);
    const warm = m.warmth;
    const sat = round(8 + warm * 10);
    return {
      hue,
      saturation: sat,
      light: `hsl(${hue} ${sat - 2}% ${tone === "dark" ? 95 : 97}%)`,
      paper: `hsl(${hue} ${sat}% 86%)`,
      middle: `hsl(${hue} ${sat}% ${70 + warm * 6}%)`,
      shade: `hsl(${hue} ${sat - 3}% ${49 + warm * 4}%)`,
      dark: `hsl(${hue} 10% 33%)`,
      line: `hsl(${hue} 10% 39%)`,
      copper: `hsl(${30 + warm * 10} 31% 51%)`
    };
  }
  function random(seed, offset) {
    let value = (Math.floor(seed * 2147483647) ^ Math.imul(offset + 1, 73244475)) >>> 0;
    value = Math.imul(value ^ value >>> 16, 73244475);
    value = Math.imul(value ^ value >>> 16, 73244475);
    return ((value ^ value >>> 16) >>> 0) / 4294967295;
  }
  function cubic(a, b, c, d, t) {
    const u = 1 - t;
    return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
  }
  function smoothPath(points, closed = false) {
    if (!points.length) return "";
    const middle = (a, b) => a.map((value, index) => (value + b[index]) / 2);
    if (closed) {
      return `M ${point(middle(points.at(-1), points[0]))} ${points.map((p, index) => `Q ${point(p)} ${point(middle(p, points[(index + 1) % points.length]))}`).join(" ")} Z`;
    }
    return `M ${point(points[0])} ${points.slice(1, -1).map((p, index) => `Q ${point(p)} ${point(middle(p, points[index + 2]))}`).join(" ")} Q ${point(points.at(-1))} ${point(points.at(-1))}`;
  }
  function fitScale(points, anchor, bounds) {
    let scale = 1;
    for (const p of points) {
      if (p[0] < bounds[0]) scale = Math.min(scale, (anchor[0] - bounds[0]) / (anchor[0] - p[0]));
      if (p[0] > bounds[1]) scale = Math.min(scale, (bounds[1] - anchor[0]) / (p[0] - anchor[0]));
      if (p[1] < bounds[2]) scale = Math.min(scale, (anchor[1] - bounds[2]) / (anchor[1] - p[1]));
      if (p[1] > bounds[3]) scale = Math.min(scale, (bounds[3] - anchor[1]) / (p[1] - anchor[1]));
    }
    return scale;
  }
  function ribbonPoints(m) {
    const center = [300, 254];
    const rx = mix(105, 163, random(m.seed, 101)) * mix(0.84, 1.13, m.spread);
    const ry = mix(108, 174, random(m.seed, 102)) * mix(0.84, 1.12, m.elongation);
    const opening = -Math.PI / 2 + mix(-1.15, 1.15, random(m.seed, 103));
    const handed = random(m.seed, 104) < 0.5 ? -1 : 1;
    const sweep = mix(1.66, 2.62, random(m.seed, 105)) * Math.PI + (m.curvature - 0.5) * 0.42;
    const inner = mix(0.18, 0.43, random(m.seed, 106));
    const tightening = mix(0.76, 1.5, random(m.seed, 107));
    const shear = mix(-24, 24, random(m.seed, 108));
    const points = [];
    for (let i = 0; i <= 80; i += 1) {
      const t = i / 80;
      const angle = opening + handed * sweep * t;
      const radius = mix(1, inner, Math.pow(t, tightening));
      points.push([
        center[0] + Math.cos(angle) * rx * radius + Math.sin(angle) * shear,
        center[1] + Math.sin(angle) * ry * radius
      ]);
    }
    const start = points.at(-1), previous = points.at(-2);
    const length = Math.hypot(start[0] - previous[0], start[1] - previous[1]) || 1;
    const tangent = [(start[0] - previous[0]) / length, (start[1] - previous[1]) / length];
    const radialLength = Math.hypot(start[0] - center[0], start[1] - center[1]) || 1;
    const outward = [(start[0] - center[0]) / radialLength, (start[1] - center[1]) / radialLength];
    const tail = mix(26, 112, random(m.seed, 109)) * mix(0.86, 1.1, m.curvature);
    const c1 = start.map((v, i) => v + tangent[i] * tail * 0.4);
    const c2 = start.map((v, i) => v + tangent[i] * tail * 0.82 + outward[i] * tail * 0.58);
    const end = start.map((v, i) => v + tangent[i] * tail * 0.4 + outward[i] * tail);
    for (let i = 1; i <= 20; i += 1) points.push(cubic(start, c1, c2, end, i / 20));
    const scale = fitScale(points, center, [124, 476, 100, 363]);
    return points.map((p) => p.map((v, i) => center[i] + (v - center[i]) * scale));
  }
  function ribbonShape(points, m) {
    const left = [], right = [];
    points.forEach((p, index) => {
      const prev = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 1)];
      const dx = next[0] - prev[0], dy = next[1] - prev[1];
      const length = Math.hypot(dx, dy) || 1;
      const progress = index / (points.length - 1);
      const taper = Math.pow(Math.sin(Math.PI * (0.04 + progress * 0.92)), 0.44);
      const twist = 0.4 + 0.6 * Math.abs(Math.cos(progress * Math.PI * mix(1.45, 3.25, random(m.seed, 110)) + m.phase));
      const width = (12 + random(m.seed, 111) * 18 + m.folds * 11) * taper * twist;
      left.push([p[0] - dy / length * width, p[1] + dx / length * width]);
      right.push([p[0] + dy / length * width, p[1] - dx / length * width]);
    });
    return { path: smoothPath([...left, ...right.slice().reverse()], true), left, right };
  }
  function foldGeometry(m) {
    const root = [304, 349];
    const count = 6 + Math.min(7, Math.floor(random(m.seed, 201) * 8));
    const spread = mix(138, 211, m.spread);
    const height = mix(176, 254, m.elongation) * mix(0.88, 1.09, random(m.seed, 202));
    const left = -mix(0.72, 1.39, random(m.seed, 203));
    const right = mix(0.7, 1.37, random(m.seed, 204));
    const peak = mix(0.14, 0.86, random(m.seed, 205));
    const lean = mix(-0.15, 0.15, random(m.seed, 206));
    const leftReach = mix(0.68, 1.12, random(m.seed, 207));
    const rightReach = mix(0.68, 1.12, random(m.seed, 208));
    const leaves = [];
    for (let index = 0; index < count; index += 1) {
      const f = index / (count - 1);
      const angle = mix(left, right, f) + lean;
      const sector = 0.64 + 0.43 * Math.exp(-Math.pow((f - peak) / 0.27, 2)) + random(m.seed, index + 220) * 0.12;
      const reach = mix(leftReach, rightReach, f);
      const tip = [root[0] + Math.sin(angle) * spread * reach, root[1] - Math.cos(angle) * height * sector];
      const width = mix(31, 58, m.folds) * mix(0.72, 1.18, random(m.seed, index + 250));
      const curl = mix(-13, 29, m.curvature);
      const side = f < 0.5 ? -1 : 1;
      const edge = [tip[0] + side * width * 0.72, tip[1] + width * 0.24];
      const outline = [
        root,
        [root[0] + (tip[0] - root[0]) * 0.34 - width * 0.2, root[1] - height * 0.34],
        [tip[0] - width * 0.38, tip[1] + height * 0.18],
        tip,
        [tip[0] + side * width * 0.56, tip[1] - curl],
        [edge[0] + curl * side, edge[1] + 11],
        edge,
        [root[0] + (edge[0] - root[0]) * 0.84, root[1] - height * 0.28],
        [root[0] + width * 0.32, root[1] - 25],
        root
      ];
      const vein = [[root[0], root[1] - 2], [root[0] + (tip[0] - root[0]) * 0.38, root[1] - height * 0.39], [tip[0] + side * 7, tip[1] + height * 0.17], tip];
      leaves.push({ index, angle, side, outline, vein, edge, detail: [tip[0] + side * 13, tip[1] + height * 0.4] });
    }
    const scale = fitScale(leaves.flatMap((leaf) => [...leaf.outline, ...leaf.vein, leaf.detail]), root, [78, 526, 78, 378]);
    const fit = (p) => p.map((v, i) => root[i] + (v - root[i]) * scale);
    return { root, leaves: leaves.map((leaf) => ({ ...leaf, outline: leaf.outline.map(fit), vein: leaf.vein.map(fit), edge: fit(leaf.edge), detail: fit(leaf.detail) })) };
  }
  function foldTransforms({ root, leaves }, compact) {
    const rotatePoint = (p, leaf) => {
      const rad = -leaf.angle * 36 * Math.PI / 180;
      const x = p[0] - root[0], y = p[1] - root[1];
      return [root[0] + (Math.cos(rad) * x - Math.sin(rad) * y) * 0.8, root[1] + (Math.sin(rad) * x + Math.cos(rad) * y) * 0.8];
    };
    const compactFit = compact ? fitScale(leaves.flatMap((leaf) => [...leaf.outline, ...leaf.vein, leaf.detail].map((p) => rotatePoint(p, leaf))), root, [132, 468, 90, 394]) : 1;
    return leaves.map((leaf) => {
      const rad = (compact ? -leaf.angle * 36 : 0) * Math.PI / 180, scale = compact ? 0.8 * compactFit : 1;
      const a = Math.cos(rad) * scale, b = Math.sin(rad) * scale, c = -Math.sin(rad) * scale, d = Math.cos(rad) * scale;
      return [a, b, c, d, root[0] - a * root[0] - c * root[1], root[1] - b * root[0] - d * root[1]].map(round);
    });
  }
  function renderFold(h, m, ids, colors, compact) {
    const geometry = foldGeometry(m);
    const { leaves } = geometry;
    const transforms = foldTransforms(geometry, compact);
    const petals = leaves.map((leaf) => {
      const { index, side, outline, vein: line } = leaf;
      const d = `M ${point(outline[0])} C ${outline.slice(1, 4).map(point).join(" ")} C ${outline.slice(4, 7).map(point).join(" ")} C ${outline.slice(7).map(point).join(" ")} Z`;
      const vein = `M ${point(line[0])} C ${line.slice(1).map(point).join(" ")}`;
      const matrix = `matrix(${transforms[index].join(",")})`;
      const clip = `${ids.leafClip}-${index}`;
      return h(
        "g",
        { key: `fold-${index}`, className: "echo-fold-leaf", style: { transform: matrix, transformOrigin: "0 0", transitionDelay: `${Math.abs(index - leaves.length / 2) * 14}ms` } },
        h("defs", null, h("clipPath", { id: clip }, h("path", { d }))),
        h("path", { d, fill: `url(#${ids[`leaf${index % 3}`]})` }),
        h(
          "g",
          { clipPath: `url(#${clip})` },
          h("path", { d, fill: `url(#${ids.surfaceLight})`, opacity: 0.2 }),
          h("path", { d, fill: `url(#${ids.rootShade})` }),
          h("path", { d: vein, fill: "none", stroke: colors.line, strokeWidth: 1.1 + m.texture * 0.6, opacity: 0.075 + m.texture * 0.035 }),
          h("path", { d: vein, transform: `translate(${side * 1.4} -0.5)`, fill: "none", stroke: colors.light, strokeWidth: 1, opacity: 0.32 })
        )
      );
    });
    return h(
      "g",
      { className: "echo-body-fold" },
      h("path", { d: "M 274 345 C 281 321 312 318 329 341 C 347 359 334 376 309 379 C 282 381 261 365 274 345 Z", fill: `url(#${ids.underside})`, className: "echo-fold-foot" }),
      ...petals,
      h("path", { d: "M 293 346 C 293 321 303 297 314 276 C 323 296 330 323 323 347 C 315 365 300 365 293 346 Z", fill: `url(#${ids.ceramic})` }),
      h("path", { d: `M ${301 + m.seed * 5} 334 Q 309 326 318 333`, fill: "none", stroke: colors.dark, strokeWidth: 2, strokeLinecap: "round", opacity: 0.65 }),
      h("path", { d: "M 305 353 Q 310 358 315 352", fill: "none", stroke: colors.light, strokeWidth: 1, opacity: 0.4 })
    );
  }
  function shellGeometry(m) {
    const cx = mix(284, 316, random(m.seed, 301));
    const base = mix(353, 345, m.buoyancy);
    const width = mix(108, 186, random(m.seed, 302)) * mix(0.84, 1.1, m.spread);
    const height = mix(92, 220, random(m.seed, 303)) * mix(0.83, 1.1, m.elongation);
    const peak = [cx + width * mix(-0.43, 0.43, random(m.seed, 304)), base - height];
    const left = [cx - width, base - 22 - height * 0.16];
    const right = [cx + width, base - 26 - height * 0.12];
    const upper = [
      [left, [cx - width * 1.04, base - height * mix(0.45, 0.8, m.curvature)], [peak[0] - width * mix(0.17, 0.58, random(m.seed, 305)), peak[1]], peak],
      [peak, [peak[0] + width * mix(0.17, 0.58, random(m.seed, 306)), peak[1]], [cx + width * 0.98, base - height * mix(0.43, 0.79, random(m.seed, 307))], right]
    ];
    const lower = [
      [right, [cx + width * 1.04, base + 8], [cx + width * 0.48, base + 18], [cx, base + 15]],
      [[cx, base + 15], [cx - width * 0.58, base + 14], [cx - width * 1.04, base - 3], left]
    ];
    const path = `M ${point(left)} ${[...upper, ...lower].map((segment) => `C ${segment.slice(1).map(point).join(" ")}`).join(" ")} Z`;
    return { cx, base, width, height, upper, lower, path };
  }
  function shellOutline(m) {
    return shellGeometry(m).path;
  }
  function shellSurface(shell, at, inset = 0) {
    const t = Math.max(0, Math.min(1, at)) * 2;
    const p = cubic(...shell.upper[Math.min(1, Math.floor(t))], t >= 1 ? t - 1 : t);
    const center = [shell.cx, shell.base - shell.height * 0.28];
    return p.map((v, i) => mix(v, center[i], inset));
  }
  function shellFootReach(m) {
    const count = 2 + Math.min(2, Math.floor(random(m.seed, 309) * 3));
    return Math.max(...Array.from({ length: count }, (_, index) => mix(21, 38, random(m.seed, 330 + index))));
  }
  function shellTransform(m, compact, shell = shellGeometry(m)) {
    if (!compact) return [1, 0, 0, 1, 0, 0];
    const floor = shell.base + shellFootReach(m);
    return [0.72, 0, 0, 0.72, shell.cx * 0.28, floor - (floor - 13) * 0.72].map(round);
  }
  function renderShell(h, m, ids, colors, compact) {
    const shell = shellGeometry(m);
    const { cx, base, width, height } = shell;
    const plates = [];
    const plateCount = 3 + Math.min(2, Math.floor(random(m.seed, 308) * 3));
    for (let i = 0; i < plateCount; i += 1) {
      const at = (i + 1) / (plateCount + 1);
      const top = shellSurface(shell, at);
      const end = [mix(cx - width * 0.8, cx + width * 0.78, at), base + 11];
      const bend = mix(-22, 28, m.curvature) + (at - 0.5) * width * 0.3;
      plates.push(h("path", {
        key: `plate-${i}`,
        d: `M ${point(top)} C ${point([top[0] + bend, top[1] + height * 0.32])} ${point([end[0] - bend, base - height * 0.18])} ${point(end)}`,
        fill: "none",
        stroke: i % 2 ? colors.light : colors.line,
        strokeWidth: i % 2 ? 1.5 : 0.9,
        opacity: i % 2 ? 0.19 : 0.045 + m.texture * 0.045
      }));
    }
    const feet = [];
    const footCount = 2 + Math.min(2, Math.floor(random(m.seed, 309) * 3));
    for (let i = 0; i < footCount; i += 1) {
      const at = (i + mix(0.32, 0.68, random(m.seed, 320 + i))) / footCount;
      const x = cx + (at - 0.5) * width * 1.66;
      const reach = mix(21, 38, random(m.seed, 330 + i));
      const toe = mix(-16, 16, random(m.seed, 340 + i));
      const half = mix(10, 18, random(m.seed, 350 + i));
      feet.push(h("path", { key: `foot-${i}`, d: `M ${point([x - half, base - 3])} C ${point([x - half - 5, base + reach * 0.7])} ${point([x + toe - half, base + reach])} ${point([x + toe, base + reach])} C ${point([x + toe + half, base + reach])} ${point([x + half, base + 14])} ${point([x + half, base - 3])} Z`, fill: `url(#${ids.underside})` }));
    }
    const eye = [cx - width * 0.83, base - height * 0.13];
    const scar = shellSurface(shell, mix(0.24, 0.7, m.seed), 0.16);
    const gleam = Array.from({ length: 17 }, (_, i) => shellSurface(shell, 0.1 + i / 16 * 0.48, 0.1));
    return h(
      "g",
      { className: "echo-body-shell", style: { transform: `matrix(${shellTransform(m, compact, shell).join(",")})`, transformOrigin: "0 0" } },
      h(
        "g",
        { className: "echo-shell-feet", style: { transform: `translateY(${compact ? -13 : 0}px)` } },
        ...feet
      ),
      h("path", { d: shell.path, transform: "translate(0 3.5)", fill: `url(#${ids.underside})`, opacity: 0.8 }),
      h("path", { d: shell.path, fill: `url(#${ids.ceramic})` }),
      h(
        "g",
        { clipPath: `url(#${ids.shellClip})` },
        h("path", { d: shell.path, fill: `url(#${ids.surfaceLight})`, opacity: 0.24 }),
        ...plates,
        h("path", { d: `M ${point([cx - width, base - 13])} Q ${point([cx, base + 21])} ${point([cx + width, base - 16])}`, fill: "none", stroke: colors.shade, strokeWidth: 4.5, opacity: 0.08 })
      ),
      h("path", { d: `M ${point(eye)} q 7 11 19 7`, fill: "none", stroke: colors.dark, strokeWidth: 3.4, strokeLinecap: "round", opacity: 0.84 }),
      h("path", { d: `M ${point(scar)} q 3 12 10 17`, fill: "none", stroke: colors.copper, strokeWidth: 1.3, opacity: 0.42 }),
      h("path", { d: smoothPath(gleam), fill: "none", stroke: colors.light, strokeWidth: 1.6, strokeLinecap: "round", opacity: 0.25 })
    );
  }
  function renderRibbon(h, m, ids, colors, compact) {
    const points = ribbonPoints(m);
    const outline = ribbonShape(points, m);
    const ridge = smoothPath(points.slice(0, 65));
    const edge = smoothPath(outline.left.slice(2, 50));
    const veins = [];
    const surfaces = [], lights = [];
    for (let start = 0; start < points.length - 1; start += 4) {
      const end = Math.min(points.length - 1, start + 4), middle = Math.round((start + end) / 2);
      const left = outline.left[middle], right = outline.right[middle];
      const width = Math.hypot(left[0] - right[0], left[1] - right[1]) || 1;
      const key = clamp2(0.5 + ((left[0] - right[0]) * -0.6 + (left[1] - right[1]) * -0.8) / width * 0.5);
      const color = (lightness) => `hsl(${colors.hue} ${colors.saturation}% ${round(lightness)}%)`;
      const id = `${ids.ribbon}-surface-${start}`;
      lights.push(h(
        "linearGradient",
        { key: id, id, gradientUnits: "userSpaceOnUse", x1: left[0], y1: left[1], x2: right[0], y2: right[1] },
        h("stop", { offset: "0%", stopColor: color(61 + key * 27) }),
        h("stop", { offset: "42%", stopColor: color(82 + Math.sin(middle / points.length * Math.PI) * 3) }),
        h("stop", { offset: "100%", stopColor: color(88 - key * 25) })
      ));
      const from = Math.max(0, start - 1), to = Math.min(points.length - 1, end + 1);
      const contour = [...outline.left.slice(from, to + 1), ...outline.right.slice(from, to + 1).reverse()];
      surfaces.push(h("path", { key: start, d: `M ${contour.map(point).join(" L ")} Z`, fill: `url(#${id})` }));
    }
    const count = 5 + Math.round(m.texture * 2);
    for (let i = 0; i < count; i += 1) {
      const index = 12 + i * 9;
      veins.push(h("path", { key: `ribbon-rib-${i}`, d: `M ${point(outline.left[index])} Q ${point(points[index + 1])} ${point(outline.right[index + 2])}`, fill: "none", stroke: colors.line, strokeWidth: 0.7 + m.texture * 0.3, opacity: 0.06 + m.texture * 0.055 }));
    }
    return h(
      "g",
      { className: "echo-body-ribbon", style: { transform: compact ? "matrix(0.78, 0, 0, 0.72, 66, 89.6)" : "matrix(1, 0, 0, 1, 0, 0)", transformOrigin: "0 0" } },
      h(
        "defs",
        null,
        h("clipPath", { id: ids.ribbonClip }, h("path", { d: outline.path })),
        h("filter", { id: `${ids.ribbon}-softness`, x: "-10%", y: "-10%", width: "120%", height: "120%", colorInterpolationFilters: "sRGB" }, h("feGaussianBlur", { stdDeviation: 4.5 })),
        ...lights
      ),
      h("path", { d: outline.path, fill: `url(#${ids.ribbon})` }),
      h(
        "g",
        { clipPath: `url(#${ids.ribbonClip})` },
        h("g", { filter: `url(#${ids.ribbon}-softness)` }, ...surfaces),
        h("path", { d: outline.path, fill: `url(#${ids.surfaceLight})`, opacity: 0.18 }),
        h("path", { d: edge, fill: "none", stroke: colors.light, strokeWidth: 1.5, strokeLinecap: "round", opacity: 0.43 }),
        h("path", { d: ridge, fill: "none", stroke: colors.shade, strokeWidth: 1.5, opacity: 0.09 }),
        ...veins
      ),
      h("path", { d: `M ${point(points[75])} Q ${point(points[78])} ${point(points[81])}`, fill: "none", stroke: colors.dark, strokeWidth: 2.8, strokeLinecap: "round", opacity: 0.65 }),
      h("path", { d: `M ${point(outline.right[20])} Q ${point(points[22])} ${point(outline.left[23])}`, fill: "none", stroke: colors.copper, strokeWidth: 1.25, opacity: 0.42 })
    );
  }
  function markerPlacement(m, mark, compact = false) {
    const at = clamp2(mark.position);
    if (m.structure === "ribbon") {
      const points = ribbonPoints(m);
      return { position: points[Math.round(mix(9, 62, at))], matrix: compact ? [0.78, 0, 0, 0.72, 66, 89.6] : [1, 0, 0, 1, 0, 0], delay: 0 };
    }
    if (m.structure === "shell") {
      const shell = shellGeometry(m);
      return { position: shellSurface(shell, mix(0.12, 0.88, at), 0.32), matrix: shellTransform(m, compact, shell), delay: 0 };
    }
    const geometry = foldGeometry(m);
    const { leaves } = geometry;
    const leaf = leaves[Math.min(leaves.length - 1, Math.floor(at * leaves.length))];
    return { position: cubic(...leaf.vein, mix(0.58, 0.74, at)), matrix: foldTransforms(geometry, compact)[leaf.index], delay: Math.abs(leaf.index - leaves.length / 2) * 14 };
  }
  function createCreatureComponents(React) {
    const h = React.createElement;
    const { useRef, useState, useEffect, useMemo } = React;
    let sequence = 0;
    function Creature({ life, morphology, active = false, compact = false, gesture = 0, onTouch, onMemorySelect, className = "", label, motionEnabled = true, tone = "light", framing = "stage" }) {
      const instance = useRef(null);
      if (!instance.current) instance.current = `echo-being-${++sequence}`;
      const root = useRef(null);
      const greetingTimers = useRef([]);
      const lastGesture = useRef(0);
      const [visible, setVisible] = useState(typeof document === "undefined" || !document.hidden);
      const [response, setResponse] = useState(0);
      const [responseDuration, setResponseDuration] = useState(1300);
      const [responding, setResponding] = useState(false);
      const m = useMemo(() => normalizeMorphology(morphology || (life ? getMorphology(life) : defaults)), [life, morphology]);
      const colors = useMemo(() => palette(m, tone), [m, tone]);
      const ids = useMemo(() => Object.fromEntries(["ceramic", "underside", "ribbon", "leaf0", "leaf1", "leaf2", "surfaceLight", "rootShade", "leafClip", "ribbonClip", "contact", "grain", "shellClip", "title", "desc"].map((key) => [key, `${instance.current}-${key}`])), []);
      const canMove = motionEnabled && visible;
      const presence = framing === "presence";
      const viewport = presence ? [52, 48, 496, 388] : compact ? [120, 70, 360, 340] : [0, 0, 600, 480];
      useEffect(() => {
        if (typeof document === "undefined") return void 0;
        const change = () => {
          setVisible(!document.hidden);
          if (document.hidden) {
            greetingTimers.current.forEach(clearTimeout);
            greetingTimers.current = [];
            setResponding(false);
          }
        };
        document.addEventListener("visibilitychange", change);
        return () => document.removeEventListener("visibilitychange", change);
      }, []);
      useEffect(() => {
        if (!gesture || gesture === lastGesture.current) return void 0;
        lastGesture.current = gesture;
        greetingTimers.current.forEach(clearTimeout);
        greetingTimers.current = [];
        if (!canMove) return void 0;
        const pattern = life?.greeting?.pattern;
        const intervals = Array.isArray(pattern) && pattern.length >= 2 && pattern.length <= 8 ? pattern.filter(Number.isFinite).map((ms) => Math.max(50, Math.min(5e3, ms))) : [];
        const beat = (interval) => {
          setResponseDuration(interval ? Math.max(180, Math.min(920, interval * 0.85)) : 1300);
          setResponse((value) => value + 1);
        };
        beat(intervals[0]);
        let elapsed = 0;
        intervals.forEach((interval, index) => {
          elapsed += interval;
          greetingTimers.current.push(setTimeout(() => beat(intervals[index + 1] || interval), elapsed));
        });
        return () => {
          greetingTimers.current.forEach(clearTimeout);
          greetingTimers.current = [];
        };
      }, [gesture]);
      useEffect(() => {
        if (!response) return void 0;
        setResponding(true);
        const timer = setTimeout(() => setResponding(false), responseDuration + 60);
        return () => clearTimeout(timer);
      }, [response, responseDuration]);
      const touch = (event) => {
        setResponseDuration(1300);
        setResponse((value) => value + 1);
        if (onTouch) onTouch(event);
      };
      const keyboardTouch = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        touch(event);
      };
      const look = (event) => {
        if (!canMove || compact && !presence || !root.current) return;
        if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const rect = root.current.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
        const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
        root.current.style.setProperty("--echo-look-x", `${round(x * 2.7)}px`);
        root.current.style.setProperty("--echo-look-y", `${round(y * 1.6)}px`);
        root.current.style.setProperty("--echo-look-r", `${round(x * 0.75)}deg`);
      };
      const lookAway = () => {
        if (!root.current) return;
        root.current.style.setProperty("--echo-look-x", "0px");
        root.current.style.setProperty("--echo-look-y", "0px");
        root.current.style.setProperty("--echo-look-r", "0deg");
      };
      const name = label || life?.name || "\u4F60\u7684\u97F3\u7075";
      const body = useMemo(() => m.structure === "shell" ? renderShell(h, m, ids, colors, compact) : m.structure === "ribbon" ? renderRibbon(h, m, ids, colors, compact) : renderFold(h, m, ids, colors, compact), [m, colors, compact]);
      const marks = useMemo(() => m.marks.map((mark) => ({ mark, ...markerPlacement(m, mark, compact) })), [m, compact]);
      const stops = (items) => items.map(([offset, color, opacity]) => h("stop", { key: offset, offset, stopColor: color, ...opacity == null ? {} : { stopOpacity: opacity } }));
      const gradient = (id, x1, y1, x2, y2, items) => h("linearGradient", { id, x1, y1, x2, y2 }, ...stops(items));
      const memoryName = (mark) => life?.memories?.find((memory) => memory.id === mark.id)?.title || "\u5171\u540C\u8BB0\u5FC6";
      const shell = m.structure === "shell" ? shellGeometry(m) : null;
      const shadow = shell ? { x: shell.cx, y: shell.base + shellFootReach(m) + 2, width: shell.width * (compact ? 0.68 : 0.9) } : { x: 303, y: m.structure === "ribbon" ? 397 : 383, width: m.structure === "ribbon" ? 102 : 91 };
      return h("div", {
        ref: root,
        className: `echo-creature ${className}`.trim(),
        "data-structure": m.structure,
        "data-active": active ? "true" : "false",
        "data-compact": compact ? "true" : "false",
        "data-motion": canMove ? "on" : "off",
        "data-responding": responding ? "true" : "false",
        "data-tone": tone,
        "data-framing": presence ? "presence" : "stage",
        onPointerMove: look,
        onPointerLeave: lookAway,
        style: { "--echo-breath-duration": `${round(6.8 + m.phase * 3.6)}s`, "--echo-drift-duration": `${round(12 + m.seed * 6)}s`, "--echo-listen-duration": `${round(3.8 + (1 - m.buoyancy) * 1.6)}s`, "--echo-response-duration": `${responseDuration}ms`, "--echo-inhale": String(Number((1.006 + m.buoyancy * 8e-3).toFixed(3))), "--echo-shadow-opacity": tone === "dark" ? 0.31 : 0.21, "--echo-origin-x": `${round((303 - viewport[0]) / viewport[2] * 100)}%`, "--echo-origin-y": `${round((350 - viewport[1]) / viewport[3] * 100)}%` }
      }, h(
        "svg",
        { viewBox: viewport.join(" "), className: "echo-creature-svg", role: "group", "aria-labelledby": `${ids.title} ${ids.desc}`, focusable: false },
        h("title", { id: ids.title }, name),
        h("desc", { id: ids.desc }, compact ? "\u6536\u62E2\u8EAB\u4F53\uFF0C\u5B89\u9759\u966A\u4F34\u3002" : "\u7531\u5171\u540C\u7ECF\u5386\u5851\u9020\u7684\u751F\u547D\u3002\u8F7B\u89E6\u8EAB\u4F53\u4E0E\u5B83\u6253\u62DB\u547C\uFF0C\u89E6\u6478\u8EAB\u4F53\u4E0A\u7684\u5C0F\u6807\u8BB0\u53EF\u4EE5\u56DE\u770B\u8BB0\u5FC6\u3002"),
        h(
          "defs",
          null,
          h("radialGradient", { id: ids.ceramic, cx: "26%", cy: "18%", r: "96%", fx: "24%", fy: "15%" }, ...stops([["0%", colors.light], ["25%", colors.paper], ["62%", colors.middle], ["86%", colors.shade], ["100%", colors.dark]])),
          gradient(ids.underside, "8%", "0%", "74%", "100%", [["0%", colors.middle], ["62%", colors.shade], ["100%", colors.dark]]),
          gradient(ids.leaf0, "5%", "0%", "84%", "100%", [["0%", colors.light], ["29%", colors.paper], ["66%", colors.middle], ["100%", colors.shade]]),
          gradient(ids.leaf1, "8%", "0%", "88%", "100%", [["0%", colors.light], ["40%", colors.paper], ["76%", colors.middle], ["100%", colors.shade]]),
          gradient(ids.leaf2, "5%", "0%", "84%", "100%", [["0%", colors.paper], ["16%", colors.light], ["54%", colors.paper], ["79%", colors.middle], ["100%", colors.shade]]),
          gradient(ids.ribbon, "7%", "0%", "88%", "100%", [["0%", colors.light], ["26%", colors.paper], ["53%", colors.middle], ["76%", colors.shade], ["100%", colors.dark]]),
          h("radialGradient", { id: ids.surfaceLight, cx: "25%", cy: "18%", r: "83%" }, ...stops([["0%", colors.light, 0.72], ["46%", colors.light, 0.12], ["100%", colors.light, 0]])),
          h("linearGradient", { id: ids.rootShade, gradientUnits: "userSpaceOnUse", x1: 304, y1: 351, x2: 303, y2: 180 }, ...stops([["0%", colors.dark, 0.2], ["44%", colors.dark, 0.035], ["100%", colors.dark, 0]])),
          h("radialGradient", { id: ids.contact }, ...stops([["0%", "#26362c", 0.75], ["36%", "#26362c", 0.27], ["100%", "#26362c", 0]])),
          h("clipPath", { id: ids.shellClip }, h("path", { d: shellOutline(m) })),
          h(
            "filter",
            { id: ids.grain, x: "-8%", y: "-8%", width: "116%", height: "116%", colorInterpolationFilters: "sRGB" },
            h("feTurbulence", { type: "fractalNoise", baseFrequency: 0.67, numOctaves: 2, seed: Math.floor(m.seed * 1e3), stitchTiles: "stitch", result: "noise" }),
            h("feColorMatrix", { in: "noise", type: "saturate", values: 0, result: "mono" }),
            h("feComponentTransfer", { in: "mono", result: "fine" }, h("feFuncA", { type: "linear", slope: 0.025 + m.texture * 0.02 })),
            h("feComposite", { in: "fine", in2: "SourceGraphic", operator: "in", result: "surface" }),
            h("feBlend", { in: "SourceGraphic", in2: "surface", mode: "multiply" })
          )
        ),
        h("ellipse", { cx: shadow.x, cy: shadow.y, rx: shadow.width, ry: m.structure === "ribbon" ? 15 : 18, fill: `url(#${ids.contact})`, className: "echo-creature-shadow" }),
        m.structure !== "ribbon" ? h("ellipse", { cx: shadow.x, cy: shadow.y - 3, rx: shell ? shadow.width * 0.52 : 35, ry: 5.5, fill: `url(#${ids.contact})`, className: "echo-creature-shadow echo-creature-contact" }) : null,
        h(
          "g",
          { className: "echo-creature-drift" },
          h(
            "g",
            { className: "echo-creature-attention" },
            h(
              "g",
              { className: "echo-creature-breath" },
              h(
                "g",
                { className: "echo-creature-response", key: `response-${response}` },
                h(
                  "g",
                  {
                    className: "echo-creature-touch-target",
                    role: onTouch ? "button" : void 0,
                    tabIndex: onTouch ? 0 : void 0,
                    "aria-label": onTouch ? `\u548C${name}\u6253\u62DB\u547C` : void 0,
                    onClick: onTouch ? touch : void 0,
                    onKeyDown: onTouch ? keyboardTouch : void 0
                  },
                  h("rect", { x: 119, y: 67, width: 364, height: 326, rx: 80, fill: "transparent", pointerEvents: onTouch ? "all" : "none", className: "echo-creature-focus-ring" }),
                  h("g", { filter: compact && !presence ? void 0 : `url(#${ids.grain})`, className: "echo-creature-surface" }, body)
                ),
                !compact || presence ? h("g", { className: "echo-creature-memories" }, ...marks.map(({ mark, position: [x, y], matrix, delay }) => {
                  const click = (event) => {
                    event.stopPropagation();
                    if (onMemorySelect) onMemorySelect(mark.id);
                  };
                  return h("g", { key: mark.id, className: "echo-memory-pose", style: { transform: `matrix(${matrix.join(",")})`, transformOrigin: "0 0", transitionDelay: `${delay}ms` } }, h(
                    "g",
                    {
                      className: "echo-memory-mark",
                      transform: `translate(${round(x)} ${round(y)})`,
                      role: onMemorySelect ? "button" : void 0,
                      tabIndex: onMemorySelect ? 0 : void 0,
                      "aria-label": `\u56DE\u770B\u8BB0\u5FC6\uFF1A${memoryName(mark)}`,
                      onClick: onMemorySelect ? click : void 0,
                      onKeyDown: onMemorySelect ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          click(event);
                        }
                      } : void 0
                    },
                    h("circle", { r: presence ? 24 : 14, fill: "transparent", className: "echo-memory-hit" }),
                    h("path", { d: "M -4 -3 Q -1 3 4 5 M -1 -5 Q 1 0 6 1", fill: "none", stroke: colors.copper, strokeWidth: 1.6 + clamp2(mark.strength) * 0.5, strokeLinecap: "round" }),
                    h("circle", { r: 10, fill: "none", stroke: colors.copper, strokeWidth: 0.8, className: "echo-memory-halo" })
                  ));
                })) : null
              )
            )
          )
        )
      ));
    }
    return { Creature };
  }

  // src/client/echo/mini.js
  var POSITION_KEY = "dsh-music.echo.mini-position";
  var LYRICS_KEY = "dsh-music.echo.mini-lyrics";
  var empty = Object.freeze({});
  var identity2 = (track2) => track2 ? String(track2.id || `${track2.artist || ""}::${track2.title || ""}`) : "";
  var bounded = (value, low, high) => Math.max(low, Math.min(Math.max(low, high), value));
  function preference(key, fallback) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(key));
      return saved == null ? fallback : saved;
    } catch {
      return fallback;
    }
  }
  function remember(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
    }
  }
  function companionPlacement(anchor, panel, viewport) {
    const gap = 10, margin = 12;
    const width = Math.min(panel.width || 286, Math.max(0, viewport.width - margin * 2));
    const height = Math.min(panel.height || 240, Math.max(0, viewport.height - margin * 2));
    let left, top, side;
    if (viewport.width - anchor.right >= width + gap + margin) {
      left = anchor.right + gap;
      top = anchor.top + 30;
      side = "right";
    } else if (anchor.left >= width + gap + margin) {
      left = anchor.left - width - gap;
      top = anchor.top + 30;
      side = "left";
    } else {
      side = "stack";
      left = anchor.left + anchor.width / 2 - width / 2;
      top = viewport.height - anchor.bottom >= height + gap + margin ? anchor.bottom + gap : anchor.top - height - gap;
    }
    return { left: bounded(left, margin, viewport.width - width - margin), top: bounded(top, margin, viewport.height - height - margin), width, maxHeight: Math.max(0, viewport.height - margin * 2), side };
  }
  function createEchoMiniComponent(React, { Creature, Icon, useLife, formatTime: formatTime2 }) {
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;
    const useBeforePaint = typeof window === "undefined" ? useEffect : React.useLayoutEffect || useEffect;
    function useSource(source) {
      const [snapshot, setSnapshot] = useState(() => source?.getSnapshot() || empty);
      useEffect(() => {
        const update = () => setSnapshot(source?.getSnapshot() || empty);
        update();
        return source?.subscribe(update);
      }, [source]);
      return snapshot;
    }
    return function EchoMini({ lifeService, player, lyrics, likes, usePlayer, useUi, openHome, openNow, openLibrary, setMiniHidden, setMiniCollapsed }) {
      const state = useLife(lifeService);
      const playback = usePlayer((s) => s);
      const hidden = useUi((s) => s.miniHidden || s.dockVisible);
      const collapsed = useUi((s) => !!s.miniCollapsed);
      const lyricState = useSource(lyrics?.source);
      useSource(likes?.source);
      const { track: track2, playing, loading, position: playPosition = 0, duration = 0, volume = 1, muted, queue = [], queueIndex = -1, shuffle, repeat, error } = playback;
      const trackKey2 = identity2(track2);
      const [position, setPosition] = useState(() => {
        const saved = preference(POSITION_KEY, null);
        return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
      });
      const [musicOpen, setMusicOpen] = useState(false);
      const [more, setMore] = useState(false);
      const [showQueue, setShowQueue] = useState(false);
      const [showLyrics, setShowLyrics] = useState(() => preference(LYRICS_KEY, false) === true);
      const [paper, setPaper] = useState(null);
      const [gesture, setGesture] = useState(0);
      const [feedback, setFeedback] = useState(null);
      const [undo, setUndo] = useState(null);
      const [busy, setBusy] = useState(null);
      const [seekDraft, setSeekDraft] = useState(null);
      const [placement, setPlacement] = useState(null);
      const [paperPlacement, setPaperPlacement] = useState(null);
      const [tone, setTone] = useState("light");
      const miniRef = useRef(null), menuRef = useRef(null), paperRef = useRef(null), musicRef = useRef(null), moreRef = useRef(null), queueRef = useRef(null);
      const positionRef = useRef(position), drag = useRef(null), touchAt = useRef(0), feedbackRef = useRef(null);
      const operation = useRef(null), mounted = useRef(true), greetingTimer = useRef(null);
      const redrawRef = useRef(null);
      const life = state.life;
      const name = life?.name && life.name !== "\u672A\u547D\u540D" ? life.name : "\u4F60\u7684\u97F3\u7075";
      const liked = !!(track2 && likes?.isLiked(track2)), disliked = !!(track2 && likes?.isDisliked(track2));
      const modeName = shuffle ? "\u968F\u673A\u64AD\u653E" : repeat === "one" ? "\u5355\u66F2\u5FAA\u73AF" : "\u987A\u5E8F\u64AD\u653E";
      function anchorBox() {
        const box = miniRef.current?.getBoundingClientRect();
        if (box?.width && box?.height) return box;
        const width = Math.min(320, window.innerWidth - 24), height = width * 388 / 496 + 62;
        const left = positionRef.current?.x ?? Math.max(12, window.innerWidth - width - 20);
        const top = positionRef.current?.y ?? Math.max(12, window.innerHeight - height - 20);
        return { left, top, width, height, right: left + width, bottom: top + height };
      }
      function redraw() {
        if (!miniRef.current) return;
        const anchor = anchorBox(), viewport = { width: window.innerWidth, height: window.innerHeight };
        const next = companionPlacement(anchor, { width: 286, height: menuRef.current?.offsetHeight || 240 }, viewport);
        setPlacement((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        const width = Math.min(280, window.innerWidth - 24), height = Math.min(paperRef.current?.offsetHeight || 88, window.innerHeight - 24);
        const sheet = { left: bounded(anchor.left + (anchor.width - width) / 2, 12, window.innerWidth - width - 12), top: bounded(anchor.top - height - 10, 12, window.innerHeight - height - 12), width, maxHeight: Math.max(80, window.innerHeight - 24) };
        setPaperPlacement((previous) => JSON.stringify(previous) === JSON.stringify(sheet) ? previous : sheet);
      }
      redrawRef.current = redraw;
      function moveTo(next) {
        const box = anchorBox();
        const value = { x: bounded(next.x, 0, window.innerWidth - box.width), y: bounded(next.y, 0, window.innerHeight - box.height) };
        positionRef.current = value;
        setPosition(value);
      }
      useEffect(() => {
        mounted.current = true;
        const move = (event) => {
          const current = drag.current;
          if (!current || event.pointerId != null && current.pointerId !== event.pointerId) return;
          if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
          current.moved = true;
          moveTo({ x: event.clientX - current.x, y: event.clientY - current.y });
        };
        const end = () => {
          if (drag.current?.moved) remember(POSITION_KEY, positionRef.current);
          drag.current = null;
        };
        const resize = () => {
          if (positionRef.current) {
            moveTo(positionRef.current);
            remember(POSITION_KEY, positionRef.current);
          }
          redrawRef.current?.();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("resize", resize);
        const media = window.matchMedia?.("(prefers-color-scheme: dark)");
        const appearance = () => setTone(media?.matches ? "dark" : "light");
        appearance();
        media?.addEventListener?.("change", appearance);
        return () => {
          mounted.current = false;
          clearTimeout(greetingTimer.current);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          window.removeEventListener("resize", resize);
          media?.removeEventListener?.("change", appearance);
        };
      }, []);
      useBeforePaint(() => {
        if (!hidden && life) {
          if (positionRef.current) moveTo(positionRef.current);
          redraw();
        }
      }, [hidden, !!life, collapsed, position?.x, position?.y, musicOpen, more, showQueue, showLyrics, paper, feedback, busy, error, loading]);
      useEffect(() => {
        if (!hidden) return;
        setMusicOpen(false);
        setMore(false);
        setShowQueue(false);
        setSeekDraft(null);
        setPaper(null);
        clearTimeout(greetingTimer.current);
      }, [hidden]);
      useEffect(() => {
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => redrawRef.current?.());
        [miniRef.current, menuRef.current, paperRef.current].forEach((node) => {
          if (node) observer.observe(node);
        });
        return () => observer.disconnect();
      }, [hidden, musicOpen, paper, showLyrics]);
      useEffect(() => {
        setSeekDraft(null);
        if (paper?.kind === "greeting") setPaper(null);
      }, [trackKey2]);
      useEffect(() => {
        if (showLyrics && track2?.id && lyrics) Promise.resolve(lyrics.load(track2.id)).catch(() => {
        });
      }, [showLyrics, track2?.id, lyrics]);
      function closeMusic(restore = true) {
        setMusicOpen(false);
        setMore(false);
        setShowQueue(false);
        setSeekDraft(null);
        if (restore) musicRef.current?.focus();
      }
      function say(message, failed = false) {
        if (mounted.current) setFeedback({ message, failed });
      }
      function touch() {
        const now = Date.now();
        if (now - touchAt.current < 1200) return;
        touchAt.current = now;
        setGesture((value) => value + 1);
        setPaper({ kind: "greeting", title: name, text: playing ? "\u5728\u5462\uFF0C\u4E00\u8D77\u542C\u3002" : "\u5728\u5462\uFF0C\u966A\u4F60\u5B89\u9759\u4E00\u4F1A\u513F\u3002" });
        clearTimeout(greetingTimer.current);
        greetingTimer.current = setTimeout(() => {
          if (mounted.current) setPaper((current) => current?.kind === "greeting" ? null : current);
        }, 2600);
        lifeService.dispatch("interaction", { action: life?.greeting ? "greet" : "touch" }).catch((problem) => {
          if (problem.queued) return;
          if (mounted.current) setPaper({ kind: "error", title: "\u8FD9\u6B21\u56DE\u5E94\u6682\u672A\u4FDD\u5B58", text: problem.message || "\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
        });
      }
      function readMemory(id) {
        const memory = life?.memories?.find((item) => item.id === id);
        if (!memory) return;
        clearTimeout(greetingTimer.current);
        closeMusic(false);
        setPaper({ kind: "memory", title: memory.title, text: memory.note || "\u4F60\u4EEC\u628A\u8FD9\u4E00\u523B\u7559\u4E86\u4E0B\u6765\u3002", memory });
      }
      async function preferenceAction(item, action) {
        if (!item || !likes || operation.current) return;
        const key = identity2(item);
        operation.current = key;
        setBusy({ key, title: item.title });
        try {
          await action();
        } catch (problem) {
          say(`\u300A${item.title || "\u8FD9\u9996\u6B4C"}\u300B\u7684\u504F\u597D\u672A\u80FD\u4FDD\u5B58\uFF1A${problem.message || "\u8BF7\u91CD\u8BD5"}`, true);
        } finally {
          operation.current = null;
          if (mounted.current) setBusy(null);
        }
      }
      async function checked(result) {
        const value = await result;
        if (value?.error) throw new Error(value.error);
        return value || {};
      }
      function toggleLike() {
        const item = { ...track2 }, wasLiked = likes?.isLiked(track2);
        return preferenceAction(item, async () => {
          const result = await checked(likes.toggle(item, !wasLiked));
          if (!mounted.current) return;
          setUndo((old) => identity2(old?.track) === identity2(item) ? null : old);
          say(result.message || (wasLiked ? `\u5DF2\u53D6\u6D88\u559C\u6B22\u300A${item.title}\u300B\u3002` : result.downloading ? `\u5DF2\u559C\u6B22\u300A${item.title}\u300B\uFF0C\u6B63\u5728\u52A0\u5165\u66F2\u5E93\u3002` : `\u5DF2\u559C\u6B22\u300A${item.title}\u300B\u3002`));
        });
      }
      function toggleDislike() {
        const item = { ...track2 }, before = likes?.isDisliked(track2) ? "dislike" : likes?.isLiked(track2) ? "like" : null;
        return preferenceAction(item, async () => {
          await checked(likes.setDislike(item, before !== "dislike"));
          if (before === "dislike") {
            if (mounted.current) {
              setUndo((old) => identity2(old?.track) === identity2(item) ? null : old);
              say(`\u5DF2\u53D6\u6D88\u5BF9\u300A${item.title}\u300B\u7684\u4E0D\u559C\u6B22\u3002`);
            }
            return;
          }
          let outcome = "\u8FD9\u6B21\u6CA1\u6709\u6253\u65AD\u4F60\u540E\u6765\u9009\u62E9\u7684\u6B4C\u66F2";
          const latest = player.source.getSnapshot();
          if (identity2(latest.track) === identity2(item)) {
            const list = latest.queue || [];
            let candidate = -1;
            for (let step = 1; step <= list.length; step++) {
              const index = ((latest.queueIndex || 0) + step) % list.length;
              if (identity2(list[index]) !== identity2(item) && !likes.isDisliked(list[index])) {
                candidate = index;
                break;
              }
            }
            if (candidate >= 0) {
              player.jumpTo(candidate);
              outcome = "\u5DF2\u5207\u6362\u4E0B\u4E00\u9996";
            } else {
              if (player.pause) player.pause();
              else if (latest.playing) player.toggle();
              outcome = "\u961F\u5217\u91CC\u6CA1\u6709\u5176\u4ED6\u53EF\u64AD\u653E\u7684\u6B4C\uFF0C\u5DF2\u6682\u505C";
            }
          }
          if (mounted.current) {
            setUndo({ track: item, before });
            say(`\u5DF2\u5C06\u300A${item.title}\u300B\u6807\u8BB0\u4E3A\u4E0D\u559C\u6B22\u3002${outcome}\u3002`);
          }
        });
      }
      function undoDislike() {
        if (!undo) return;
        const original = undo;
        if (!likes?.isDisliked(original.track)) {
          setUndo(null);
          say(`\u300A${original.track.title}\u300B\u7684\u504F\u597D\u5DF2\u66F4\u65B0\uFF0C\u5DF2\u4FDD\u7559\u4F60\u7684\u65B0\u9009\u62E9\u3002`);
          return;
        }
        return preferenceAction(original.track, async () => {
          await checked(likes.setDislike(original.track, false));
          if (original.before === "like") {
            try {
              await checked(likes.toggle({ ...original.track, verification: void 0 }, true));
            } catch (problem) {
              throw new Error(`\u4E0D\u559C\u6B22\u5DF2\u64A4\u9500\uFF0C\u539F\u6765\u7684\u559C\u6B22\u5C1A\u672A\u6062\u590D\uFF1A${problem.message}`);
            }
          }
          if (mounted.current) {
            setUndo(null);
            say(`\u5DF2\u6062\u590D\u300A${original.track.title}\u300B\u7684\u539F\u504F\u597D\uFF0C\u7EE7\u7EED\u5F53\u524D\u64AD\u653E\u3002`);
          }
        });
      }
      function commitSeek() {
        if (seekDraft != null) {
          player.seek(seekDraft);
          setSeekDraft(null);
        }
      }
      function iconButton(label, icon, onClick, extra = {}) {
        return h("button", { type: "button", "aria-label": label, title: label, onClick, ...extra }, h(Icon, { name: icon, size: extra.size || 17 }));
      }
      function playButton(className) {
        return iconButton(playing ? "\u6682\u505C" : "\u64AD\u653E", loading ? "loading" : playing ? "pause" : "play", player.toggle, { className, disabled: !track2, "aria-busy": !!loading });
      }
      if (!life || hidden) return null;
      const currentLyrics = lyricState.trackId === track2?.id ? lyricState : null;
      let displayedPaper = paper;
      if (!displayedPaper && showLyrics && track2) {
        const data = currentLyrics?.data;
        if (currentLyrics?.status === "error") displayedPaper = { kind: "lyric-error", title: "\u6B4C\u8BCD\u6682\u672A\u53D6\u5F97", text: currentLyrics.error || "\u53EF\u4EE5\u7A0D\u540E\u91CD\u8BD5\u3002" };
        else if (!currentLyrics || currentLyrics.status === "loading") displayedPaper = { kind: "lyrics", title: track2.title, text: "\u6B63\u5728\u67E5\u627E\u6B4C\u8BCD\u2026" };
        else if (data?.synced && data.lines?.length) {
          const line = [...data.lines].reverse().find((item) => Number.isFinite(item.time) && playPosition + 0.2 >= item.time);
          displayedPaper = { kind: "lyrics", title: track2.title, text: line?.text || track2.title };
        } else displayedPaper = { kind: data?.plain ? "plain-lyrics" : "lyrics", title: track2.title, text: data?.plain ? "\u8FD9\u9996\u6B4C\u53EA\u6709\u672A\u540C\u6B65\u6B4C\u8BCD\u3002" : data?.message || "\u6682\u65F6\u6CA1\u6709\u8FD9\u9996\u6B4C\u7684\u6B4C\u8BCD\u3002" };
      }
      const paperVisible = displayedPaper && (!musicOpen || placement?.side !== "stack");
      const menuStyle = placement ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight } : void 0;
      const count = queue.length;
      const libraryTrack = /^[a-f0-9]{16}$/.test(String(track2?.id || ""));
      const likeLabel = liked ? "\u53D6\u6D88\u559C\u6B22\u8FD9\u9996\u6B4C" : libraryTrack ? "\u559C\u6B22\u8FD9\u9996\u6B4C" : track2?.verification ? "\u559C\u6B22\u5E76\u52A0\u5165\u66F2\u5E93" : "\u559C\u6B22\u8FD9\u9996\u6B4C\uFF08\u6682\u4E0D\u5165\u5E93\uFF09";
      return h(
        "aside",
        {
          ref: miniRef,
          className: `echo-mini echo-mini-presence ${collapsed ? "is-compact" : ""}`,
          "aria-label": "\u97F3\u7075\u4F34\u751F\u7A97",
          "data-tone": tone,
          style: position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : void 0,
          onKeyDown: (event) => {
            if (event.key !== "Escape") return;
            if (showQueue) {
              setShowQueue(false);
              queueRef.current?.focus();
              event.preventDefault();
            } else if (more) {
              setSeekDraft(null);
              setMore(false);
              moreRef.current?.focus();
              event.preventDefault();
            } else if (musicOpen) {
              closeMusic();
              event.preventDefault();
            } else if (paper) {
              setPaper(null);
              event.preventDefault();
            }
          }
        },
        h("button", {
          type: "button",
          className: "echo-mini-grip",
          title: "\u62D6\u52A8\u4F34\u751F\u7A97\uFF0C\u6216\u7528\u65B9\u5411\u952E\u79FB\u52A8",
          "aria-label": "\u79FB\u52A8\u4F34\u751F\u7A97\uFF0C\u4F7F\u7528\u65B9\u5411\u952E",
          onPointerDown: (event) => {
            if (event.button !== 0) return;
            const box = anchorBox();
            drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX - box.left, y: event.clientY - box.top, moved: false };
            event.preventDefault();
          },
          onKeyDown: (event) => {
            const delta = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[event.key];
            if (!delta) return;
            event.preventDefault();
            const box = anchorBox();
            moveTo({ x: box.left + delta[0], y: box.top + delta[1] });
            remember(POSITION_KEY, positionRef.current);
          }
        }, h("i"), h("i"), h("i")),
        h(
          "div",
          { className: "echo-mini-creature" },
          h(Creature, { life, morphology: state.morphology, framing: "presence", compact: collapsed || !!track2 && !playing, active: playing && !loading && !error && !collapsed, gesture, onTouch: touch, onMemorySelect: readMemory, label: name, tone }),
          life.memories?.length ? iconButton("\u56DE\u770B\u6700\u8FD1\u5171\u540C\u8BB0\u5FC6", "memory", () => readMemory(life.memories.at(-1).id), { className: "echo-mini-memory-button" }) : null
        ),
        h(
          "div",
          { className: "echo-mini-foot", role: "group", "aria-label": "\u968F\u624B\u63A7\u5236\u97F3\u4E50" },
          track2 ? playButton("echo-mini-quiet") : iconButton("\u9009\u4E00\u9996\u6B4C", "play", openLibrary || openNow || openHome, { className: "echo-mini-quiet" }),
          iconButton("\u4E0B\u4E00\u9996", "next", player.next, { className: "echo-mini-quiet", disabled: !track2 || !count }),
          h("button", { type: "button", className: "echo-mini-music", ref: musicRef, onClick: () => musicOpen ? closeMusic(false) : setMusicOpen(true), "aria-label": "\u97F3\u4E50\u64CD\u4F5C", "aria-expanded": musicOpen }, h(Icon, { name: "sound", size: 16 }), h("span", null, "\u97F3\u4E50"))
        ),
        error && !musicOpen ? h("button", { type: "button", className: "echo-mini-playback-status is-error", onClick: () => setMusicOpen(true) }, "\u64AD\u653E\u5931\u8D25\uFF0C\u67E5\u770B\u539F\u56E0") : loading && !musicOpen ? h("div", { className: "echo-mini-playback-status", role: "status" }, "\u6B63\u5728\u52A0\u8F7D\u97F3\u4E50\u2026") : null,
        paperVisible ? h(
          "section",
          { ref: paperRef, className: `echo-mini-paper is-${displayedPaper.kind}`, style: paperPlacement || void 0, "aria-label": displayedPaper.kind === "memory" ? "\u5171\u540C\u8BB0\u5FC6" : displayedPaper.kind === "greeting" ? "\u97F3\u7075\u7684\u56DE\u5E94" : "\u4F34\u968F\u6B4C\u8BCD" },
          h("div", { className: "echo-mini-paper-title" }, displayedPaper.title),
          h("p", null, displayedPaper.text),
          displayedPaper.memory?.track ? h("small", null, `${displayedPaper.memory.track.title || "\u97F3\u4E50"}${displayedPaper.memory.track.artist ? ` \xB7 ${displayedPaper.memory.track.artist}` : ""}`) : null,
          displayedPaper.kind === "lyric-error" ? h("button", { type: "button", className: "echo-mini-text", onClick: () => lyrics?.load(track2.id) }, "\u91CD\u8BD5\u6B4C\u8BCD") : null,
          displayedPaper.kind === "plain-lyrics" ? h("button", { type: "button", className: "echo-mini-text", onClick: openNow }, "\u6253\u5F00\u5B8C\u6574\u6B4C\u8BCD") : null,
          iconButton("\u6536\u8D77\u7EB8\u6761", "close", () => {
            if (paper) setPaper(null);
            else {
              setShowLyrics(false);
              remember(LYRICS_KEY, false);
            }
            musicRef.current?.focus();
          }, { className: "echo-mini-paper-close" })
        ) : null,
        musicOpen ? h(
          "section",
          { ref: menuRef, className: "echo-mini-tools", style: menuStyle, "aria-label": "\u4F34\u751F\u97F3\u4E50\u64CD\u4F5C" },
          h("div", { className: "echo-mini-tools-head" }, h("div", null, h("strong", null, track2?.title || "\u4E00\u8D77\u542C\u70B9\u4EC0\u4E48"), h("small", null, track2?.artist || "\u4ECE\u4F60\u7684\u97F3\u4E50\u5F00\u59CB")), iconButton("\u6536\u8D77\u97F3\u4E50\u64CD\u4F5C", "close", () => closeMusic(), { className: "echo-mini-close" })),
          h("div", { className: "echo-mini-transport", role: "group", "aria-label": "\u64AD\u653E\u63A7\u5236" }, iconButton("\u4E0A\u4E00\u9996", "previous", player.prev, { disabled: !track2 }), playButton("echo-mini-play-main"), iconButton("\u4E0B\u4E00\u9996", "next", player.next, { disabled: !track2 || !count })),
          !track2 ? h("button", { type: "button", className: "echo-mini-select-track", onClick: openLibrary || openNow || openHome }, "\u9009\u4E00\u9996\u6B4C") : null,
          loading ? h("p", { className: "echo-mini-hint", role: "status" }, "\u6B63\u5728\u52A0\u8F7D\u97F3\u4E50\u2026") : null,
          error ? h("div", { className: "echo-mini-error", role: "alert" }, h("p", null, error), h("button", { type: "button", onClick: player.play || player.toggle }, "\u91CD\u8BD5\u64AD\u653E")) : null,
          h(
            "div",
            { className: "echo-mini-actions" },
            h("button", { type: "button", disabled: !track2 || !likes || !!busy, onClick: toggleLike, "aria-pressed": liked, "aria-label": likeLabel, title: likeLabel }, h(Icon, { name: "heart", size: 17 }), h("span", null, liked ? "\u5DF2\u559C\u6B22" : "\u559C\u6B22")),
            h("button", { type: "button", disabled: !track2 || !likes || !!busy, onClick: toggleDislike, "aria-pressed": disliked, "aria-label": disliked ? "\u53D6\u6D88\u4E0D\u559C\u6B22\u8FD9\u9996\u6B4C" : "\u4E0D\u559C\u6B22\u8FD9\u9996\u6B4C\u5E76\u8DF3\u8FC7", title: disliked ? "\u53D6\u6D88\u4E0D\u559C\u6B22\u8FD9\u9996\u6B4C" : "\u4E0D\u559C\u6B22\u8FD9\u9996\u6B4C\u5E76\u8DF3\u8FC7\uFF0C\u53EF\u64A4\u9500" }, h(Icon, { name: "dislike", size: 17 }), h("span", null, disliked ? "\u5DF2\u6807\u8BB0" : "\u4E0D\u559C\u6B22")),
            h("button", { type: "button", onClick: () => {
              const next = !showLyrics;
              setShowLyrics(next);
              remember(LYRICS_KEY, next);
              setPaper(null);
              closeMusic();
            }, "aria-pressed": showLyrics, "aria-label": showLyrics ? "\u5173\u95ED\u4F34\u968F\u6B4C\u8BCD" : "\u663E\u793A\u4F34\u968F\u6B4C\u8BCD" }, h(Icon, { name: "lyrics", size: 17 }), h("span", null, "\u6B4C\u8BCD")),
            h("button", { type: "button", ref: moreRef, onClick: () => {
              setMore((value) => !value);
              setShowQueue(false);
            }, "aria-expanded": more, "aria-label": "\u66F4\u591A\u64AD\u653E\u64CD\u4F5C" }, h(Icon, { name: "more", size: 17 }), h("span", null, "\u66F4\u591A"))
          ),
          busy ? h("p", { className: "echo-mini-hint", role: "status" }, `\u6B63\u5728\u4FDD\u5B58\u300A${busy.title || "\u8FD9\u9996\u6B4C"}\u300B\u7684\u504F\u597D\u2026`) : null,
          feedback ? h("div", { ref: feedbackRef, className: `echo-mini-feedback ${feedback.failed ? "is-error" : ""}`, role: feedback.failed ? "alert" : "status" }, h("p", null, feedback.message), undo ? h("button", { type: "button", onClick: undoDislike, disabled: !!busy }, `\u64A4\u9500\u5BF9\u300A${undo.track.title}\u300B\u7684\u4E0D\u559C\u6B22`) : null) : null,
          more ? h(
            "div",
            { className: "echo-mini-more" },
            h("label", { className: "echo-mini-range" }, h("span", null, "\u8FDB\u5EA6", h("time", null, `${formatTime2(seekDraft ?? playPosition)} / ${formatTime2(duration)}`)), h("input", { type: "range", min: 0, max: duration || 1, step: 0.1, value: Math.min(seekDraft ?? playPosition, duration || 1), disabled: !track2 || !duration, "aria-label": "\u4F34\u751F\u64AD\u653E\u8FDB\u5EA6", onChange: (event) => setSeekDraft(Number(event.target.value)), onPointerUp: commitSeek, onKeyUp: commitSeek, onBlur: commitSeek })),
            h("div", { className: "echo-mini-volume" }, iconButton(muted ? "\u53D6\u6D88\u9759\u97F3" : "\u9759\u97F3", "sound", player.toggleMute, { "aria-pressed": !!muted }), h("input", { type: "range", min: 0, max: 1, step: 0.01, value: muted ? 0 : volume, onChange: (event) => player.setVolume(Number(event.target.value)), "aria-label": "\u4F34\u751F\u97F3\u91CF" })),
            h("div", { className: "echo-mini-secondary" }, h("button", { type: "button", onClick: player.cycleMode, "aria-label": `\u64AD\u653E\u6A21\u5F0F\uFF1A${modeName}` }, modeName), h("button", { type: "button", ref: queueRef, onClick: () => setShowQueue((value) => !value), "aria-expanded": showQueue }, `\u961F\u5217 \xB7 ${count}`)),
            showQueue ? h("ol", { className: "echo-mini-queue", "aria-label": "\u5F53\u524D\u64AD\u653E\u961F\u5217" }, queue.map((item, index) => h("li", { key: `${identity2(item)}-${index}` }, h("button", { type: "button", "aria-current": index === queueIndex ? "true" : void 0, onClick: () => player.jumpTo(index) }, h("span", null, item.title || "\u672A\u547D\u540D\u97F3\u4E50"), h("small", null, item.artist || ""))))) : null,
            h("div", { className: "echo-mini-window-actions" }, h("button", { type: "button", onClick: () => setMiniCollapsed(!collapsed), "aria-label": collapsed ? "\u5C55\u5F00\u4F34\u751F\u7A97" : "\u6536\u62E2\u4F34\u751F\u7A97" }, h(Icon, { name: collapsed ? "sun" : "moon", size: 15 }), collapsed ? "\u8212\u5C55\u8EAB\u4F53" : "\u5B89\u9759\u6816\u606F"), h("button", { type: "button", onClick: openHome }, "\u56DE\u5230\u4E3B\u821E\u53F0"), h("button", { type: "button", onClick: () => setMiniHidden(true), "aria-label": "\u9690\u85CF\u4F34\u751F\u7A97", title: "\u9690\u85CF\u4F34\u751F\u7A97\uFF0C\u97F3\u4E50\u7EE7\u7EED\u64AD\u653E" }, "\u9690\u85CF\u4F34\u751F\u7A97"))
          ) : null
        ) : null
      );
    };
  }

  // src/client/echo/habitat.js
  var SCENES = { home: "encounter", library: "search", reco: "discover", "echo-memory": "memory", now: "listening" };
  var UTILITIES = {
    "library-manage": "\u7BA1\u7406\u66F2\u5E93",
    "reco-manage": "\u5728\u7EBF\u53D1\u73B0",
    studio: "\u7B56\u5C55",
    history: "\u8046\u542C\u5386\u53F2",
    artist: "\u97F3\u4E50\u4EBA",
    "echo-gallery": "\u751F\u547D\u5F62\u6001\u793A\u4F8B",
    welcome: "\u97F3\u4E50\u6765\u6E90",
    command: "\u97F3\u4E50\u6307\u4EE4",
    "now-manage": "\u5B8C\u6574\u6B4C\u8BCD\u4E0E\u961F\u5217"
  };
  var normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().trim();
  var trackKey = (track2) => String(track2?.id || `${track2?.artist || ""}::${track2?.title || ""}`);
  var sameTrack = (a, b) => !!a && !!b && trackKey(a) === trackKey(b);
  function readPreference(key, fallback) {
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }
  function storePreference(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
    }
  }
  function createHabitatComponent(React, { Creature, Icon, useLife, EditDialog, GreetingDialog, MemoryDialog, Status, EmptyLife, formatTime: formatTime2, shortDate: shortDate2, downloadJSON: downloadJSON2 }) {
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;
    function QuietButton({ icon, children, className = "", ...props }) {
      return h("button", { type: "button", className: `eh-action ${className}`, ...props }, icon ? h(Icon, { name: icon, size: 17 }) : null, children);
    }
    return function EchoHabitat({ lifeService, player, library, lyrics, likes, usePlayer, useLibrary, useLyrics, useLikes, openView, openArtistPage, setMiniHidden, renderUtility, requestedView = "home", commandRequest = 0 }) {
      const state = useLife(lifeService);
      const playback = usePlayer((s) => s);
      const collection = useLibrary((s) => s);
      const lyricState = useLyrics((s) => s);
      const taste = useLikes((s) => s);
      const [query, setQuery] = useState("");
      const [limit, setLimit] = useState(40);
      const [discoveryOffset, setDiscoveryOffset] = useState(0);
      const [dialog, setDialog] = useState(null);
      const [menu, setMenu] = useState(false);
      const [resting, setResting] = useState(false);
      const [gesture, setGesture] = useState(0);
      const [reviewIndex, setReviewIndex] = useState(null);
      const [feedback, setFeedback] = useState(null);
      const [preferencePending, setPreferencePending] = useState(false);
      const [undo, setUndo] = useState(null);
      const [seekDraft, setSeekDraft] = useState(null);
      const [tone, setTone] = useState(() => readPreference("dsh-music.echo.habitat-tone", "dark"));
      const [lyricVisible, setLyricVisible] = useState(() => readPreference("dsh-music.echo.habitat-lyrics", "false") === "true");
      const rootRef = useRef(null), searchRef = useRef(null), findRef = useRef(null), menuRef = useRef(null), menuButtonRef = useRef(null), layerRef = useRef(null);
      const touchAt = useRef(0), pendingRef = useRef(false), commandSeen = useRef(commandRequest), seekRef = useRef(null);
      const scene = SCENES[requestedView] || "utility";
      const life = state.life;
      const name = life?.name && life.name !== "\u672A\u547D\u540D" ? life.name : "\u4F60\u7684\u97F3\u7075";
      const { track: track2, playing, loading, position = 0, duration = 0, volume = 1, muted, queue = [], shuffle, repeat, error: playbackError } = playback;
      const tracks = collection.tracks || [];
      const timeline = life?.timeline || [];
      const reviewing = scene === "memory" && reviewIndex != null && !!timeline.length;
      const snapshot = reviewing ? timeline[Math.min(reviewIndex, timeline.length - 1)] : null;
      const selectedMorphology = snapshot?.morphology || state.morphology;
      const tokens = normalize(query).split(/\s+/).filter(Boolean);
      const results = useMemo(() => tracks.filter((item) => {
        const text2 = normalize(`${item.title} ${item.artist} ${item.album || ""}`);
        return tokens.every((token) => text2.includes(token));
      }), [tracks, query]);
      const discoveries = useMemo(() => {
        const available = tracks.filter((item) => item.audioUrl && !likes.isDisliked(item));
        const ordered = [...available.filter((item) => likes.isLiked(item)), ...available.filter((item) => !likes.isLiked(item))];
        if (!ordered.length) return [];
        return Array.from({ length: Math.min(3, ordered.length) }, (_, i) => ordered[(discoveryOffset * 3 + i) % ordered.length]);
      }, [tracks, taste, discoveryOffset, likes]);
      const liked = !!track2 && likes.isLiked(track2), disliked = !!track2 && likes.isDisliked(track2);
      const currentLyrics = track2 && lyricState.trackId === track2.id ? lyricState : null;
      const lyricData = currentLyrics?.data;
      let activeLine = "";
      if (lyricData?.synced && lyricData.lines?.length) {
        for (const line of lyricData.lines) {
          if (line.time > position + 0.2) break;
          if (line.text?.trim()) activeLine = line.text;
        }
      }
      function go(route) {
        setMenu(false);
        if (route !== "echo-memory") setReviewIndex(null);
        openView(route);
      }
      function returnHome() {
        go("home");
        window.setTimeout(() => findRef.current?.focus(), 0);
      }
      function report(message, isError = false) {
        setFeedback({ message, isError });
      }
      function action(fn) {
        try {
          Promise.resolve(fn()).catch((err) => report(err.message || "\u8FD9\u6B21\u64CD\u4F5C\u672A\u80FD\u5B8C\u6210\u3002", true));
        } catch (err) {
          report(err.message || "\u8FD9\u6B21\u64CD\u4F5C\u672A\u80FD\u5B8C\u6210\u3002", true);
        }
      }
      useEffect(() => {
        if (collection.status === "idle") action(() => library.load());
        if (!taste.loaded && likes.load) action(() => likes.load());
      }, [library, likes]);
      useEffect(() => {
        if (scene !== "memory") setReviewIndex(null);
      }, [scene]);
      useEffect(() => {
        seekRef.current = null;
        setSeekDraft(null);
      }, [track2?.id]);
      useEffect(() => {
        if (scene === "encounter") return;
        const id = window.setTimeout(() => {
          if (scene === "search") searchRef.current?.focus();
          else layerRef.current?.querySelector("[data-eh-heading]")?.focus();
        }, 0);
        return () => window.clearTimeout(id);
      }, [scene, requestedView]);
      useEffect(() => {
        if (commandSeen.current === commandRequest) return;
        commandSeen.current = commandRequest;
        setMenu(false);
        setDialog(null);
        if (scene !== "search") openView("library");
        const id = window.setTimeout(() => searchRef.current?.focus(), 0);
        return () => window.clearTimeout(id);
      }, [commandRequest, scene, openView]);
      useEffect(() => {
        if (!menu) return;
        const outside = (event) => {
          if (!menuRef.current?.contains(event.target) && !menuButtonRef.current?.contains(event.target)) setMenu(false);
        };
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
      }, [menu]);
      useEffect(() => {
        storePreference("dsh-music.echo.habitat-lyrics", String(lyricVisible));
        if (lyricVisible && track2?.id) action(() => lyrics.load(track2.id));
      }, [lyricVisible, track2?.id, lyrics]);
      useEffect(() => {
        storePreference("dsh-music.echo.habitat-tone", tone);
      }, [tone]);
      useEffect(() => {
        if (!feedback || feedback.isError) return;
        const id = window.setTimeout(() => setFeedback(null), 7e3);
        return () => window.clearTimeout(id);
      }, [feedback]);
      async function save(type, payload) {
        try {
          await lifeService.dispatch(type, payload);
          report(type === "rename" ? "\u5B83\u8BB0\u4F4F\u4E86\u8FD9\u4E2A\u540D\u5B57\u3002" : type === "greeting" ? "\u5B83\u8BB0\u4F4F\u4E86\u4F60\u4EEC\u7684\u62DB\u547C\u3002" : "\u8FD9\u4E00\u523B\uFF0C\u5DF2\u7ECF\u7559\u4E0B\u3002");
        } catch (err) {
          if (!err.queued) throw err;
          report("\u8FD9\u6BB5\u7ECF\u5386\u5DF2\u5728\u672C\u673A\u6682\u5B58\uFF0C\u8FDE\u63A5\u6062\u590D\u540E\u4F1A\u7EE7\u7EED\u4FDD\u5B58\u3002");
        }
      }
      function touch() {
        if (reviewing || Date.now() - touchAt.current < 1200) return;
        touchAt.current = Date.now();
        setGesture((value) => value + 1);
        action(() => lifeService.dispatch("interaction", { action: life?.greeting ? "greet" : "touch" }));
      }
      function greet() {
        setMenu(false);
        if (!life?.greeting) setDialog({ kind: "greeting" });
        else {
          setGesture((value) => value + 1);
          action(() => lifeService.dispatch("interaction", { action: "greet" }));
        }
      }
      function rest() {
        setResting((value) => !value);
        setMenu(false);
        if (!resting) action(() => lifeService.dispatch("interaction", { action: "rest" }));
      }
      function playSelection(list, index) {
        const playable = list.filter((item) => item.audioUrl), selected = list[index], playableIndex = playable.indexOf(selected);
        if (playableIndex < 0) {
          report("\u8FD9\u9996\u6B4C\u6682\u65F6\u6CA1\u6709\u53EF\u64AD\u653E\u7684\u97F3\u9891\u3002\u53EF\u4EE5\u5728\u66F2\u5E93\u7BA1\u7406\u4E2D\u91CD\u65B0\u626B\u63CF\u3002", true);
          return;
        }
        action(async () => {
          await player.playTracks(playable, playableIndex, { shuffle: false, ordered: true });
          go("home");
        });
      }
      function commitSeek() {
        const draft = seekRef.current;
        seekRef.current = null;
        setSeekDraft(null);
        if (draft && sameTrack(player.source.getSnapshot().track, draft.track)) action(() => player.seek(draft.value));
      }
      async function preference2(kind) {
        if (!track2 || pendingRef.current) return;
        const original = track2, before = likes.isLiked(original) ? "like" : likes.isDisliked(original) ? "dislike" : "none";
        const target = kind === "like" ? before !== "like" : before !== "dislike";
        pendingRef.current = true;
        setPreferencePending(true);
        try {
          const result = kind === "like" ? await likes.toggle(original, target) : await likes.setDislike(original, target);
          if (result?.error) throw new Error(result.error);
          if (kind === "dislike" && target) {
            setUndo({ track: original, before });
            const current = player.source.getSnapshot();
            if (sameTrack(current.track, original)) {
              let next = -1;
              for (let step = 1; step <= current.queue.length; step++) {
                const index = (current.queueIndex + step) % current.queue.length, candidate = current.queue[index];
                if (!sameTrack(candidate, original) && !likes.isDisliked(candidate)) {
                  next = index;
                  break;
                }
              }
              if (next >= 0) {
                player.jumpTo(next);
                report(`\u4E0D\u559C\u6B22\u5DF2\u4FDD\u5B58\uFF0C\u5DF2\u8DF3\u8FC7\u300A${original.title}\u300B\u3002`);
              } else {
                player.pause();
                report("\u4E0D\u559C\u6B22\u5DF2\u4FDD\u5B58\u3002\u961F\u5217\u91CC\u6CA1\u6709\u5176\u4ED6\u53EF\u64AD\u653E\u7684\u6B4C\uFF0C\u5DF2\u6682\u505C\u3002");
              }
            } else report("\u4E0D\u559C\u6B22\u5DF2\u4FDD\u5B58\uFF0C\u6CA1\u6709\u6253\u65AD\u4F60\u540E\u6765\u9009\u62E9\u7684\u6B4C\u3002");
          } else {
            setUndo(null);
            report(result?.downloading ? "\u559C\u6B22\u5DF2\u4FDD\u5B58\uFF0C\u6B63\u5728\u52A0\u5165\u66F2\u5E93\uFF1B\u5165\u5E93\u7ED3\u679C\u53EF\u5728\u66F2\u5E93\u7BA1\u7406\u67E5\u770B\u3002" : result?.message || (target ? "\u559C\u6B22\u5DF2\u4FDD\u5B58\u3002" : "\u5DF2\u53D6\u6D88\u8FD9\u9879\u504F\u597D\u3002"));
          }
        } catch (err) {
          report(`\u504F\u597D\u672A\u80FD\u4FDD\u5B58\uFF1A${err.message}`, true);
        } finally {
          pendingRef.current = false;
          setPreferencePending(false);
        }
      }
      async function undoPreference() {
        if (!undo || pendingRef.current) return;
        const original = undo;
        if (!likes.isDisliked(original.track)) {
          setUndo(null);
          report("\u8FD9\u9996\u6B4C\u7684\u504F\u597D\u5DF2\u66F4\u65B0\u3002");
          return;
        }
        pendingRef.current = true;
        setPreferencePending(true);
        try {
          const result = original.before === "like" ? await likes.toggle({ ...original.track, verification: void 0 }, true) : await likes.setDislike(original.track, false);
          if (result?.error) throw new Error(result.error);
          setUndo(null);
          report("\u5DF2\u6062\u590D\u539F\u6765\u7684\u504F\u597D\uFF0C\u5F53\u524D\u64AD\u653E\u4FDD\u6301\u4E0D\u53D8\u3002");
        } catch (err) {
          report(`\u6682\u672A\u64A4\u9500\uFF1A${err.message}`, true);
        } finally {
          pendingRef.current = false;
          setPreferencePending(false);
        }
      }
      function readMemory(id) {
        const memory = life?.memories?.find((item) => item.id === id);
        if (memory) setDialog({ kind: "read", memory });
      }
      function onKeyDown(event) {
        if (event.key === "Escape" && !dialog) {
          event.preventDefault();
          if (menu) {
            setMenu(false);
            menuButtonRef.current?.focus();
          } else if (scene !== "encounter") returnHome();
        }
        if (event.key === "Tab" && scene === "utility" && !dialog && layerRef.current) {
          const focusable = [...layerRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')].filter((node) => !node.closest("[hidden]"));
          const first = focusable[0], last = focusable.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement?.hasAttribute("data-eh-heading"))) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }
      function openDialog(kind) {
        setMenu(false);
        setDialog({ kind });
      }
      function heading(title, note) {
        return h(
          "header",
          { className: "eh-context-heading" },
          h("div", null, h("h2", { tabIndex: -1, "data-eh-heading": true }, title), note ? h("p", null, note) : null),
          h(QuietButton, { icon: "close", onClick: returnHome, "aria-label": "\u56DE\u5230\u751F\u547D\u7A7A\u95F4", title: "\u56DE\u5230\u751F\u547D\u7A7A\u95F4" })
        );
      }
      function songRows(list, kind) {
        return h("ol", { className: `eh-song-list eh-song-list-${kind}` }, list.map((item, index) => h(
          "li",
          { key: `${item.id}-${index}` },
          h(
            "button",
            { type: "button", className: "eh-song", disabled: !item.audioUrl, onClick: () => playSelection(kind === "search" ? results : list, index), "aria-label": item.audioUrl ? `\u64AD\u653E ${item.title} \xB7 ${item.artist || "\u672A\u77E5\u97F3\u4E50\u4EBA"}` : `${item.title} \xB7 \u97F3\u9891\u6682\u4E0D\u53EF\u7528` },
            h("span", { className: "eh-song-index", "aria-hidden": true }, sameTrack(item, track2) && playing ? h(Icon, { name: "sound", size: 16 }) : String(index + 1).padStart(2, "0")),
            h("span", { className: "eh-song-copy" }, h("strong", null, item.title || "\u672A\u547D\u540D\u66F2\u76EE"), h("small", null, item.artist || "\u672A\u77E5\u97F3\u4E50\u4EBA", kind === "discover" ? ` \xB7 ${likes.isLiked(item) ? "\u4F60\u559C\u6B22\u7684\u6B4C" : "\u6765\u81EA\u4F60\u7684\u66F2\u5E93"}` : item.album ? ` \xB7 ${item.album}` : "")),
            h("span", { className: "eh-song-tail", "aria-hidden": true }, h("time", null, !item.audioUrl ? "\u97F3\u9891\u4E0D\u53EF\u7528" : item.duration ? formatTime2(item.duration) : ""), h(Icon, { name: "play", size: 15 }))
          )
        )));
      }
      function lyricContent(compact = false) {
        if (!track2) return h("p", { className: "eh-lyric-note" }, "\u5F00\u59CB\u64AD\u653E\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u6B4C\u8BCD\u3002");
        if (!currentLyrics || currentLyrics.status === "loading" || currentLyrics.status === "idle") return h("p", { className: "eh-lyric-note", role: "status" }, "\u6B63\u5728\u5BFB\u627E\u8FD9\u9996\u6B4C\u7684\u6B4C\u8BCD\u2026");
        if (currentLyrics.error || currentLyrics.status === "error") return h("div", { className: "eh-lyric-note", role: "alert" }, h("p", null, currentLyrics.error || "\u6B4C\u8BCD\u6682\u65F6\u672A\u80FD\u8F7D\u5165\u3002"), h(QuietButton, { onClick: () => action(() => lyrics.load(track2.id)) }, "\u91CD\u8BD5\u6B4C\u8BCD"));
        if (lyricData?.synced && lyricData.lines?.length) return h("p", { className: "eh-lyric-line", "aria-label": "\u5F53\u524D\u6B4C\u8BCD" }, activeLine || "\u524D\u594F \xB7 \u7B49\u5F85\u7B2C\u4E00\u53E5");
        if (lyricData?.plain?.trim()) return h("div", { className: "eh-plain-lyrics" }, h("small", null, "\u7EAF\u6587\u672C\u6B4C\u8BCD \xB7 \u6CA1\u6709\u65F6\u95F4\u6807\u8BB0"), h("p", null, compact ? lyricData.plain.split(/\r?\n/).find((line) => line.trim()) : lyricData.plain));
        return h("p", { className: "eh-lyric-note" }, lyricData?.message || "\u6682\u672A\u627E\u5230\u8FD9\u9996\u6B4C\u7684\u6B4C\u8BCD\u3002");
      }
      let content = null;
      if (scene === "search") content = h(
        "section",
        { className: "eh-context eh-search", ref: layerRef, "aria-label": "\u627E\u97F3\u4E50" },
        heading("\u60F3\u4E00\u8D77\u542C\u4EC0\u4E48\uFF1F", "\u4ECE\u4F60\u7684\u66F2\u5E93\uFF0C\u9009\u4E00\u9996\u5F00\u59CB\u3002"),
        h("label", { className: "eh-search-field" }, h("span", { className: "eh-sr-only" }, "\u641C\u7D22\u66F2\u5E93"), h("input", { ref: searchRef, value: query, type: "search", placeholder: "\u6B4C\u540D\u3001\u97F3\u4E50\u4EBA\u6216\u4E13\u8F91", onChange: (event) => {
          setQuery(event.target.value);
          setLimit(40);
        }, autoComplete: "off" }), h("kbd", { "aria-hidden": true }, "esc")),
        collection.status === "loading" ? h("p", { className: "eh-empty", role: "status" }, "\u6B63\u5728\u6253\u5F00\u66F2\u5E93\u2026") : collection.error ? h("div", { className: "eh-empty", role: "alert" }, h("p", null, collection.error), h(QuietButton, { onClick: () => action(() => library.load()) }, "\u91CD\u8BD5\u6253\u5F00\u66F2\u5E93")) : null,
        tracks.length ? h(
          React.Fragment,
          null,
          h("div", { className: "eh-list-caption" }, h("span", null, query.trim() ? `\u627E\u5230 ${results.length} \u9996` : `${tracks.length} \u9996\u672C\u5730\u97F3\u4E50`), h(QuietButton, { onClick: () => go("reco") }, "\u5E2E\u6211\u6311\u51E0\u9996", h(Icon, { name: "arrow", size: 14 }))),
          results.length ? songRows(results.slice(0, limit), "search") : h("p", { className: "eh-empty" }, "\u66F2\u5E93\u91CC\u8FD8\u6CA1\u6709\u5339\u914D\u7684\u97F3\u4E50\u3002\u53EF\u4EE5\u6362\u4E00\u4E2A\u8BCD\uFF0C\u6216\u6253\u5F00\u5728\u7EBF\u53D1\u73B0\u3002"),
          results.length > limit ? h(QuietButton, { onClick: () => setLimit((value) => value + 40), className: "eh-load-more" }, `\u518D\u770B\u4E00\u4E9B \xB7 \u8FD8\u6709 ${results.length - limit} \u9996`) : null
        ) : collection.status !== "loading" && !collection.error ? h("div", { className: "eh-empty" }, h("p", null, "\u8FD9\u91CC\u8FD8\u6CA1\u6709\u97F3\u4E50\u3002\u6DFB\u52A0\u97F3\u4E50\u6765\u6E90\u540E\uFF0C\u5C31\u80FD\u4E00\u8D77\u542C\u3002"), h(QuietButton, { onClick: () => go("welcome"), icon: "arrow" }, "\u6DFB\u52A0\u97F3\u4E50\u6765\u6E90")) : null,
        h("footer", { className: "eh-context-foot" }, h(QuietButton, { onClick: () => go("reco-manage") }, "\u5728\u7EBF\u53D1\u73B0"), h(QuietButton, { onClick: () => go("library-manage") }, "\u7BA1\u7406\u66F2\u5E93"))
      );
      if (scene === "discover") content = h(
        "section",
        { className: "eh-context eh-discover", ref: layerRef, "aria-label": "\u9009\u51E0\u9996\u4E00\u8D77\u542C" },
        heading("\u4ECE\u719F\u6089\u7684\u58F0\u97F3\u5F00\u59CB\u3002", "\u4ECE\u559C\u6B22\u7684\u6B4C\u548C\u672C\u5730\u66F2\u5E93\u4E2D\u6311\u9009\u3002"),
        collection.status === "loading" ? h("p", { className: "eh-empty", role: "status" }, "\u6B63\u5728\u6253\u5F00\u66F2\u5E93\u2026") : collection.error ? h("div", { className: "eh-empty", role: "alert" }, h("p", null, collection.error), h(QuietButton, { onClick: () => action(() => library.load()) }, "\u91CD\u8BD5")) : null,
        discoveries.length ? songRows(discoveries, "discover") : collection.status !== "loading" ? h("p", { className: "eh-empty" }, tracks.length ? "\u6682\u65F6\u6CA1\u6709\u5176\u4ED6\u5019\u9009\u3002\u53EF\u4EE5\u53BB\u66F2\u5E93\u91CD\u65B0\u6311\u9009\u3002" : "\u6DFB\u52A0\u4E00\u4E9B\u672C\u5730\u97F3\u4E50\uFF0C\u719F\u6089\u7684\u58F0\u97F3\u5C31\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002") : null,
        h("footer", { className: "eh-context-foot" }, discoveries.length && tracks.filter((item) => item.audioUrl && !likes.isDisliked(item)).length > 3 ? h(QuietButton, { onClick: () => setDiscoveryOffset((value) => value + 1) }, "\u6362\u51E0\u9996") : null, h(QuietButton, { onClick: () => go("library") }, "\u81EA\u5DF1\u627E\u4E00\u9996"), h(QuietButton, { onClick: () => go("reco-manage") }, "\u5728\u7EBF\u53D1\u73B0"))
      );
      if (scene === "memory") content = h(
        "section",
        { className: "eh-context eh-memory", ref: layerRef, "aria-label": "\u5171\u540C\u8BB0\u5FC6" },
        heading("\u65F6\u95F4\u7559\u5728\u5B83\u8EAB\u4E0A\u3002", reviewing ? "\u4F60\u6B63\u5728\u56DE\u770B\u5F53\u65F6\u7684\u6A21\u6837\u3002" : "\u8FD9\u662F\u6B64\u523B\u7684\u5B83\u3002\u6CBF\u7740\u65F6\u95F4\uFF0C\u770B\u770B\u5B83\u7684\u53D8\u5316\u3002"),
        h(
          "div",
          { className: "eh-time-control" },
          h("div", { className: "eh-time-caption" }, h("time", null, snapshot ? shortDate2(snapshot.at) : "\u6B64\u523B"), h("strong", null, snapshot?.reason || "\u73B0\u5728\u7684\u6A21\u6837")),
          h("input", { type: "range", min: 0, max: timeline.length, value: reviewing ? Math.min(reviewIndex, timeline.length - 1) : timeline.length, disabled: !timeline.length, onChange: (event) => {
            const value = Number(event.target.value);
            setReviewIndex(value === timeline.length ? null : value);
          }, "aria-label": "\u56DE\u770B\u6210\u957F\u65F6\u95F4\u7EBF", "aria-valuetext": snapshot ? `${shortDate2(snapshot.at)}\uFF0C${snapshot.reason || "\u6210\u957F\u7247\u6BB5"}` : "\u6B64\u523B\u7684\u751F\u547D" }),
          h("div", { className: "eh-time-labels" }, h("span", null, timeline.length ? shortDate2(timeline[0].at) : "\u521D\u6B21\u76F8\u9047"), h(QuietButton, { disabled: !reviewing, onClick: () => setReviewIndex(null) }, "\u56DE\u5230\u73B0\u5728")),
          life?.timelineOmitted ? h("p", { className: "eh-subtle" }, `\u66F4\u65E9\u7684 ${life.timelineOmitted} \u4E2A\u666E\u901A\u7247\u6BB5\u5DF2\u5F52\u5E76\uFF0C\u539F\u59CB\u7ECF\u5386\u4ECD\u5728\u5B8C\u6574\u6863\u6848\u4E2D\u3002`) : null
        ),
        h("div", { className: "eh-list-caption" }, h("span", null, `${life?.memories?.length || 0} \u6BB5\u5171\u540C\u8BB0\u5FC6`), h(QuietButton, { icon: "memory", disabled: !life, onClick: () => openDialog("memory") }, "\u7559\u4F4F\u8FD9\u4E00\u523B")),
        life?.memories?.length ? h("ol", { className: "eh-memory-list" }, [...life.memories].reverse().map((memory) => h("li", { key: memory.id }, h("button", { type: "button", onClick: () => readMemory(memory.id) }, h("time", null, shortDate2(memory.at)), h("strong", null, memory.title), h(Icon, { name: "arrow", size: 16 }))))) : h("p", { className: "eh-empty" }, "\u8F7B\u89E6\u201C\u7559\u4F4F\u8FD9\u4E00\u523B\u201D\uFF0C\u8BA9\u7B2C\u4E00\u6BB5\u8BB0\u5FC6\u7559\u5728\u5B83\u8EAB\u4E0A\u3002"),
        h("footer", { className: "eh-context-foot" }, h(QuietButton, { icon: "download", disabled: !life, onClick: () => action(async () => downloadJSON2(await lifeService.exportArchive(), `ECHO-${life.id}.json`)) }, "\u5BFC\u51FA\u751F\u547D\u6863\u6848"))
      );
      if (scene === "listening") content = h(
        "section",
        { className: "eh-context eh-listening", ref: layerRef, "aria-label": "\u97F3\u4E50\u64CD\u4F5C" },
        heading(track2?.title || "\u4E00\u8D77\u542C\u70B9\u4EC0\u4E48\u3002", track2?.artist || "\u9009\u4E00\u9996\u6B4C\uFF0C\u8BA9\u97F3\u4E50\u8FDB\u5165\u8FD9\u91CC\u3002"),
        !track2 ? h(QuietButton, { onClick: () => go("library"), icon: "arrow" }, "\u627E\u97F3\u4E50") : h(
          React.Fragment,
          null,
          track2.artist && openArtistPage ? h(QuietButton, { className: "eh-artist-link", onClick: () => openArtistPage(track2.artist) }, `\u8D70\u8FD1 ${track2.artist}`, h(Icon, { name: "arrow", size: 14 })) : null,
          h("div", { className: "eh-listening-controls" }, h(QuietButton, { icon: "previous", onClick: () => action(() => player.prev()), "aria-label": "\u4E0A\u4E00\u9996" }), h(QuietButton, { icon: loading ? "loading" : playing ? "pause" : "play", className: "eh-play-expanded", disabled: loading, onClick: () => action(() => player.toggle()), "aria-label": loading ? "\u6B63\u5728\u8F7D\u5165\u97F3\u4E50" : playing ? "\u6682\u505C" : "\u64AD\u653E" }), h(QuietButton, { icon: "next", onClick: () => action(() => player.next()), "aria-label": "\u4E0B\u4E00\u9996" })),
          h("div", { className: "eh-progress" }, h("input", { type: "range", min: 0, max: duration || 1, step: 0.1, value: Math.max(0, Math.min(seekDraft ?? position, duration || 1)), disabled: !duration, onChange: (event) => {
            const value = Number(event.target.value);
            seekRef.current = { track: track2, value };
            setSeekDraft(value);
          }, onPointerUp: commitSeek, onKeyUp: commitSeek, onBlur: commitSeek, "aria-label": "\u64AD\u653E\u8FDB\u5EA6" }), h("div", null, h("time", null, formatTime2(seekDraft ?? position)), h("time", null, formatTime2(duration)))),
          h(
            "div",
            { className: "eh-taste-controls" },
            h(QuietButton, { icon: "heart", disabled: preferencePending || !taste.loaded || !!taste.error, "aria-pressed": liked, onClick: () => preference2("like") }, liked ? "\u5DF2\u559C\u6B22" : "\u559C\u6B22"),
            h(QuietButton, { icon: "dislike", disabled: preferencePending || !taste.loaded || !!taste.error, "aria-pressed": disliked, onClick: () => preference2("dislike") }, disliked ? "\u53D6\u6D88\u4E0D\u559C\u6B22" : "\u4E0D\u559C\u6B22\u5E76\u8DF3\u8FC7"),
            preferencePending || !taste.loaded ? h("small", { role: "status" }, preferencePending ? "\u6B63\u5728\u4FDD\u5B58\u504F\u597D\u2026" : "\u6B63\u5728\u8BFB\u53D6\u504F\u597D\u2026") : null,
            taste.error ? h("small", { role: "alert" }, `\u504F\u597D\u672A\u80FD\u8F7D\u5165\uFF1A${taste.error}`, likes.load ? h(QuietButton, { onClick: () => action(() => likes.load()) }, "\u91CD\u8BD5\u8BFB\u53D6") : null) : null
          ),
          h("div", { className: "eh-volume" }, h(QuietButton, { icon: "sound", "aria-label": muted ? "\u53D6\u6D88\u9759\u97F3" : "\u9759\u97F3", "aria-pressed": muted, onClick: () => action(() => player.toggleMute()) }), h("input", { type: "range", min: 0, max: 1, step: 0.01, value: muted ? 0 : volume, onChange: (event) => action(() => player.setVolume(Number(event.target.value))), "aria-label": "\u97F3\u91CF" }), h(QuietButton, { onClick: () => action(() => player.cycleMode()), "aria-label": "\u5207\u6362\u64AD\u653E\u6A21\u5F0F" }, shuffle ? "\u968F\u673A" : repeat === "one" ? "\u5355\u66F2\u5FAA\u73AF" : "\u987A\u5E8F"))
        ),
        h("footer", { className: "eh-context-foot" }, h(QuietButton, { icon: "lyrics", "aria-pressed": lyricVisible, onClick: () => setLyricVisible((value) => !value) }, lyricVisible ? "\u6536\u8D77\u6B4C\u8BCD" : "\u663E\u793A\u6B4C\u8BCD"), h(QuietButton, { onClick: () => go("now-manage") }, `\u5B8C\u6574\u6B4C\u8BCD\u4E0E\u961F\u5217${queue.length ? ` \xB7 ${queue.length}` : ""}`)),
        lyricVisible ? h("div", { className: "eh-lyrics-detail" }, lyricContent()) : null
      );
      if (scene === "utility") content = h(
        "section",
        { className: "eh-utility", ref: layerRef, role: "dialog", "aria-modal": true, "aria-label": UTILITIES[requestedView] || "\u97F3\u4E50\u5DE5\u5177" },
        h("header", { className: "eh-utility-heading" }, h(QuietButton, { icon: "arrow", className: "eh-back", onClick: returnHome }, "\u56DE\u5230\u751F\u547D\u7A7A\u95F4"), h("h2", { tabIndex: -1, "data-eh-heading": true }, UTILITIES[requestedView] || "\u97F3\u4E50\u5DE5\u5177"), h(QuietButton, { icon: "close", onClick: returnHome, "aria-label": "\u5173\u95ED\u5DE5\u5177" })),
        h("div", { className: "eh-utility-scroll" }, renderUtility?.(requestedView) || h("p", { className: "eh-empty" }, "\u8FD9\u9879\u5DE5\u5177\u6682\u65F6\u4E0D\u53EF\u7528\u3002"))
      );
      return h(
        "section",
        { className: "echo-living-space", "data-scene": scene, "data-tone": tone, "data-playing": !!playing, "data-reviewing": reviewing, ref: rootRef, onKeyDown, "aria-label": "\u751F\u547D\u7A7A\u95F4" },
        h("div", { className: "eh-atmosphere", "aria-hidden": true }, h("div", { className: "eh-distant-light" }), h("div", { className: "eh-ground" })),
        h(
          "header",
          { className: "eh-presence-header", inert: scene === "utility" || !!dialog ? true : void 0 },
          h("button", { type: "button", className: "eh-name", disabled: !life, onClick: () => openDialog("rename"), "aria-label": "\u7ED9\u751F\u547D\u547D\u540D" }, h("span", { className: "eh-name-mark", "aria-hidden": true }), h("strong", null, name), h("small", null, life ? `\u76F8\u8BC6\u7B2C ${Math.max(1, Math.floor((Date.now() - life.createdAt) / 864e5) + 1)} \u5929` : "\u6B63\u5728\u76F8\u9047")),
          h(QuietButton, { className: "eh-menu-toggle", icon: "more", ref: menuButtonRef, onClick: () => setMenu((value) => !value), "aria-label": "\u6253\u5F00\u7A7A\u95F4\u5DE5\u5177", "aria-expanded": menu })
        ),
        h(
          "div",
          { className: "eh-being-space", key: "persistent-being", inert: scene === "utility" || !!dialog ? true : void 0 },
          h("div", { className: "eh-being" }, life ? h(Creature, { life, morphology: selectedMorphology, framing: "presence", tone, active: !!playing && !loading && !playbackError && !resting && !reviewing, compact: resting, gesture, motionEnabled: !reviewing, onTouch: touch, onMemorySelect: readMemory, label: reviewing ? `${name}\uFF0C${shortDate2(snapshot.at)}\u7684\u6A21\u6837` : `${name}\uFF0C\u8F7B\u89E6\u4E92\u52A8` }) : h(EmptyLife, { state, lifeService })),
          h("div", { className: "eh-being-whisper", "aria-live": "polite" }, reviewing ? `${shortDate2(snapshot.at)} \xB7 ${snapshot.reason || "\u6210\u957F\u7247\u6BB5"}` : resting ? "\u5B89\u9759\u5F85\u4E00\u4F1A\u513F\u3002" : loading ? "\u7B49\u97F3\u4E50\u8F7B\u8F7B\u8FDB\u6765\u3002" : playing && !playbackError ? "\u6B64\u523B\uFF0C\u4E0E\u4F60\u4E00\u8D77\u542C\u3002" : life?.greeting ? "\u8F7B\u89E6\u5B83\uFF0C\u6253\u4E2A\u4F60\u4EEC\u7684\u62DB\u547C\u3002" : "\u8F7B\u8F7B\u78B0\u4E00\u4E0B\uFF0C\u8BA4\u8BC6\u5F7C\u6B64\u3002")
        ),
        h(
          "div",
          { className: "eh-relationship", inert: scene === "utility" || !!dialog ? true : void 0 },
          h(QuietButton, { icon: "memory", onClick: () => go(scene === "memory" ? "home" : "echo-memory"), "aria-pressed": scene === "memory" }, "\u5171\u540C\u8BB0\u5FC6"),
          h(QuietButton, { icon: "greet", disabled: !life, onClick: greet }, life?.greeting ? "\u6253\u4E2A\u62DB\u547C" : "\u6559\u5B83\u62DB\u547C")
        ),
        content,
        scene === "encounter" && lyricVisible ? h("div", { className: "eh-lyric-presence" }, lyricContent(true)) : null,
        h(
          "footer",
          { className: "eh-music-ground", inert: scene === "utility" || !!dialog ? true : void 0 },
          h("button", { type: "button", className: "eh-current-track", onClick: () => go(track2 ? "now" : "library"), "aria-label": track2 ? "\u6253\u5F00\u97F3\u4E50\u64CD\u4F5C" : "\u9009\u4E00\u9996\u4E00\u8D77\u542C" }, h("span", { className: `eh-playing-mark ${playing ? "is-playing" : ""}`, "aria-hidden": true }, h("i"), h("i"), h("i")), h("span", null, h("strong", null, track2?.title || "\u4E00\u8D77\u542C\u70B9\u4EC0\u4E48"), h("small", null, loading ? "\u6B63\u5728\u8F7D\u5165\u97F3\u4E50\u2026" : track2?.artist || "\u7B2C\u4E00\u9996\u6B4C\uFF0C\u4ECE\u8FD9\u91CC\u5F00\u59CB"))),
          h("div", { className: "eh-direct-controls" }, h(QuietButton, { icon: loading ? "loading" : playing ? "pause" : "play", className: "eh-main-play", disabled: !track2 || loading, onClick: () => action(() => player.toggle()), "aria-label": loading ? "\u6B63\u5728\u8F7D\u5165\u97F3\u4E50" : playing ? "\u6682\u505C" : "\u64AD\u653E" }), h(QuietButton, { icon: "next", disabled: !track2, onClick: () => action(() => player.next()), "aria-label": "\u4E0B\u4E00\u9996" })),
          h("button", { type: "button", ref: findRef, className: "eh-find", onClick: () => go("library"), "aria-label": "\u627E\u97F3\u4E50" }, "\u627E\u97F3\u4E50", h("kbd", { "aria-hidden": true }, "\u2318 K"))
        ),
        menu ? h(
          "div",
          { className: "eh-tools", ref: menuRef, role: "region", "aria-label": "\u7A7A\u95F4\u5DE5\u5177" },
          h("div", { className: "eh-tool-group" }, h(QuietButton, { icon: "memory", disabled: !life, onClick: () => openDialog("memory") }, "\u7559\u4F4F\u8FD9\u4E00\u523B"), h(QuietButton, { icon: "greet", disabled: !life, onClick: () => openDialog("greeting") }, life?.greeting ? "\u518D\u6559\u4E00\u4E2A\u62DB\u547C" : "\u6559\u5B83\u4E00\u4E2A\u62DB\u547C"), h(QuietButton, { icon: "sound", disabled: !life, onClick: () => openDialog("share") }, "\u4ECB\u7ECD\u4E00\u9996\u6B4C"), h(QuietButton, { icon: resting ? "sun" : "moon", disabled: !life, onClick: rest }, resting ? "\u8212\u5C55\u8EAB\u4F53" : "\u5B89\u9759\u5F85\u4E00\u4F1A\u513F")),
          h("div", { className: "eh-tool-group" }, [["reco", "\u9009\u51E0\u9996\u4E00\u8D77\u542C"], ["library-manage", "\u7BA1\u7406\u66F2\u5E93"], ["reco-manage", "\u5728\u7EBF\u53D1\u73B0"], ["studio", "\u7B56\u5C55"], ["history", "\u8046\u542C\u5386\u53F2"], ["echo-gallery", "\u751F\u547D\u5F62\u6001\u793A\u4F8B"], ["welcome", "\u97F3\u4E50\u6765\u6E90"], ["command", "\u97F3\u4E50\u6307\u4EE4"]].map(([route, label]) => h(QuietButton, { key: route, onClick: () => go(route) }, label))),
          h("div", { className: "eh-tool-group" }, h(QuietButton, { icon: tone === "dark" ? "sun" : "moon", onClick: () => setTone((value) => value === "dark" ? "light" : "dark") }, tone === "dark" ? "\u6E05\u6D45\u7A7A\u95F4" : "\u6DF1\u8272\u7A7A\u95F4"), setMiniHidden ? h(QuietButton, { icon: "fold", onClick: () => {
            setMiniHidden(false);
            setMenu(false);
            report("\u5173\u95ED\u4E3B\u7A7A\u95F4\u540E\uFF0C\u5B83\u4F1A\u5728\u4F34\u751F\u7A97\u91CC\u7EE7\u7EED\u966A\u4F60\u3002");
          } }, "\u663E\u793A\u4F34\u751F\u7A97") : null)
        ) : null,
        h(
          "div",
          { className: "eh-system-status" },
          h(Status, { state, lifeService }),
          playbackError ? h("p", { className: "eh-feedback is-error", role: "alert" }, playbackError) : null,
          feedback ? h("div", { className: `eh-feedback ${feedback.isError ? "is-error" : ""}`, role: feedback.isError ? "alert" : "status" }, h("span", null, feedback.message), h(QuietButton, { icon: "close", "aria-label": "\u5173\u95ED\u63D0\u793A", onClick: () => setFeedback(null) })) : null,
          undo ? h("button", { type: "button", className: "eh-undo", disabled: preferencePending, onClick: undoPreference }, `\u64A4\u9500\u5BF9\u300A${undo.track.title}\u300B\u7684\u4E0D\u559C\u6B22`) : null
        ),
        dialog?.kind === "greeting" && life ? h(GreetingDialog, { life, save, close: () => setDialog(null) }) : null,
        ["rename", "memory", "share"].includes(dialog?.kind) && life ? h(EditDialog, { kind: dialog.kind, life, track: playing ? track2 : null, save, close: () => setDialog(null) }) : null,
        dialog?.kind === "read" ? h(MemoryDialog, { memory: dialog.memory, close: () => setDialog(null) }) : null
      );
    };
  }

  // src/client/echo/ui.js
  var shortDate = (at) => new Date(at).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  var formatTime = (seconds) => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, "0")}`;
  var durationText = (ms) => ms < 6e4 ? `${Math.floor(ms / 1e3)} \u79D2` : `${Math.floor(ms / 6e4)} \u5206\u949F`;
  function downloadJSON(data, filename) {
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1e3);
  }
  var paths = {
    arrow: "M4 10h12m-5-5 5 5-5 5",
    close: "m5 5 10 10M15 5 5 15",
    play: "m7 4 9 6-9 6Z",
    pause: "M7 4v12M13 4v12",
    next: "m4 4 8 6-8 6ZM15 4v12",
    previous: "m16 4-8 6 8 6ZM5 4v12",
    edit: "m12 4 4 4M4 16l4-1L17 6a2.8 2.8 0 0 0-4-4L4 11Z",
    memory: "M5 3h10v14l-5-3-5 3ZM8 7h4",
    sound: "M3 8v4h3l4 4V4L6 8ZM13 7a5 5 0 0 1 0 6M16 4a9 9 0 0 1 0 12",
    moon: "M15.9 12.6A7 7 0 0 1 7.4 4.1 7 7 0 1 0 15.9 12.6Z",
    sun: "M10 1v2M10 17v2M1 10h2M17 10h2M4 4l1 1M15 15l1 1M4 16l1-1M15 5l1-1M14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    download: "M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4",
    grid: "M3 3h5v5H3ZM12 3h5v5h-5ZM3 12h5v5H3ZM12 12h5v5h-5Z",
    info: "M10 9v5M10 6v.1M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    greet: "M3 10c3-8 4 8 7 0s4 8 7 0",
    fold: "m3 6 7 7 7-7M5 3l5 5 5-5",
    heart: "M10 17 3.7 11C-1 6.5 5 1 10 6c5-5 11 .5 6.3 5Z",
    dislike: "M14 3H7L3 8v4h5l-1 4c0 2 2 2 3 0l4-5ZM14 3h3v9h-3",
    lyrics: "M3 3h14v11H9l-4 3v-3H3ZM6 7h8M6 10h5",
    more: "M4 10h.1M10 10h.1M16 10h.1",
    loading: "M17 10a7 7 0 1 1-7-7"
  };
  function createEchoUI(React) {
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;
    const { Creature } = createCreatureComponents(React);
    function Icon({ name, size = 18 }) {
      return h("svg", { width: size, height: size, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d: paths[name] || paths.info }));
    }
    function Button({ children, icon, className = "", ...props }) {
      return h("button", { type: "button", className: `echo-button ${className}`, ...props }, icon ? h(Icon, { name: icon }) : null, children);
    }
    function useLife(service) {
      const [state, setState] = useState(service.source.getSnapshot());
      useEffect(() => {
        const unsubscribe = service.source.subscribe(() => setState(service.source.getSnapshot()));
        setState(service.source.getSnapshot());
        if (!service.source.getSnapshot().life) service.load().then(() => service.retry()).catch(() => {
        });
        return unsubscribe;
      }, [service]);
      return state;
    }
    const EchoMini = createEchoMiniComponent(React, { Creature, Icon, useLife, formatTime });
    function Dialog({ title, subtitle, children, close, wide = false }) {
      const ref = useRef(null);
      useEffect(() => {
        const previous = document.activeElement;
        const first = ref.current?.querySelector("input,textarea") || ref.current?.querySelector("button:not(.echo-dialog-close)") || ref.current?.querySelector("button");
        first?.focus();
        const handle = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key !== "Tab") return;
          const focusable = [...ref.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || []];
          if (!focusable.length) return;
          const a = focusable[0], b = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === a) {
            event.preventDefault();
            b.focus();
          } else if (!event.shiftKey && document.activeElement === b) {
            event.preventDefault();
            a.focus();
          }
        };
        document.addEventListener("keydown", handle);
        return () => {
          document.removeEventListener("keydown", handle);
          previous?.focus?.();
        };
      }, []);
      return h(
        "div",
        { className: "echo-modal-shade", onMouseDown: (event) => {
          if (event.target === event.currentTarget) close();
        } },
        h(
          "section",
          { className: `echo-dialog ${wide ? "echo-dialog-wide" : ""}`, role: "dialog", "aria-modal": true, "aria-label": title, ref },
          h("button", { type: "button", className: "echo-dialog-close", onClick: close, "aria-label": "\u5173\u95ED" }, h(Icon, { name: "close" })),
          h("p", { className: "echo-eyebrow" }, "A MOMENT BETWEEN YOU"),
          h("h2", null, title),
          subtitle ? h("p", { className: "echo-dialog-copy" }, subtitle) : null,
          children
        )
      );
    }
    function EditDialog({ kind, life, track: track2, close, save }) {
      const [title, setTitle] = useState(kind === "rename" ? life.name === "\u672A\u547D\u540D" ? "" : life.name : kind === "memory" && track2 ? `\u4E00\u8D77\u542C\u300A${track2.title}\u300B` : "");
      const [artist, setArtist] = useState("");
      const [note, setNote] = useState("");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const config = kind === "rename" ? ["\u7ED9\u5B83\u4E00\u4E2A\u540D\u5B57", "\u4E00\u4E2A\u53EA\u5C5E\u4E8E\u5B83\u7684\u79F0\u547C\u3002\u968F\u65F6\u53EF\u4EE5\u518D\u6539\u3002", "\u540D\u5B57"] : kind === "share" ? ["\u628A\u4E00\u9996\u6B4C\u4ECB\u7ECD\u7ED9\u5B83", "\u8BB0\u5F55\u4F60\u4E3B\u52A8\u5206\u4EAB\u7684\u97F3\u4E50\uFF0C\u4E0D\u4F1A\u5C06\u5B83\u8BB0\u4F5C\u5DF2\u7ECF\u64AD\u653E\u3002", "\u6B4C\u66F2\u540D\u79F0"] : ["\u7559\u4F4F\u8FD9\u4E00\u523B", "\u8FD9\u6BB5\u7ECF\u5386\u4F1A\u7559\u4E0B\u4E00\u4E2A\u5C0F\u5C0F\u7684\u8EAB\u4F53\u5370\u8BB0\uFF0C\u8F7B\u89E6\u5B83\u5C31\u80FD\u56DE\u6765\u3002", "\u8FD9\u4E00\u523B\uFF0C\u53EB\u4EC0\u4E48\uFF1F"];
      async function submit(event) {
        event.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
          await save(kind, kind === "rename" ? { name: title.trim() } : kind === "share" ? { title: title.trim(), artist: artist.trim(), note: note.trim() } : { title: title.trim(), note: note.trim(), ...track2 ? { track: { id: track2.id, title: track2.title, artist: track2.artist } } : {} });
          close();
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }
      return h(
        Dialog,
        { title: config[0], subtitle: config[1], close },
        h(
          "form",
          { onSubmit: submit },
          h("label", { className: "echo-field" }, h("span", null, config[2]), h("input", { value: title, onChange: (e) => setTitle(e.target.value), maxLength: kind === "rename" ? 40 : 160, required: true, placeholder: kind === "rename" ? "\u4F8B\u5982\uFF1A\u5C0F\u6298" : kind === "share" ? "\u8F93\u5165\u6B4C\u540D" : "\u7ED9\u8FD9\u6BB5\u8BB0\u5FC6\u53D6\u4E2A\u540D\u5B57" })),
          kind === "share" ? h("label", { className: "echo-field" }, h("span", null, "\u97F3\u4E50\u4EBA \xB7 \u9009\u586B"), h("input", { value: artist, onChange: (e) => setArtist(e.target.value), maxLength: 160 })) : null,
          kind !== "rename" ? h("label", { className: "echo-field" }, h("span", null, "\u60F3\u7559\u4E0B\u7684\u8BDD \xB7 \u9009\u586B"), h("textarea", { value: note, onChange: (e) => setNote(e.target.value), maxLength: 1e3, rows: 3, placeholder: "\u53EA\u8BB0\u5F55\u4F60\u613F\u610F\u5206\u4EAB\u7684\u90E8\u5206\u3002" })) : null,
          error ? h("p", { className: "echo-error", role: "alert" }, error) : null,
          h("button", { type: "submit", disabled: busy || !title.trim(), className: "echo-button echo-button-primary echo-submit" }, busy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : kind === "rename" ? "\u5C31\u53EB\u8FD9\u4E2A\u540D\u5B57" : "\u4FDD\u5B58\u8FD9\u4E00\u523B")
        )
      );
    }
    function GreetingDialog({ close, save, life }) {
      const [taps, setTaps] = useState([]);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const ref = useRef([]);
      const tap = () => {
        if (busy || ref.current.length >= 9) return;
        const now = performance.now();
        const previous = ref.current.at(-1);
        if (previous != null && now - previous < 50) return;
        if (previous != null && now - previous > 5e3) ref.current = [];
        ref.current = [...ref.current, now];
        setTaps(ref.current);
      };
      const pattern = taps.slice(1).map((at, i) => Math.round(at - taps[i]));
      return h(
        Dialog,
        { title: life.greeting ? "\u518D\u6559\u5B83\u4E00\u4E2A\u62DB\u547C" : "\u6559\u5B83\u4E00\u4E2A\u4F60\u4EEC\u7684\u62DB\u547C", subtitle: "\u8F7B\u6572\u81F3\u5C11\u4E09\u4E0B\u3002\u5B83\u4F1A\u7528\u81EA\u5DF1\u7684\u8EAB\u4F53\uFF0C\u8BB0\u4F4F\u4F60\u7684\u8282\u594F\u3002", close },
        h("button", { type: "button", className: "echo-tap-pad", onClick: tap, disabled: busy || taps.length >= 9, "aria-label": "\u6572\u51FB\u8282\u594F" }, h(Icon, { name: "greet", size: 58 }), h("span", null, taps.length ? `\u5DF2\u7ECF\u6572\u4E86 ${taps.length} \u4E0B` : "\u5728\u8FD9\u91CC\u8F7B\u6572"), h("small", null, "\u6BCF\u4E24\u4E0B\u95F4\u9694\u4E0D\u8D85\u8FC7 5 \u79D2")),
        h("div", { className: "echo-beat-sequence", "aria-label": `\u5DF2\u8BB0\u5F55 ${pattern.length} \u4E2A\u95F4\u9694` }, Array.from({ length: 8 }, (_, i) => h("i", { key: i, className: i < pattern.length ? "is-filled" : "", style: i < pattern.length ? { width: `${Math.min(48, 12 + pattern[i] / 45)}px` } : void 0 }))),
        error ? h("p", { className: "echo-error", role: "alert" }, error) : null,
        h(
          "div",
          { className: "echo-dialog-actions" },
          h(Button, { onClick: () => {
            ref.current = [];
            setTaps([]);
            setError("");
          }, disabled: busy }, "\u91CD\u65B0\u6572\u4E00\u904D"),
          h(Button, { className: "echo-button-primary", disabled: busy || pattern.length < 2, onClick: async () => {
            setBusy(true);
            try {
              await save("greeting", { pattern });
              close();
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          } }, busy ? "\u6B63\u5728\u8BB0\u4F4F\u2026" : "\u8BB0\u4F4F\u8FD9\u4E2A\u62DB\u547C")
        )
      );
    }
    function MemoryDialog({ memory, close }) {
      return h(
        Dialog,
        { title: memory.title, subtitle: shortDate(memory.at), close },
        h("div", { className: "echo-memory-reading" }, memory.note ? h("p", null, memory.note) : h("p", null, "\u4F60\u4EEC\u628A\u8FD9\u4E00\u523B\u7559\u4E86\u4E0B\u6765\u3002"), memory.track ? h("div", { className: "echo-related-track" }, h(Icon, { name: "sound" }), h("span", null, `${memory.track.title || "\u97F3\u4E50"}${memory.track.artist ? " \xB7 " + memory.track.artist : ""}`)) : null)
      );
    }
    function Status({ state, lifeService }) {
      if (!state.pending && !state.syncError && !state.rejectedCount && !state.storageError) return null;
      const message = state.volatileCount ? `${state.volatileCount} \u6761\u7ECF\u5386\u4EC5\u7559\u5728\u5F53\u524D\u9875\u9762\uFF0C\u5C1A\u672A\u53EF\u9760\u4FDD\u5B58\u3002\u8BF7\u91CD\u8BD5\u6216\u5148\u5BFC\u51FA\u3002` : state.storageError ? `\u672C\u673A\u6682\u5B58\u9047\u5230\u95EE\u9898\uFF1A${state.storageError}` : state.syncError ? `\u6682\u672A\u4FDD\u5B58\u5230\u751F\u547D\u6863\u6848\uFF1A${state.syncError}` : state.pending ? `${state.pending} \u6761\u7ECF\u5386\u6B63\u5728\u4FDD\u5B58` : `${state.rejectedCount} \u6761\u7ECF\u5386\u5C1A\u672A\u5199\u5165\u6863\u6848\uFF0C\u5DF2\u5355\u72EC\u4FDD\u7559\u3002`;
      return h(
        "div",
        { className: "echo-sync-status" },
        h(
          "div",
          { className: "echo-sync-summary", role: "status" },
          h("span", null, message),
          h("button", { type: "button", onClick: () => lifeService.retry().catch(() => {
          }) }, "\u91CD\u8BD5\u4FDD\u5B58"),
          (state.syncError || state.storageError || state.rejectedCount) && lifeService.exportOutbox ? h("button", { type: "button", onClick: () => downloadJSON(lifeService.exportOutbox(), "ECHO-pending-experiences.json") }, "\u5BFC\u51FA\u5F85\u4FDD\u5B58\u7ECF\u5386") : null
        ),
        state.rejectedCount ? h(
          "details",
          null,
          h("summary", null, `\u67E5\u770B ${state.rejectedCount} \u6761\u672A\u5199\u5165\u7ECF\u5386`),
          h("ul", null, (state.rejected || []).map((item) => h("li", { key: item.id }, h("span", null, item.message || "\u8FD9\u6BB5\u7ECF\u5386\u672A\u80FD\u5199\u5165\u6863\u6848\u3002"), h("button", { type: "button", onClick: () => lifeService.retryRejected(item.id).catch(() => {
          }) }, "\u518D\u6B21\u5C1D\u8BD5"))))
        ) : null
      );
    }
    function EmptyLife({ state, lifeService }) {
      return h("div", { className: "echo-empty-life" }, h("span", { className: "echo-wait-mark" }), h("h2", null, state.status === "error" ? "\u6682\u65F6\u6CA1\u80FD\u6253\u5F00\u5B83\u7684\u6863\u6848" : "\u6B63\u5728\u4E0E\u4F60\u7684\u751F\u547D\u89C1\u9762"), h("p", null, state.error || "\u5F62\u6001\u3001\u4E60\u60EF\u548C\u8BB0\u5FC6\uFF0C\u4F1A\u4E00\u8D77\u4FDD\u5B58\u5728\u8FD9\u91CC\u3002"), state.status === "error" ? h(Button, { onClick: () => lifeService.retry().catch(() => {
      }), icon: "arrow" }, "\u91CD\u65B0\u6253\u5F00") : null);
    }
    function EchoHome({ lifeService, player, usePlayer, openView }) {
      const state = useLife(lifeService);
      const track2 = usePlayer((s) => s.track);
      const playing = usePlayer((s) => s.playing);
      const [dialog, setDialog] = useState(null);
      const [gesture, setGesture] = useState(0);
      const [resting, setResting] = useState(false);
      const [notice, setNotice] = useState("");
      const touchAt = useRef(0);
      useEffect(() => {
        if (!notice) return;
        const id = setTimeout(() => setNotice(""), 5500);
        return () => clearTimeout(id);
      }, [notice]);
      if (!state.life) return h(EmptyLife, { state, lifeService });
      const life = state.life;
      const named = life.name && life.name !== "\u672A\u547D\u540D";
      const name = named ? life.name : "\u4F60\u7684\u97F3\u7075";
      const days = Math.max(1, Math.floor((Date.now() - life.createdAt) / 864e5) + 1);
      const close = () => setDialog(null);
      async function save(type, payload) {
        try {
          await lifeService.dispatch(type, payload);
          setNotice(type === "greeting" ? "\u5B83\u8BB0\u4F4F\u4E86\u4F60\u4EEC\u7684\u62DB\u547C\u3002\u518D\u8BD5\u7740\u53EB\u5B83\u4E00\u6B21\u5427\u3002" : type === "rename" ? "\u5B83\u6709\u81EA\u5DF1\u7684\u540D\u5B57\u4E86\u3002" : "\u8FD9\u4E00\u523B\uFF0C\u5DF2\u7ECF\u7559\u4E0B\u3002");
        } catch (error) {
          if (error.queued) {
            setNotice("\u8FD9\u6BB5\u7ECF\u5386\u5DF2\u5728\u672C\u673A\u6682\u5B58\uFF0C\u8FDE\u63A5\u6062\u590D\u540E\u4F1A\u7EE7\u7EED\u4FDD\u5B58\u3002");
            return;
          }
          throw error;
        }
      }
      const greet = () => {
        if (!life.greeting) {
          setDialog({ kind: "greeting" });
          return;
        }
        setGesture((n) => n + 1);
        lifeService.dispatch("interaction", { action: "greet" }).catch((error) => setNotice(error.queued ? "\u62DB\u547C\u5DF2\u6682\u5B58\uFF0C\u7B49\u5F85\u540C\u6B65\u3002" : error.message));
      };
      const touch = () => {
        const now = Date.now();
        if (now - touchAt.current < 1200) return;
        touchAt.current = now;
        setGesture((n) => n + 1);
        lifeService.dispatch("interaction", { action: "touch" }).catch((error) => {
          if (!error.queued) setNotice(error.message);
        });
      };
      const toggleRest = () => {
        setResting((value) => !value);
        if (!resting) lifeService.dispatch("interaction", { action: "rest" }).catch((error) => {
          if (!error.queued) setNotice(error.message);
        });
      };
      return h(
        "div",
        { className: "echo-home" },
        h("div", { className: "echo-chapter" }, h("span", { className: "echo-eyebrow" }, "A LIFE, UNLIKE ANY OTHER"), h("span", { className: "echo-chapter-day" }, h("i"), `\u76F8\u8BC6\u7B2C ${days} \u5929`)),
        h("div", { className: "echo-home-intro" }, h("h2", null, named ? `\u548C${name}\uFF0C\u5F85\u4E00\u4F1A\u513F\u3002` : "\u4E00\u4E2A\u751F\u547D\uFF0C\u6162\u6162\u6210\u4E3A\u5B83\u81EA\u5DF1\u3002"), h("p", null, named ? "\u4E00\u8D77\u542C\uFF0C\u8F7B\u8F7B\u56DE\u5E94\u3002\u4F60\u4EEC\u7684\u7ECF\u5386\uFF0C\u4F1A\u7559\u5728\u5B83\u8EAB\u4E0A\u3002" : "\u4ECE\u7B2C\u4E00\u6B21\u56DE\u5E94\u5F00\u59CB\uFF0C\u957F\u51FA\u53EA\u5C5E\u4E8E\u4F60\u4EEC\u7684\u6A21\u6837\u3002")),
        h(
          "div",
          { className: "echo-habitat" },
          h("div", { className: "echo-habitat-light", "aria-hidden": true }),
          h("div", { className: "echo-habitat-ground", "aria-hidden": true }),
          h("div", { className: "echo-specimen-note" }, h("span", null, "ECHO"), h("small", null, life.id.slice(-8).toUpperCase())),
          h("div", { className: "echo-creature-stage" }, h(Creature, { life, morphology: state.morphology, active: playing && !resting, compact: resting, gesture, onTouch: touch, onMemorySelect: (id) => {
            const memory = life.memories.find((m) => m.id === id);
            if (memory) setDialog({ kind: "read", memory });
          }, label: `${name}\uFF0C\u8F7B\u89E6\u4E92\u52A8` })),
          h(
            "div",
            { className: "echo-identity" },
            h("div", { className: "echo-name-row" }, h("h3", null, name), h("button", { type: "button", onClick: () => setDialog({ kind: "rename" }), className: "echo-quiet-icon", "aria-label": "\u7ED9\u751F\u547D\u547D\u540D" }, h(Icon, { name: "edit", size: 14 }))),
            h("p", null, resting ? "\u6536\u62E2\u8EAB\u4F53\uFF0C\u5B89\u9759\u5F85\u4E00\u4F1A\u513F\u3002" : playing ? "\u6B64\u523B\uFF0C\u4E0E\u4F60\u4E00\u8D77\u542C\u3002" : life.greeting ? "\u5B83\u8BB0\u5F97\u4F60\u4EEC\u7684\u62DB\u547C\u3002" : "\u8F7B\u89E6\u5B83\uFF0C\u770B\u770B\u5B83\u5982\u4F55\u56DE\u5E94\u3002")
          ),
          h("div", { className: "echo-habitat-tools" }, h("button", { type: "button", className: `echo-quiet-icon ${resting ? "is-active" : ""}`, onClick: toggleRest, title: resting ? "\u8212\u5C55\u8EAB\u4F53" : "\u5B89\u9759\u5F85\u4E00\u4F1A\u513F", "aria-label": resting ? "\u8212\u5C55\u8EAB\u4F53" : "\u5B89\u9759\u5F85\u4E00\u4F1A\u513F", "aria-pressed": resting }, h(Icon, { name: resting ? "sun" : "moon" }))),
          life.memories.length ? h("button", { type: "button", className: "echo-mark-caption", onClick: () => setDialog({ kind: "read", memory: life.memories.at(-1) }) }, h("i"), "\u8F7B\u89E6\u8EAB\u4E0A\u7684\u5370\u8BB0\uFF0C\u91CD\u56DE\u90A3\u4E00\u523B", h(Icon, { name: "arrow", size: 13 })) : null
        ),
        h("div", { className: "echo-action-row" }, h(Button, { icon: "greet", onClick: greet }, life.greeting ? "\u6253\u4E2A\u62DB\u547C" : "\u6559\u5B83\u4E00\u4E2A\u62DB\u547C"), h(Button, { icon: "memory", onClick: () => setDialog({ kind: "memory" }) }, "\u7559\u4F4F\u8FD9\u4E00\u523B"), h(Button, { icon: "play", className: "echo-button-primary", onClick: () => {
          if (track2) {
            if (!playing) player.toggle();
          } else openView("library");
        } }, playing ? "\u6B63\u5728\u4E00\u8D77\u542C" : "\u4E00\u8D77\u542C\u97F3\u4E50")),
        h(
          "div",
          { className: "echo-home-bottom" },
          h("div", { className: "echo-bottom-story" }, h("span", { className: "echo-eyebrow" }, "EVERY LITTLE MOMENT"), h("p", null, life.stats.listenedMs ? `\u5DF2\u7ECF\u4E00\u8D77\u542C\u8FC7 ${durationText(life.stats.listenedMs)}\u3002\u6545\u4E8B\u4ECD\u5728\u7EE7\u7EED\u3002` : "\u5B83\u521A\u521A\u6765\u5230\u8FD9\u91CC\u3002\u7B2C\u4E00\u6BB5\u7ECF\u5386\uFF0C\u7B49\u4F60\u7559\u4E0B\u3002")),
          h("div", { className: "echo-text-actions" }, h("button", { type: "button", onClick: () => setDialog({ kind: "share" }) }, "\u4ECB\u7ECD\u4E00\u9996\u6B4C", h(Icon, { name: "arrow", size: 14 })), h("button", { type: "button", onClick: () => openView("echo-gallery") }, "\u770B\u770B\u4E0D\u540C\u7684\u751F\u547D", h(Icon, { name: "grid", size: 14 })), h("button", { type: "button", onClick: () => setDialog({ kind: "about" }), "aria-label": "\u4E86\u89E3\u97F3\u4E50\u4E0E\u6210\u957F" }, h(Icon, { name: "info", size: 15 })))
        ),
        h(Status, { state, lifeService }),
        notice ? h("div", { className: "echo-notice", role: "status" }, notice) : null,
        dialog?.kind === "greeting" ? h(GreetingDialog, { close, save, life }) : null,
        ["rename", "memory", "share"].includes(dialog?.kind) ? h(EditDialog, { kind: dialog.kind, life, track: playing ? track2 : null, close, save }) : null,
        dialog?.kind === "read" ? h(MemoryDialog, { memory: dialog.memory, close }) : null,
        dialog?.kind === "about" ? h(Dialog, { title: "\u97F3\u4E50\u4F1A\u6162\u6162\u957F\u8FDB\u5B83\u7684\u8EAB\u4F53", subtitle: "\u6BCF\u4E2A\u4E2A\u4F53\u90FD\u6709\u81EA\u5DF1\u7684\u8D77\u70B9\uFF0C\u7ECF\u5386\u5219\u51B3\u5B9A\u540E\u6765\u7684\u53D8\u5316\u3002", close }, h(
          "div",
          { className: "echo-about-copy" },
          h("p", null, "\u5728\u8FD9\u91CC\u64AD\u653E\u672C\u5730\u97F3\u4E50\u65F6\uFF0C\u8282\u594F\u53D8\u5316\u3001\u58F0\u97F3\u80FD\u91CF\u3001\u660E\u6697\u548C\u7EB9\u7406\u4F1A\u5F71\u54CD\u5B83\u7684\u6BD4\u4F8B\u3001\u66F2\u9762\u4E0E\u6750\u8D28\u3002\u5B83\u4F1A\u4FDD\u7559\u81EA\u5DF1\u7684\u8EAB\u4EFD\uFF0C\u9010\u6E10\u957F\u6210\u4E0D\u540C\u7684\u6A21\u6837\u3002"),
          h("p", null, "\u4E3B\u52A8\u4ECB\u7ECD\u7684\u6B4C\u66F2\u4F1A\u5355\u72EC\u8BB0\u5F55\uFF0C\u4E0D\u4F1A\u88AB\u7B97\u4F5C\u5DF2\u7ECF\u542C\u8FC7\u3002\u79BB\u5F00\u4E00\u6BB5\u65F6\u95F4\u4E5F\u4E0D\u4F1A\u5931\u53BB\u6210\u957F\u3002"),
          h("dl", null, h("dt", null, "\u5F53\u524D\u97F3\u4E50\u8F93\u5165"), h("dd", null, state.audioStatus === "audio" ? "\u6B63\u5728\u8BFB\u53D6\u672C\u5730\u64AD\u653E\u7684\u58F0\u97F3\u7279\u5F81" : state.audioStatus === "time-only" ? "\u58F0\u97F3\u7279\u5F81\u4E0D\u53EF\u7528\uFF0C\u4EC5\u8BB0\u5F55\u64AD\u653E\u65F6\u957F" : "\u7B49\u5F85\u4E0B\u4E00\u6B21\u5171\u540C\u8046\u542C"), h("dt", null, "\u6210\u957F\u8BB0\u5F55"), h("dd", null, "\u53D6\u5F97\u58F0\u97F3\u7279\u5F81\u7684\u6709\u6548\u64AD\u653E\u6BCF\u7D2F\u8BA1\u4E94\u5206\u949F\uFF0C\u7559\u4E0B\u4E00\u6B21\u5916\u5F62\u5FEB\u7167\u3002"), h("dt", null, "\u751F\u547D\u6863\u6848"), h("dd", null, "\u672C\u673A\u4FDD\u5B58\uFF0C\u53EF\u5728\u201C\u8BB0\u5FC6\u201D\u9875\u9762\u5B8C\u6574\u5BFC\u51FA\u3002")),
          life.greeting ? h(Button, { onClick: () => setDialog({ kind: "greeting" }), icon: "greet" }, "\u91CD\u65B0\u6559\u4E00\u4E2A\u62DB\u547C") : null
        )) : null
      );
    }
    function EchoMemories({ lifeService, openView }) {
      const state = useLife(lifeService);
      const [selected, setSelected] = useState(null);
      const [memory, setMemory] = useState(null);
      const [error, setError] = useState("");
      if (!state.life) return h(EmptyLife, { state, lifeService });
      const life = state.life;
      const timeline = life.timeline || [];
      const index = selected == null ? timeline.length - 1 : Math.min(selected, timeline.length - 1);
      const point2 = timeline[index];
      async function download() {
        try {
          const archive = await lifeService.exportArchive();
          downloadJSON(archive, `ECHO-${life.id}.json`);
          setError("");
        } catch (err) {
          setError(err.message);
        }
      }
      return h(
        "div",
        { className: "echo-memories-page" },
        h("div", { className: "echo-page-heading" }, h("div", null, h("p", { className: "echo-eyebrow" }, "BECOMING, TOGETHER"), h("h2", null, "\u5B83\u5982\u4F55\u6210\u4E3A\u4ECA\u5929\u7684\u81EA\u5DF1\u3002"), h("p", null, "\u6BCF\u4E00\u6B21\u88AB\u7559\u4E0B\u7684\u53D8\u5316\uFF0C\u90FD\u6709\u771F\u5B9E\u7684\u6765\u5904\u3002")), h(Button, { icon: "download", onClick: download }, "\u5E26\u8D70\u751F\u547D\u6863\u6848")),
        h(
          "section",
          { className: "echo-time-room" },
          h("div", { className: "echo-timeline-creature" }, h(Creature, { life, morphology: point2?.morphology || state.morphology, motionEnabled: false, onMemorySelect: (id) => setMemory(life.memories.find((m) => m.id === id)) })),
          h(
            "div",
            { className: "echo-timeline-story" },
            h("p", { className: "echo-eyebrow" }, point2 ? shortDate(point2.at) : "TODAY"),
            h("h3", null, point2?.reason || "\u521D\u6B21\u76F8\u9047"),
            h("p", null, timeline.length > 1 ? "\u6CBF\u7740\u65F6\u95F4\uFF0C\u770B\u770B\u5B83\u4E00\u70B9\u70B9\u53D1\u751F\u7684\u53D8\u5316\u3002" : "\u7B2C\u4E00\u5F20\u751F\u547D\u5FEB\u7167\u5DF2\u7ECF\u7559\u4E0B\u3002\u4E00\u8D77\u542C\u97F3\u4E50\u3001\u6559\u5B83\u62DB\u547C\u6216\u4FDD\u5B58\u8BB0\u5FC6\uFF0C\u90FD\u4F1A\u4E3A\u8FD9\u91CC\u6DFB\u4E0A\u65B0\u7684\u7247\u6BB5\u3002"),
            h("input", { type: "range", min: 0, max: Math.max(0, timeline.length - 1), value: Math.max(0, index), disabled: timeline.length < 2, onChange: (e) => setSelected(Number(e.target.value)), "aria-label": "\u6210\u957F\u65F6\u95F4\u7EBF" }),
            h("div", { className: "echo-range-labels" }, h("span", null, "\u521D\u6B21\u76F8\u9047"), h("span", null, `${timeline.length} \u4E2A\u7247\u6BB5`), h("button", { type: "button", onClick: () => setSelected(null) }, "\u6700\u8FD1\u4E00\u6B21")),
            life.timelineOmitted ? h("small", null, `\u66F4\u65E9\u7684 ${life.timelineOmitted} \u4E2A\u666E\u901A\u8282\u70B9\u5DF2\u5F52\u5E76\uFF0C\u539F\u59CB\u7ECF\u5386\u4ECD\u5728\u5B8C\u6574\u6863\u6848\u4E2D\u3002`) : null
          )
        ),
        h("div", { className: "echo-memory-heading" }, h("h3", null, "\u7559\u5728\u8EAB\u4E0A\u7684\u8BB0\u5FC6"), h("span", null, `${life.memories.length} \u6BB5`)),
        life.memories.length ? h("div", { className: "echo-memory-list" }, [...life.memories].reverse().map((m, i) => h("button", { type: "button", className: "echo-memory-item", key: m.id, onClick: () => setMemory(m) }, h("span", { className: "echo-memory-number" }, String(life.memories.length - i).padStart(2, "0")), h("div", null, h("h4", null, m.title), h("p", null, m.note || "\u4E00\u6BB5\u4F60\u613F\u610F\u7559\u4E0B\u7684\u5171\u540C\u7ECF\u5386")), h("time", null, shortDate(m.at)), h(Icon, { name: "arrow" })))) : h("div", { className: "echo-memory-empty" }, h(Icon, { name: "memory", size: 28 }), h("p", null, "\u6709\u4E9B\u65F6\u523B\uFF0C\u503C\u5F97\u6162\u6162\u7559\u4E0B\u3002"), h(Button, { onClick: () => openView("home") }, "\u56DE\u53BB\u548C\u5B83\u5F85\u4E00\u4F1A\u513F")),
        h(Status, { state, lifeService }),
        error ? h("p", { className: "echo-error", role: "alert" }, error) : null,
        memory ? h(MemoryDialog, { memory, close: () => setMemory(null) }) : null
      );
    }
    function EchoGallery({ openView }) {
      const [mode, setMode] = useState("birth");
      const [monochrome, setMonochrome] = useState(false);
      const [compact, setCompact] = useState(false);
      const specimens = useMemo(() => {
        const out = [], counts = { fold: 0, shell: 0, ribbon: 0 };
        for (let i = 0; out.length < 9 && i < 200; i++) {
          const life = createLife({ seed: `echo-study-${i}`, now: 17e11, name: `\u4E2A\u4F53 ${String(out.length + 1).padStart(2, "0")}` });
          if (counts[life.genome.structure] >= 3) continue;
          counts[life.genome.structure]++;
          out.push(life);
        }
        return out;
      }, []);
      const evolved = useMemo(() => specimens.map((initial) => {
        if (mode === "birth") return initial;
        let life = initial;
        const features = mode === "gentle" ? { energy: 0.2, brightness: 0.25, rhythm: 0.15, texture: 0.35 } : { energy: 0.8, brightness: 0.75, rhythm: 0.85, texture: 0.65 };
        for (let i = 0; i < 40; i++) life = applyLifeEvent(life, { id: `study-${i}`, type: "listening", at: initial.createdAt + (i + 1) * 3e4, sessionId: "study-session", track: { id: "study-track", title: "\u6A21\u62DF\u58F0\u97F3\u8F93\u5165", artist: "\u5F62\u6001\u9A8C\u8BC1" }, listenedMs: 3e4, featureSource: "audio", features });
        return life;
      }), [mode, specimens]);
      return h(
        "div",
        { className: "echo-gallery-page" },
        h("div", { className: "echo-page-heading" }, h("div", null, h("p", { className: "echo-eyebrow" }, "ONE WORLD. DIFFERENT LIVES."), h("h2", null, "\u6BCF\u4E00\u4E2A\uFF0C\u90FD\u6709\u81EA\u5DF1\u7684\u6A21\u6837\u3002"), h("p", null, "\u540C\u6837\u7684\u97F3\u4E50\uFF0C\u4F1A\u5728\u4E0D\u540C\u7684\u751F\u547D\u8EAB\u4E0A\u7559\u4E0B\u4E0D\u540C\u7684\u53D8\u5316\u3002")), h(Button, { icon: "arrow", onClick: () => openView("home") }, "\u56DE\u5230\u81EA\u5DF1\u7684\u751F\u547D")),
        h(
          "div",
          { className: "echo-study-controls" },
          h("div", { className: "echo-segmented", role: "group", "aria-label": "\u6A21\u62DF\u97F3\u4E50\u8F93\u5165" }, [["birth", "\u521D\u751F"], ["gentle", "\u67D4\u548C\u7684\u58F0\u97F3"], ["dynamic", "\u9C9C\u660E\u7684\u8282\u594F"]].map(([key, text2]) => h("button", { key, type: "button", "aria-pressed": mode === key, onClick: () => setMode(key) }, text2))),
          h("label", null, h("input", { type: "checkbox", checked: monochrome, onChange: (e) => setMonochrome(e.target.checked) }), "\u53EA\u770B\u8F6E\u5ED3"),
          h("label", null, h("input", { type: "checkbox", checked: compact, onChange: (e) => setCompact(e.target.checked) }), "\u6536\u62E2\u8EAB\u4F53")
        ),
        h("p", { className: "echo-study-note" }, "\u5F62\u6001\u793A\u4F8B \xB7 \u540E\u4E24\u9879\u4F7F\u7528 20 \u5206\u949F\u6A21\u62DF\u58F0\u97F3\u7279\u5F81\uFF0C\u4EC5\u7528\u4E8E\u6BD4\u8F83\uFF0C\u4E0D\u4F1A\u5199\u5165\u4F60\u7684\u751F\u547D\u6863\u6848\u3002"),
        h("div", { className: `echo-specimen-grid ${monochrome ? "is-silhouette" : ""}` }, evolved.map((life, index) => h("article", { key: life.id, className: "echo-specimen-card" }, h("div", { className: "echo-specimen-creature" }, h(Creature, { life, compact, motionEnabled: false, label: `\u5F62\u6001\u793A\u4F8B ${index + 1}` })), h("div", { className: "echo-specimen-caption" }, h("span", null, String(index + 1).padStart(2, "0")), h("span", null, mode === "birth" ? "\u6700\u521D\u7684\u6A21\u6837" : "\u540C\u4E00\u8F93\u5165\uFF0C\u5404\u81EA\u751F\u957F")))))
      );
    }
    function EchoDock({ player, usePlayer, openView }) {
      const track2 = usePlayer((s) => s.track), playing = usePlayer((s) => s.playing), position = usePlayer((s) => s.position), duration = usePlayer((s) => s.duration), volume = usePlayer((s) => s.volume), muted = usePlayer((s) => s.muted), error = usePlayer((s) => s.error);
      return h(
        "footer",
        { className: "echo-dock" },
        h("button", { type: "button", className: "echo-dock-track", onClick: () => openView(track2 ? "now" : "library") }, h("span", { className: "echo-dock-art" }, track2?.coverUrl ? h("img", { src: new URL(track2.coverUrl.replace(/^\//, ""), document.baseURI).href, alt: "", onError: (e) => {
          e.currentTarget.style.display = "none";
        } }) : h(Icon, { name: "sound", size: 21 })), h("span", null, h("strong", null, track2?.title || "\u4E00\u8D77\u542C\u70B9\u4EC0\u4E48"), h("small", null, track2?.artist || "\u4ECE\u4F60\u7684\u672C\u5730\u97F3\u4E50\u5F00\u59CB"))),
        h("div", { className: "echo-dock-center" }, h("div", { className: "echo-play-controls" }, h("button", { type: "button", disabled: !track2, onClick: player.prev, "aria-label": "\u4E0A\u4E00\u9996" }, h(Icon, { name: "previous" })), h("button", { type: "button", className: "echo-play-main", disabled: !track2, onClick: player.toggle, "aria-label": playing ? "\u6682\u505C" : "\u64AD\u653E" }, h(Icon, { name: playing ? "pause" : "play", size: 20 })), h("button", { type: "button", disabled: !track2, onClick: player.next, "aria-label": "\u4E0B\u4E00\u9996" }, h(Icon, { name: "next" }))), h("div", { className: "echo-dock-progress" }, h("time", null, formatTime(position)), h("input", { type: "range", min: 0, max: duration || 1, step: 0.1, value: Math.min(position || 0, duration || 1), disabled: !track2 || !duration, onChange: (e) => player.seek(Number(e.target.value)), "aria-label": "\u64AD\u653E\u8FDB\u5EA6" }), h("time", null, formatTime(duration)))),
        h("div", { className: "echo-dock-volume" }, h("button", { type: "button", onClick: player.toggleMute, "aria-label": muted ? "\u53D6\u6D88\u9759\u97F3" : "\u9759\u97F3", "aria-pressed": muted }, h(Icon, { name: "sound" })), h("input", { type: "range", min: 0, max: 1, step: 0.01, value: muted ? 0 : volume, onChange: (e) => player.setVolume(Number(e.target.value)), "aria-label": "\u97F3\u91CF" })),
        error ? h("span", { className: "echo-playback-error", role: "alert" }, error) : null
      );
    }
    const EchoHabitat = createHabitatComponent(React, { Creature, Icon, useLife, EditDialog, GreetingDialog, MemoryDialog, Status, EmptyLife, formatTime, shortDate, downloadJSON });
    return { EchoHome, EchoMemories, EchoGallery, EchoDock, EchoMini, EchoHabitat, Creature };
  }

  // src/client/echo/service.js
  var OUTBOX_KEY = "dsh-music.echo.outbox.v1";
  var OUTBOX_VERSION = 2;
  var MAX_PENDING = 500;
  var MAX_EVENT_BYTES = 64 * 1024;
  function eventId(prefix = "event") {
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `echo-${prefix}-${token}`;
  }
  function failure(message, code, fields = {}) {
    return Object.assign(new Error(message), { code, ...fields });
  }
  function canonicalId(value) {
    if (typeof value !== "string") throw failure("\u8FD9\u6761\u7ECF\u5386\u7F3A\u5C11\u6709\u6548\u6807\u8BC6\u3002", "INVALID_LIFE_EVENT");
    const id = value.trim().normalize("NFC");
    if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) throw failure("\u8FD9\u6761\u7ECF\u5386\u7684\u6807\u8BC6\u4E0D\u6B63\u786E\u3002", "INVALID_LIFE_EVENT");
    return id;
  }
  function copyEvent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("\u8FD9\u6761\u7ECF\u5386\u683C\u5F0F\u4E0D\u6B63\u786E\u3002", "INVALID_LIFE_EVENT");
    const id = canonicalId(value.id);
    if (typeof value.type !== "string" || !value.type || value.type.length > 24 || !Number.isSafeInteger(value.at) || value.at < 0) {
      throw failure("\u8FD9\u6761\u7ECF\u5386\u7684\u7C7B\u578B\u6216\u65F6\u95F4\u4E0D\u6B63\u786E\u3002", "INVALID_LIFE_EVENT");
    }
    let json;
    try {
      json = JSON.stringify({ ...value, id });
    } catch {
      throw failure("\u8FD9\u6761\u7ECF\u5386\u65E0\u6CD5\u4FDD\u5B58\u4E3A\u672C\u673A\u8BB0\u5F55\u3002", "INVALID_LIFE_EVENT");
    }
    if (new TextEncoder().encode(json).length > MAX_EVENT_BYTES) throw failure("\u8FD9\u6761\u7ECF\u5386\u8FC7\u957F\uFF0C\u8BF7\u7F29\u77ED\u540E\u91CD\u8BD5\u3002", "LIFE_REQUEST_TOO_LARGE");
    return JSON.parse(json);
  }
  function readFormat(raw) {
    const value = raw ? JSON.parse(raw) : [];
    const legacy = Array.isArray(value);
    if (!legacy && (!value || value.version !== OUTBOX_VERSION || !Array.isArray(value.pending) || !Array.isArray(value.rejected))) throw new Error("Unknown outbox format");
    const pending = legacy ? value : value.pending;
    const rejected = legacy ? [] : value.rejected;
    if (pending.length + rejected.length > MAX_PENDING) throw new Error("Outbox capacity exceeded");
    const ids = /* @__PURE__ */ new Set();
    const unique = [];
    for (const rawEvent of pending) {
      const event = copyEvent(rawEvent);
      if (!ids.has(event.id)) {
        ids.add(event.id);
        unique.push(event);
      }
    }
    const held = rejected.map((item) => {
      const event = copyEvent(item?.event);
      if (ids.has(event.id) || !Number.isInteger(item.status) || typeof item.message !== "string" || !Number.isSafeInteger(item.rejectedAt)) throw new Error("Invalid rejected event");
      ids.add(event.id);
      return { event, status: item.status, code: String(item.code || ""), message: item.message, rejectedAt: item.rejectedAt };
    });
    return { pending: unique, rejected: held };
  }
  function createLifeClient(options = {}) {
    const {
      resolveUrl,
      fetcher = (...args) => fetch(...args),
      timers = globalThis,
      eventTarget = globalThis,
      retryDelay = 15e3,
      requestTimeout = 2e4
    } = options;
    let storage;
    let rawStorage = null;
    let readError = null;
    let storageError = null;
    let syncError = null;
    let outbox = { pending: [], rejected: [] };
    let volatile = [];
    let state;
    let loadJob = null;
    let flushJob = null;
    let retryTimer = null;
    let disposed = false;
    let requestSequence = 0;
    let acceptedSequence = 0;
    let acceptedRevision = 0;
    let acceptedIds = /* @__PURE__ */ new Set();
    const listeners = /* @__PURE__ */ new Set();
    const requests = /* @__PURE__ */ new Set();
    const closed = () => failure("\u751F\u547D\u670D\u52A1\u5DF2\u7ECF\u5173\u95ED\u3002", "LIFE_CLIENT_CLOSED");
    const active = () => {
      if (disposed) throw closed();
    };
    const set = (patch) => {
      if (disposed) return;
      state = { ...state, ...patch };
      for (const fn of listeners) {
        try {
          fn();
        } catch {
        }
      }
    };
    const refresh = () => set({
      pending: outbox.pending.length + volatile.length,
      rejectedCount: outbox.rejected.length,
      rejected: outbox.rejected.map(({ event, ...reason }) => ({ id: event.id, type: event.type, ...reason })),
      volatileCount: volatile.length,
      storageError: storageError || readError,
      syncError: storageError || readError || syncError || (outbox.rejected.length ? `${outbox.rejected.length} \u6761\u7ECF\u5386\u672A\u88AB\u63A5\u53D7\uFF0C\u5DF2\u5355\u72EC\u4FDD\u7559\uFF0C\u53EF\u5BFC\u51FA\u6216\u91CD\u65B0\u5C1D\u8BD5\u3002` : null)
    });
    function readStorage() {
      try {
        storage = Object.prototype.hasOwnProperty.call(options, "storage") ? options.storage : globalThis.localStorage;
        if (!storage) throw new Error("Storage unavailable");
        rawStorage = storage.getItem(OUTBOX_KEY);
        outbox = readFormat(rawStorage);
        readError = null;
      } catch {
        readError = "\u5F85\u540C\u6B65\u8BB0\u5F55\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u539F\u59CB\u8BB0\u5F55\u672A\u88AB\u8986\u76D6\u3002\u8BF7\u5BFC\u51FA\u672C\u673A\u6682\u5B58\u5185\u5BB9\u5E76\u68C0\u67E5\u6D4F\u89C8\u5668\u5B58\u50A8\u540E\u91CD\u8BD5\u3002";
      }
    }
    readStorage();
    state = { status: "idle", life: null, morphology: null, error: readError, pending: 0, syncError: readError, audioStatus: "idle", features: null };
    refresh();
    const source = { getSnapshot: () => state, subscribe: (fn) => {
      if (disposed) return () => {
      };
      listeners.add(fn);
      return () => listeners.delete(fn);
    } };
    const url = (path) => resolveUrl ? resolveUrl(`/dsh-music/api/life${path}`) : `/dsh-music/api/life${path}`;
    function persist(next, remaining = volatile) {
      active();
      if (readError) throw failure(readError, "LIFE_OUTBOX_READ");
      if (next.pending.length + next.rejected.length > MAX_PENDING) throw failure("\u672C\u673A\u6682\u5B58\u7ECF\u5386\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u6062\u590D\u540C\u6B65\u6216\u5BFC\u51FA\u6682\u5B58\u8BB0\u5F55\u3002", "LIFE_OUTBOX_LIMIT");
      try {
        if (!storage) throw new Error("Storage unavailable");
        const raw = JSON.stringify({ version: OUTBOX_VERSION, ...next });
        storage.setItem(OUTBOX_KEY, raw);
        rawStorage = raw;
      } catch {
        storageError = "\u6D4F\u89C8\u5668\u6682\u65F6\u65E0\u6CD5\u4FDD\u5B58\u7ECF\u5386\u3002\u672A\u843D\u76D8\u7684\u8BB0\u5F55\u4EC5\u4FDD\u7559\u5728\u5F53\u524D\u9875\u9762\uFF0C\u8BF7\u91CD\u8BD5\u6216\u5BFC\u51FA\u6682\u5B58\u5185\u5BB9\u3002";
        refresh();
        throw failure(storageError, "LIFE_OUTBOX_WRITE");
      }
      outbox = next;
      volatile = remaining;
      storageError = null;
      refresh();
    }
    function recoverLocal() {
      active();
      if (readError) {
        readStorage();
        refresh();
      }
      if (readError) throw failure(readError, "LIFE_OUTBOX_READ");
      if (volatile.length) {
        const ids = /* @__PURE__ */ new Set([...outbox.pending.map((item) => item.id), ...outbox.rejected.map((item) => item.event.id)]);
        const waiting = volatile.filter((item) => !ids.has(item.id));
        const available = Math.max(0, MAX_PENDING - outbox.pending.length - outbox.rejected.length);
        if (waiting.length && !available) {
          if (!outbox.pending.length) throw failure("\u672C\u673A\u6682\u5B58\u7ECF\u5386\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u5BFC\u51FA\u4FDD\u7559\u7684\u8BB0\u5F55\u3002\u5F53\u524D\u9875\u7684\u65B0\u7ECF\u5386\u4ECD\u4FDD\u7559\u5728\u5185\u5B58\u4E2D\u3002", "LIFE_OUTBOX_LIMIT");
          return;
        }
        persist({ ...outbox, pending: [...outbox.pending, ...waiting.slice(0, available)] }, waiting.slice(available));
      }
    }
    function clearRetry() {
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
    function scheduleRetry() {
      if (disposed || retryTimer !== null) return;
      retryTimer = timers.setTimeout(() => {
        retryTimer = null;
        void flush().catch(() => {
        });
      }, retryDelay);
    }
    function retryable(error) {
      return !["LIFE_CLIENT_CLOSED", "LIFE_OUTBOX_LIMIT"].includes(error.code) && (!error.status || error.status >= 500 || error.status === 408 || error.status === 429 || error.code === "LIFE_RESPONSE_INVALID" && error.status < 400);
    }
    function eventRejection(error) {
      return error.status === 400 && error.code === "INVALID_LIFE_EVENT" || error.status === 404 && error.code === "UNKNOWN_LIFE_TRACK" || error.status === 413 && error.code === "LIFE_REQUEST_TOO_LARGE" || error.status === 409 && error.code === "LIFE_MEMORY_LIMIT";
    }
    async function request(path, options2 = {}) {
      active();
      const sequence = ++requestSequence;
      const controller = new AbortController();
      let rejectAbort;
      const aborted = new Promise((_, reject) => {
        rejectAbort = reject;
      });
      let deadline = null;
      const handle = { cancel(error) {
        if (deadline !== null) timers.clearTimeout(deadline);
        rejectAbort(error);
        controller.abort();
      } };
      requests.add(handle);
      deadline = timers.setTimeout(() => handle.cancel(failure("\u8FDE\u63A5\u751F\u547D\u6863\u6848\u8D85\u65F6\uFF0C\u7A0D\u540E\u4F1A\u91CD\u8BD5\u3002", "LIFE_REQUEST_TIMEOUT")), requestTimeout);
      try {
        const response = await Promise.race([Promise.resolve().then(() => {
          active();
          return fetcher(url(path), { cache: "no-store", ...options2, signal: controller.signal });
        }), aborted]);
        let data;
        try {
          data = await Promise.race([response.json(), aborted]);
        } catch (error) {
          if (error?.code === "LIFE_CLIENT_CLOSED" || error?.code === "LIFE_REQUEST_TIMEOUT") throw error;
          throw failure("\u751F\u547D\u6863\u6848\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BFB\u53D6\u7684\u54CD\u5E94\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "LIFE_RESPONSE_INVALID", { status: response.status });
        }
        active();
        if (!response.ok) throw failure(data?.error || "\u751F\u547D\u6863\u6848\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u3002", data?.code || "LIFE_REQUEST_FAILED", { status: response.status });
        return { data, sequence };
      } finally {
        if (deadline !== null) timers.clearTimeout(deadline);
        requests.delete(handle);
      }
    }
    function accept(data, sequence) {
      if (!data?.life || !data?.morphology || typeof data.life.id !== "string" || !Array.isArray(data.life.processedEventIds)) throw failure("\u751F\u547D\u6863\u6848\u54CD\u5E94\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u91CD\u8BD5\u3002", "LIFE_RESPONSE_INVALID");
      const previous = state.life;
      if (previous?.id === data.life.id) {
        const difference = data.life.processedEventIds.length - previous.processedEventIds.length;
        if (difference < 0 || difference === 0 && sequence < acceptedSequence) return;
      } else if (previous && sequence < acceptedSequence) return;
      acceptedSequence = Math.max(acceptedSequence, sequence);
      acceptedRevision++;
      acceptedIds = new Set(data.life.processedEventIds);
      set({ life: data.life, morphology: data.morphology, status: "ready", error: null });
    }
    function load() {
      if (disposed) return Promise.reject(closed());
      if (loadJob) return loadJob;
      const revision = acceptedRevision;
      set({ status: state.life ? "ready" : "loading" });
      loadJob = request("").then(({ data, sequence }) => {
        accept(data, sequence);
        return data;
      }).catch((error) => {
        if (revision === acceptedRevision) set({ status: state.life ? "ready" : "error", error: error.message });
        if ((outbox.pending.length || volatile.length) && retryable(error)) scheduleRetry();
        throw error;
      }).finally(() => {
        loadJob = null;
      });
      return loadJob;
    }
    function flush() {
      if (disposed) return Promise.reject(closed());
      if (flushJob) return flushJob;
      clearRetry();
      flushJob = Promise.resolve().then(async () => {
        recoverLocal();
        if (!outbox.pending.length) {
          syncError = null;
          refresh();
          return;
        }
        if (!state.life) await load();
        while (outbox.pending.length || volatile.length) {
          active();
          recoverLocal();
          if (!outbox.pending.length) break;
          const item = outbox.pending[0];
          try {
            if (!acceptedIds.has(item.id)) {
              const { data, sequence } = await request("/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
              if (!data?.life?.processedEventIds?.includes(item.id)) throw failure("\u8FD9\u6761\u7ECF\u5386\u5C1A\u672A\u5F97\u5230\u5B8C\u6574\u786E\u8BA4\uFF0C\u5C06\u4FDD\u7559\u5E76\u91CD\u8BD5\u3002", "LIFE_RESPONSE_INVALID");
              accept(data, sequence);
            }
            persist({ ...outbox, pending: outbox.pending.filter((event) => event.id !== item.id) });
            syncError = null;
            refresh();
          } catch (error) {
            if (!eventRejection(error)) throw error;
            persist({
              pending: outbox.pending.filter((event) => event.id !== item.id),
              rejected: [...outbox.rejected, { event: item, status: error.status, code: error.code, message: error.message, rejectedAt: Date.now() }]
            });
            syncError = null;
            refresh();
          }
        }
      }).catch((error) => {
        syncError = error.message;
        refresh();
        if (retryable(error)) scheduleRetry();
        throw error;
      }).finally(() => {
        flushJob = null;
      });
      return flushJob;
    }
    function rejectedError(record) {
      return failure(`${record.message} \u8FD9\u6761\u7ECF\u5386\u5DF2\u5355\u72EC\u4FDD\u7559\uFF0C\u53EF\u5BFC\u51FA\u6216\u91CD\u65B0\u5C1D\u8BD5\u3002`, record.code, { status: record.status, queued: false, quarantined: true });
    }
    function enqueue(rawEvent) {
      active();
      const id = canonicalId(rawEvent?.id);
      const held = outbox.rejected.find((item) => item.event.id === id);
      if (held) throw rejectedError(held);
      if (acceptedIds.has(id) || outbox.pending.some((item) => item.id === id) || volatile.some((item) => item.id === id)) return id;
      if (outbox.pending.length + outbox.rejected.length + volatile.length >= MAX_PENDING) throw failure("\u672C\u673A\u6682\u5B58\u7ECF\u5386\u5DF2\u6EE1\uFF0C\u8BF7\u5148\u6062\u590D\u540C\u6B65\u6216\u5BFC\u51FA\u6682\u5B58\u8BB0\u5F55\u3002", "LIFE_OUTBOX_LIMIT");
      const event = copyEvent(rawEvent);
      try {
        persist({ ...outbox, pending: [...outbox.pending, ...volatile, event] }, []);
      } catch (error) {
        volatile = [...volatile, event];
        refresh();
        scheduleRetry();
        throw failure(error.message, error.code, { queued: false, unsaved: true });
      }
      return id;
    }
    async function send(id) {
      let error;
      do {
        try {
          await flush();
        } catch (cause) {
          error = cause;
        }
        if (acceptedIds.has(id)) return;
        const held = outbox.rejected.find((item) => item.event.id === id);
        if (held) throw rejectedError(held);
        if (error) break;
      } while (outbox.pending.some((item) => item.id === id) || volatile.some((item) => item.id === id));
      if (error) throw failure(error.message, error.code, {
        status: error.status,
        queued: outbox.pending.some((item) => item.id === id),
        unsaved: volatile.some((item) => item.id === id)
      });
    }
    function submit(event) {
      try {
        return send(enqueue(event));
      } catch (error) {
        syncError = error.message;
        refresh();
        return Promise.reject(error);
      }
    }
    const online = () => {
      void flush().catch(() => {
      });
    };
    eventTarget.addEventListener?.("online", online);
    return {
      source,
      load,
      submit,
      async dispatch(type, payload = {}) {
        const event = { ...payload, type, id: eventId(type), at: Date.now() };
        await submit(event);
        return event;
      },
      retry: async () => {
        recoverLocal();
        await load();
        return flush();
      },
      async retryRejected(id) {
        recoverLocal();
        const target = id === void 0 ? null : canonicalId(id);
        const held = outbox.rejected.filter((item) => target === null || item.event.id === target);
        if (!held.length) return flush();
        const ids = new Set(held.map((item) => item.event.id));
        persist({ pending: [...outbox.pending, ...held.map((item) => item.event)], rejected: outbox.rejected.filter((item) => !ids.has(item.event.id)) });
        await flush();
        const failed = outbox.rejected.find((item) => ids.has(item.event.id));
        if (failed) throw rejectedError(failed);
      },
      setAudio: (audioStatus, features = null) => set({ audioStatus, features }),
      exportArchive: async () => (await request("/export")).data,
      exportOutbox: () => JSON.parse(JSON.stringify({
        format: "echo-life-outbox",
        version: OUTBOX_VERSION,
        exportedAt: Date.now(),
        pending: outbox.pending,
        rejected: outbox.rejected,
        volatile,
        ...readError ? { rawStorage, readError } : {},
        ...storageError ? { storageError } : {}
      })),
      dispose() {
        if (disposed) return;
        disposed = true;
        clearRetry();
        for (const request2 of requests) request2.cancel(closed());
        listeners.clear();
        eventTarget.removeEventListener?.("online", online);
      }
    };
  }

  // src/client/echo/audio.js
  var clamp3 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  function playbackDelta(previous, current) {
    const audible = (frame) => frame && frame.playing && !frame.seeking && !frame.muted && Number.isFinite(frame.volume) && frame.volume > 0 && Number.isFinite(frame.readyState) && frame.readyState >= 2 && Number.isFinite(frame.clock) && Number.isFinite(frame.position) && Number.isFinite(frame.rate) && frame.rate > 0;
    if (!audible(previous) || !audible(current) || previous.rate !== current.rate || previous.trackId !== current.trackId) return 0;
    const wall = current.clock - previous.clock;
    const media = (current.position - previous.position) * 1e3 / current.rate;
    if (wall <= 0 || wall > 3e3 || media < 0 || media > wall + Math.max(50, wall * 0.35)) return 0;
    return Math.round(Math.max(0, Math.min(wall, media)));
  }
  function summarizeSpectrum(frequencies, waveform, prior = null) {
    if (prior?.length !== frequencies.length) prior = null;
    let power = 0, total = 0, weighted = 0, flux = 0, logSum = 0;
    for (let i = 0; i < waveform.length; i++) {
      const value = (waveform[i] - 128) / 128;
      power += value * value;
    }
    for (let i = 1; i < frequencies.length; i++) {
      const value = frequencies[i] / 255;
      total += value;
      weighted += value * i / frequencies.length;
      logSum += Math.log(Math.max(value, 1e-3));
      if (prior) flux += Math.max(0, value - prior[i] / 255);
    }
    const bins = Math.max(1, frequencies.length - 1);
    const rms = Math.sqrt(power / Math.max(1, waveform.length));
    const flatness = total > 0 ? Math.exp(logSum / bins) / Math.max(total / bins, 1e-3) : 0;
    return {
      energy: clamp3(rms * 3.5),
      brightness: clamp3(total > 0 ? weighted / total * 2.5 : 0),
      rhythm: clamp3(prior ? flux / bins * 16 : 0),
      texture: clamp3(flatness)
    };
  }
  function createPlaybackObserver({ audio, submit, onStatus = () => {
  }, now = () => performance.now() }) {
    if (!audio) return { activate: async () => false, setTrack() {
    }, flush() {
    }, dispose() {
    } };
    let track2 = null, session = null, sequence = 0, previous = null;
    let segments = [], listenedMs = 0;
    let context = null, analyser = null, mediaSource = null, activation = null;
    let playbackConnected = false;
    let frequencies = null, waveform = null, previousSpectrum = null;
    let disposed = false;
    const cleanups = [];
    const keys = ["energy", "brightness", "rhythm", "texture"];
    const status = (...args) => {
      if (!disposed) {
        try {
          onStatus(...args);
        } catch {
        }
      }
    };
    const safeText = (value) => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160).trim();
    function snapshot(terminal = false) {
      const routeRunning = !mediaSource || context?.state === "running";
      return {
        clock: now(),
        position: audio.currentTime,
        playing: routeRunning && (terminal ? !!previous?.playing : !audio.paused && !audio.ended),
        muted: !!audio.muted,
        volume: audio.volume,
        readyState: audio.readyState,
        seeking: !!audio.seeking,
        rate: audio.playbackRate,
        trackId: track2?.id
      };
    }
    function resetBaseline() {
      previous = track2 ? snapshot() : null;
      previousSpectrum = null;
    }
    function flushPending() {
      if (!track2 || !session || !listenedMs) return;
      const pending = segments;
      segments = [];
      listenedMs = 0;
      for (const segment of pending) {
        let remaining = segment.ms;
        while (remaining > 0) {
          const duration = Math.min(6e4, remaining);
          const event = {
            id: `${session}-${sequence++}`,
            type: "listening",
            at: Date.now(),
            sessionId: session,
            track: { id: track2.id, title: safeText(track2.title) || "\u672A\u547D\u540D\u66F2\u76EE", artist: safeText(track2.artist) },
            listenedMs: duration,
            featureSource: segment.source,
            ...segment.source === "audio" ? { features: Object.fromEntries(keys.map((key) => [key, clamp3(segment.sums[key] / segment.ms)])) } : {}
          };
          try {
            Promise.resolve(submit(event)).catch(() => {
            });
          } catch {
          }
          remaining -= duration;
        }
      }
    }
    function disableAnalysis() {
      if (analyser) {
        try {
          mediaSource?.disconnect(analyser);
        } catch {
        }
        try {
          analyser.disconnect();
        } catch {
        }
      }
      analyser = null;
      frequencies = null;
      waveform = null;
      previousSpectrum = null;
      status("time-only");
    }
    function sample(terminal = false) {
      if (disposed || !track2) return;
      const current = snapshot(terminal);
      if (audio.loop && previous && current.playing && !current.seeking && current.position < previous.position) {
        flushPending();
        session = eventId("listen");
        sequence = 0;
      }
      const delta = playbackDelta(previous, current);
      previous = current;
      if (!delta) {
        previousSpectrum = null;
        return;
      }
      listenedMs += delta;
      let features = null;
      if (analyser && context?.state === "running") {
        try {
          analyser.getByteFrequencyData(frequencies);
          analyser.getByteTimeDomainData(waveform);
          features = summarizeSpectrum(frequencies, waveform, previousSpectrum);
          previousSpectrum = frequencies.slice();
          if (Math.floor(current.clock / 2e3) !== Math.floor((current.clock - delta) / 2e3)) status("audio", features);
        } catch {
          disableAnalysis();
        }
      }
      const source = features ? "audio" : "none";
      let segment = segments.at(-1);
      if (!segment || segment.source !== source) {
        segment = { source, ms: 0, sums: Object.fromEntries(keys.map((key) => [key, 0])) };
        segments.push(segment);
      }
      segment.ms += delta;
      if (features) for (const key of keys) segment.sums[key] += features[key] * delta;
      if (listenedMs >= 3e4) flushPending();
    }
    function flush() {
      if (!disposed) {
        sample();
        flushPending();
      }
    }
    async function closeContext(target) {
      if (target && target.state !== "closed") {
        try {
          await target.close();
        } catch {
        }
      }
    }
    async function activate() {
      if (disposed) return false;
      if (activation) return activation;
      activation = (async () => {
        try {
          const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!AudioContextClass) {
            status("time-only");
            return false;
          }
          sample();
          context ||= new AudioContextClass();
          const activeContext = context;
          if (activeContext.state !== "running") await activeContext.resume();
          if (disposed) {
            await closeContext(activeContext);
            return false;
          }
          if (activeContext.state !== "running") {
            status("time-only");
            return false;
          }
          let candidate = analyser;
          if (!candidate) {
            candidate = activeContext.createAnalyser();
            candidate.fftSize = 1024;
            candidate.smoothingTimeConstant = 0.6;
          }
          if (!mediaSource) {
            mediaSource = activeContext.createMediaElementSource(audio);
          }
          if (!playbackConnected) {
            mediaSource.connect(activeContext.destination);
            playbackConnected = true;
          }
          if (!analyser) {
            mediaSource.connect(candidate);
            analyser = candidate;
            frequencies = new Uint8Array(analyser.frequencyBinCount);
            waveform = new Uint8Array(analyser.fftSize);
          }
          resetBaseline();
          status("audio");
          return true;
        } catch {
          disableAnalysis();
          return false;
        }
      })().finally(() => {
        activation = null;
      });
      return activation;
    }
    const on = (name, fn) => {
      audio.addEventListener(name, fn);
      cleanups.push(() => audio.removeEventListener(name, fn));
    };
    on("pause", () => {
      sample(true);
      flushPending();
      previous = null;
      status("idle");
    });
    on("ended", () => {
      sample(true);
      flushPending();
      previous = null;
      status("idle");
    });
    on("seeking", () => {
      previous = null;
      previousSpectrum = null;
    });
    on("seeked", resetBaseline);
    on("volumechange", resetBaseline);
    on("ratechange", resetBaseline);
    on("playing", () => {
      resetBaseline();
      status(analyser && context?.state === "running" ? "audio" : "time-only");
    });
    on("emptied", () => {
      flushPending();
      previous = null;
      previousSpectrum = null;
    });
    const timer = setInterval(sample, 250);
    const leave = () => {
      sample();
      flushPending();
    };
    globalThis.addEventListener?.("pagehide", leave);
    return {
      activate,
      flush,
      setTrack(value) {
        if (disposed) return;
        sample(true);
        flushPending();
        previous = null;
        previousSpectrum = null;
        track2 = value && /^[0-9a-f]{8,}$/.test(value.id || "") ? value : null;
        session = track2 ? eventId("listen") : null;
        sequence = 0;
        segments = [];
        listenedMs = 0;
        if (!track2) status("idle");
      },
      dispose() {
        if (disposed) return;
        sample(true);
        flushPending();
        disposed = true;
        clearInterval(timer);
        for (const fn of cleanups) fn();
        globalThis.removeEventListener?.("pagehide", leave);
        void closeContext(context);
      }
    };
  }

  // src/client/echo/ui.css
  var ui_default = `/* ECHO's quiet, material world. Scoped to the plugin, not the Harness shell. */
.dshm-panel.echo-shell,.echo-modal-shade,.echo-mini{--echo-paper:#f5f4ee;--echo-ink:#283c35;--echo-muted:#737d73;--echo-line:#dedfd5;--echo-accent:#344f42;--echo-surface:#fcfcf7;color:var(--echo-ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC","Segoe UI",sans-serif;color-scheme:light;}
.dshm-panel.echo-shell{--dsw-alias-bg-base:#f5f4ee;--dsw-alias-bg-layer-1:#fcfcf7;--dsw-alias-bg-layer-2:#ebece3;--dsw-alias-bg-layer-3:#e0e4d8;--dsw-alias-border-l1:#dedfd5;--dsw-alias-border-l2:#cbd1c4;--dsw-alias-border-l3:#9ea996;--dsw-alias-label-primary:#283c35;--dsw-alias-label-secondary:#667268;--dsw-alias-label-tertiary:#788277;--dsw-alias-label-primary-inverted:#fafbf4;--dsw-alias-brand-primary:#486951;--dsw-alias-brand-text:#3d5d48;--dsw-alias-button-primary-fill:#344f42;--dsw-alias-button-primary-hover:#45634f;--dsw-alias-interactive-bg-hover:#e9ece1;--dsw-alias-interactive-bg-active:#dfe6d5;--dsw-alias-bg-mask-2:#24322b55;--dsw-alias-scrollbar-bg-l2:#c8cebf;--dsw-alias-scrollbar-hover-l2:#a3ad99;--dsw-alias-bg-skeleton:#e7e9dd;--dsw-alias-state-error-primary:#a44b34;--dsw-alias-state-success-primary:#477250;--dsw-alias-state-warn-primary:#99793c;background:var(--echo-paper);height:100%;min-height:0;overflow:hidden;}
.echo-shell *,.echo-modal-shade *,.echo-mini *{box-sizing:border-box;}
.echo-shell :focus-visible,.echo-modal-shade :focus-visible,.echo-mini :focus-visible{outline:2px solid #668965!important;outline-offset:4px;}
.echo-shell .dshm-header{background:var(--echo-paper);border-bottom:1px solid var(--echo-line);min-height:78px;gap:32px;padding:0 40px;align-items:center;flex-wrap:nowrap;}
.echo-shell .dshm-title{font-size:20px;letter-spacing:.13em;font-weight:500;}
.echo-shell .dshm-count{font-size:10px;letter-spacing:.08em;border-left:1px solid var(--echo-line);padding-left:12px;}
.echo-shell .dshm-signal{color:#57735b;gap:2px;margin-right:5px;transform:rotate(-10deg);}
.echo-shell .dshm-signal i{width:2px;}
.echo-shell .dshm-tabs{flex:1;order:0;width:auto;min-width:0;justify-content:center;overflow:visible;gap:10px;height:78px;}
.echo-shell .dshm-tab{position:relative;padding:0 20px;font-size:13px;letter-spacing:.12em;font-weight:400;}
.echo-shell .dshm-tab[aria-current="page"]{color:var(--echo-ink);font-weight:600;}
.echo-shell .dshm-tab[aria-current="page"]::after{height:2px;left:22px;right:22px;background:#627b55;bottom:18px;}
.echo-shell .dshm-header-actions{gap:10px;}
.echo-shell .dshm-terminal{border:0;background:transparent;gap:8px;color:var(--echo-muted);}
.echo-shell .dshm-terminal-text{font-family:inherit;}
.echo-shell .dshm-body{min-height:0;flex:1;overflow:auto;scrollbar-width:thin;}
.echo-more-menu{position:relative;}
.echo-more-menu summary{list-style:none;cursor:pointer;color:var(--echo-muted);font-size:19px;letter-spacing:2px;padding:5px 8px;}
.echo-more-menu summary::-webkit-details-marker{display:none;}
.echo-more-menu>div{position:absolute;top:35px;right:0;min-width:150px;padding:7px;border:1px solid var(--echo-line);border-radius:12px;background:var(--echo-surface);box-shadow:0 12px 30px #25392b15;z-index:50;}
.echo-more-menu button{display:block;appearance:none;font:inherit;font-size:12px;border:0;background:none;width:100%;text-align:left;padding:10px 12px;border-radius:6px;color:var(--echo-ink);cursor:pointer;}
.echo-more-menu button:hover{background:#e9ece2;}
.echo-home{max-width:1280px;margin:0 auto;padding:30px 56px 20px;position:relative;}
.echo-chapter{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px;}
.echo-eyebrow{font-size:9px;line-height:1.5;letter-spacing:.2em;font-weight:500;margin:0;color:var(--echo-muted);}
.echo-chapter-day{display:flex;align-items:center;gap:8px;color:#6f7a6b;font-size:11px;}
.echo-chapter-day i{width:5px;height:5px;background:#738d62;border-radius:50%;}
.echo-home-intro{text-align:center;position:relative;z-index:2;}
.echo-home-intro h2,.echo-page-heading h2{font-family:"Iowan Old Style","Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:clamp(27px,3.2vw,40px);font-weight:400;letter-spacing:.035em;line-height:1.4;margin:0 0 13px;overflow-wrap:anywhere;}
.echo-home-intro>p{font-size:12px;letter-spacing:.07em;color:var(--echo-muted);margin:0;line-height:1.8;}
.echo-habitat{height:390px;position:relative;isolation:isolate;max-width:1000px;margin:0 auto;}
.echo-habitat-light{position:absolute;inset:5% 9% 8%;background:radial-gradient(ellipse at 53% 35%,#fffff9aa,transparent 68%);pointer-events:none;z-index:-1;}
.echo-habitat-ground{position:absolute;left:16%;right:16%;bottom:44px;height:1px;background:linear-gradient(90deg,transparent,#cdd1c255,transparent);pointer-events:none;}
.echo-creature-stage{position:absolute;inset:-24px 15% 30px;display:flex;align-items:center;justify-content:center;}
.echo-creature-stage>.echo-creature{width:100%;height:100%;max-width:600px;}
.echo-specimen-note{position:absolute;top:45%;left:2%;display:flex;flex-direction:column;gap:9px;align-items:flex-start;writing-mode:vertical-rl;transform:rotate(180deg);color:#84907f;font-size:8px;letter-spacing:.23em;}
.echo-specimen-note small{font-family:"SFMono-Regular",Consolas,monospace;font-size:8px;opacity:.6;}
.echo-identity{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);text-align:center;white-space:nowrap;max-width:calc(100% - 40px);}
.echo-name-row{display:flex;gap:7px;align-items:center;justify-content:center;}
.echo-name-row h3{font-size:17px;font-weight:500;letter-spacing:.15em;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.echo-name-row button{flex:none;}
.echo-identity p{margin:9px 0 0;font-size:11px;color:var(--echo-muted);letter-spacing:.04em;}
.echo-quiet-icon{background:none;appearance:none;border:0;display:inline-flex;align-items:center;justify-content:center;padding:7px;color:#84907f;cursor:pointer;border-radius:50%;}
.echo-quiet-icon:hover,.echo-quiet-icon.is-active{background:#e8ebdf;color:#3a5947;}
.echo-habitat-tools{position:absolute;right:2%;top:42%;}
.echo-mark-caption{position:absolute;right:2%;bottom:50px;display:flex;align-items:center;gap:8px;background:none;border:0;font-size:10px;color:var(--echo-muted);cursor:pointer;}
.echo-mark-caption i{width:5px;height:5px;border-radius:50%;background:#aa8952;}
.echo-action-row{display:flex;gap:12px;align-items:center;justify-content:center;margin:20px 0 34px;}
.echo-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:12px 20px;min-height:43px;appearance:none;border:1px solid #d8ddce;border-radius:8px;background:#fafbf555;color:var(--echo-ink);font:inherit;font-size:12px;letter-spacing:.025em;cursor:pointer;transition:background .18s,border-color .18s,transform .18s;white-space:nowrap;}
.echo-button:hover{background:#e9eddf;border-color:#b8c6aa;}
.echo-button:active{transform:translateY(1px);}
.echo-button:disabled{opacity:.5;cursor:default;}
.echo-button-primary{background:#344f42;color:#f8faf3;border-color:#344f42;}
.echo-button-primary:hover{background:#45634f;border-color:#45634f;}
.echo-home-bottom{border-top:1px solid var(--echo-line);display:flex;align-items:center;justify-content:space-between;padding-top:21px;gap:22px;}
.echo-bottom-story p{font-size:11px;color:#7a8275;line-height:1.8;margin:6px 0 0;}
.echo-text-actions{display:flex;align-items:center;gap:25px;}
.echo-text-actions>button{display:inline-flex;align-items:center;gap:7px;appearance:none;border:0;background:none;font:inherit;font-size:11px;color:#60725f;cursor:pointer;padding:6px 0;}
.echo-text-actions>button:hover{color:#263e2f;}
.echo-dock{position:relative;display:grid;grid-template-columns:minmax(180px,1fr) minmax(200px,1.2fr) minmax(100px,1fr);gap:30px;align-items:center;background:#fbfcf7;border-top:1px solid var(--echo-line);padding:14px 35px;min-height:91px;flex-shrink:0;}
.echo-dock button{appearance:none;border:0;background:none;color:var(--echo-ink);cursor:pointer;}
.echo-dock button:disabled{opacity:.35;cursor:default;}
.echo-dock-track{display:flex;align-items:center;gap:12px;min-width:0;text-align:left;padding:0;font:inherit;}
.echo-dock-track>span:last-child{display:flex;flex-direction:column;gap:5px;min-width:0;}
.echo-dock-track strong{font-size:12px;font-weight:500;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}
.echo-dock-track small{font-size:10px;color:#7e897a;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}
.echo-dock-art{width:46px;height:46px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#e8edde;color:#8d9c7c;border-radius:7px;overflow:hidden;}
.echo-dock-art img{width:100%;height:100%;object-fit:cover;}
.echo-play-controls{display:flex;align-items:center;justify-content:center;gap:22px;}
.echo-play-controls>button{display:flex;padding:3px;align-items:center;justify-content:center;}
.echo-play-controls>.echo-play-main{background:#344f42;color:#fbfcf7;width:32px;height:32px;border-radius:50%;}
.echo-dock-progress{display:flex;align-items:center;gap:9px;margin-top:8px;}
.echo-dock time{font-size:9px;color:#8b9483;font-family:"SFMono-Regular",Consolas,monospace;min-width:27px;}
.echo-dock input[type="range"],.echo-timeline-story input[type="range"]{appearance:none;flex:1;min-width:0;height:3px;background:#dce2d2;border-radius:3px;accent-color:#59734e;cursor:pointer;}
.echo-dock input[type="range"]::-webkit-slider-thumb,.echo-timeline-story input[type="range"]::-webkit-slider-thumb{appearance:none;width:9px;height:9px;border-radius:50%;background:#658059;}
.echo-dock-volume{display:flex;align-items:center;justify-content:flex-end;gap:10px;}
.echo-dock-volume>input{max-width:75px;}
.echo-playback-error{position:absolute;bottom:100%;background:#f6e8dd;border:1px solid #d9bdaa;padding:8px 15px;border-radius:6px;font-size:11px;left:30px;color:#944e35;}
.echo-modal-shade{position:fixed;inset:0;background:#23362c50;display:flex;align-items:center;justify-content:center;z-index:2147483000;padding:20px;}
.echo-dialog{position:relative;background:#fafbf5;width:min(470px,100%);max-height:85vh;overflow:auto;border:1px solid #d8dfce;border-radius:17px;box-shadow:0 24px 100px #1c332b30;padding:35px;}
.echo-dialog-wide{width:min(760px,100%);}
.echo-dialog-close{position:absolute;right:15px;top:15px;display:flex;appearance:none;border:0;background:none;cursor:pointer;color:var(--echo-muted);padding:7px;}
.echo-dialog h2{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:25px;font-weight:400;line-height:1.45;margin:14px 0 12px;overflow-wrap:anywhere;}
.echo-dialog-copy{color:var(--echo-muted);font-size:12px;line-height:1.9;margin:0 0 23px;}
.echo-field{display:flex;flex-direction:column;gap:9px;margin:17px 0;color:#64715f;font-size:11px;}
.echo-field input,.echo-field textarea{appearance:none;width:100%;resize:vertical;border:1px solid #d4dccb;background:#fffef9;padding:12px;border-radius:7px;color:var(--echo-ink);font:inherit;font-size:13px;line-height:1.7;}
.echo-field input::placeholder,.echo-field textarea::placeholder{color:#949b8b;}
.echo-submit{width:100%;margin-top:7px;}
.echo-dialog-actions{display:flex;justify-content:space-between;gap:12px;margin-top:22px;}
.echo-tap-pad{width:100%;display:flex;flex-direction:column;align-items:center;gap:11px;padding:25px;min-height:175px;appearance:none;border:1px dashed #becbb0;background:#edf1e5;color:#58764e;cursor:pointer;border-radius:12px;touch-action:manipulation;}
.echo-tap-pad:active{background:#dde8ce;transform:scale(.99);}
.echo-tap-pad span{font-size:13px;}
.echo-tap-pad small{font-size:10px;opacity:.65;}
.echo-beat-sequence{display:flex;gap:7px;justify-content:center;align-items:center;min-height:35px;margin-top:10px;}
.echo-beat-sequence i{height:5px;width:12px;border-radius:5px;background:#dce3d3;}
.echo-beat-sequence i.is-filled{background:#6d8b58;}
.echo-about-copy p,.echo-memory-reading p{font-size:12px;line-height:2;color:#66745f;white-space:pre-wrap;overflow-wrap:anywhere;}
.echo-about-copy dl{font-size:11px;margin:20px 0;display:grid;grid-template-columns:90px 1fr;gap:14px 10px;line-height:1.8;}
.echo-about-copy dt{color:#929c86;}
.echo-about-copy dd{margin:0;}
.echo-related-track{display:flex;align-items:center;gap:9px;font-size:11px;padding-top:18px;border-top:1px solid var(--echo-line);color:#829074;}
.echo-sync-status{margin:12px 0;color:#977347;font-size:11px;line-height:1.8;}
.echo-sync-summary{display:flex;align-items:center;justify-content:center;gap:15px;flex-wrap:wrap;}
.echo-sync-status details{margin:9px auto;max-width:680px;}
.echo-sync-status summary{cursor:pointer;}
.echo-sync-status ul{padding-left:20px;}
.echo-sync-status li{padding:4px 0;}
.echo-sync-status li button{margin-left:12px;}
.echo-sync-status button{appearance:none;border:0;background:none;text-decoration:underline;color:inherit;cursor:pointer;}
.echo-notice{position:fixed;bottom:112px;left:50%;transform:translateX(-50%);border:1px solid #ccdabf;border-radius:10px;background:#f8fbf2;padding:13px 23px;box-shadow:0 8px 30px #253c2b18;color:#4a6740;font-size:12px;z-index:100;max-width:85vw;}
.echo-error{color:#a15b40;font-size:12px;line-height:1.8;}
.echo-empty-life{display:flex;align-items:center;justify-content:center;flex-direction:column;min-height:450px;padding:40px;text-align:center;}
.echo-empty-life h2{font-family:"Songti SC",Georgia,serif;font-weight:400;font-size:24px;}
.echo-empty-life p{font-size:12px;color:#7f8c75;max-width:450px;line-height:1.9;}
.echo-wait-mark{height:65px;width:65px;border:1px solid #c4d0b6;border-radius:34% 61% 50% 42%;transform:rotate(-17deg);background:#e4ebd9;}
.echo-memories-page,.echo-gallery-page{padding:35px 46px 50px;max-width:1250px;margin:0 auto;}
.echo-page-heading{display:flex;justify-content:space-between;gap:30px;align-items:center;margin-bottom:30px;}
.echo-page-heading h2{font-size:30px;margin-top:13px;}
.echo-page-heading>div>p:last-child{font-size:12px;color:var(--echo-muted);line-height:1.8;margin-bottom:0;}
.echo-time-room{display:grid;grid-template-columns:1.2fr 1fr;align-items:center;gap:35px;background:#edf0e5;border-radius:12px;padding:15px 40px 15px 10px;min-height:320px;}
.echo-timeline-creature{height:300px;}
.echo-timeline-creature .echo-creature{height:100%;width:100%;}
.echo-timeline-story h3{font-size:21px;font-weight:400;margin:15px 0;line-height:1.5;}
.echo-timeline-story>p:not(.echo-eyebrow){font-size:12px;color:#79866e;line-height:1.9;}
.echo-timeline-story input[type="range"]{width:100%;margin:20px 0;display:block;}
.echo-range-labels{display:flex;justify-content:space-between;color:#86917d;font-size:10px;}
.echo-range-labels button{font:inherit;background:none;border:0;color:#587249;cursor:pointer;padding:0;}
.echo-timeline-story small{font-size:10px;color:#87947d;display:block;margin-top:17px;line-height:1.7;}
.echo-memory-heading{display:flex;align-items:center;justify-content:space-between;padding:32px 0 12px;border-bottom:1px solid var(--echo-line);}
.echo-memory-heading h3{font-size:14px;font-weight:500;}
.echo-memory-heading>span{font-size:11px;color:#87917d;}
.echo-memory-item{display:flex;align-items:center;gap:24px;width:100%;padding:24px 8px;border:0;border-bottom:1px solid var(--echo-line);background:none;text-align:left;color:inherit;cursor:pointer;font:inherit;}
.echo-memory-item:hover{background:#e9eee1;}
.echo-memory-number{font-family:Georgia,serif;font-size:24px;color:#a9b29d;width:30px;flex:none;}
.echo-memory-item>div{flex:1;min-width:0;}
.echo-memory-item h4{font-weight:500;font-size:13px;margin:0 0 8px;overflow-wrap:anywhere;}
.echo-memory-item p{font-size:11px;color:#8b957e;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px;}
.echo-memory-item time{font-size:10px;color:#89967a;white-space:nowrap;}
.echo-memory-empty{padding:40px;text-align:center;color:#87977a;}
.echo-memory-empty>svg{margin:0 auto 8px;}
.echo-memory-empty p{font-size:12px;margin-bottom:20px;}
.echo-study-controls{display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin:12px 0;}
.echo-segmented{padding:4px;background:#e7ebdf;border:1px solid #dfe5d4;border-radius:8px;display:flex;gap:4px;}
.echo-segmented button{font:inherit;font-size:11px;padding:9px 15px;color:#7b8d6e;background:none;border:0;border-radius:5px;cursor:pointer;}
.echo-segmented button[aria-pressed="true"]{background:#fafcf5;color:#3a5b2c;box-shadow:0 1px 4px #34492a10;}
.echo-study-controls label{display:flex;align-items:center;gap:6px;color:#7f8e72;font-size:11px;cursor:pointer;}
.echo-study-controls input{accent-color:#567945;}
.echo-study-note{font-size:10px;color:#8c9780;margin:15px 0 25px;line-height:1.8;}
.echo-specimen-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
.echo-specimen-card{background:#fafbf6;border:1px solid #e3e7da;border-radius:10px;overflow:hidden;min-width:0;}
.echo-specimen-creature{height:230px;display:flex;align-items:center;justify-content:center;}
.echo-specimen-creature>.echo-creature{height:100%;width:100%;}
.echo-specimen-caption{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-top:1px solid #ecf0e5;color:#929e86;font-size:10px;}
.echo-specimen-caption>span:first-child{font-family:Georgia,serif;font-size:18px;color:#758566;}
.echo-specimen-grid.is-silhouette .echo-creature svg{filter:brightness(0) opacity(.7);}

.echo-shell .dshm-console-card,.echo-shell .dshm-feature{background:#fafbf5;border-color:#dbe2d0;}
.echo-shell .dshm-command-form{background:#fafcf5;border-color:#bdcdb0;}
.echo-shell .dshm-feature svg,.echo-shell .dshm-command-form>svg{color:#718e5c;}
.echo-shell .dshm-feature:hover,.echo-shell .dshm-feature[aria-pressed="true"]{background:#e6eddc;border-color:#9dbb85;}
.echo-shell .dshm-kicker{color:#819b6b;}
@container dshm-shell (max-width:850px){
 .echo-shell .dshm-header{padding:0 20px;gap:12px;min-height:66px;}
 .echo-shell .dshm-tabs{height:66px;gap:2px;}
 .echo-shell .dshm-tab{padding:0 12px;}
 .echo-shell .dshm-count,.echo-shell .dshm-terminal-text{display:none;}
 .echo-home{padding:25px 25px 20px;}
 .echo-habitat{height:355px;}
 .echo-home-bottom{align-items:flex-start;}
 .echo-text-actions{gap:12px;flex-wrap:wrap;justify-content:flex-end;}
 .echo-memories-page,.echo-gallery-page{padding:28px 25px;}
 .echo-page-heading h2{font-size:25px;}
 .echo-time-room{gap:15px;padding:15px 20px 15px 0;}
 .echo-specimen-creature{height:180px;}
 .echo-dock{padding:14px 22px;gap:20px;grid-template-columns:minmax(140px,1fr) minmax(160px,1.2fr) 100px;}
}
@container dshm-shell (max-width:600px){
 .echo-shell .dshm-header{padding:0 15px;gap:10px;}
 .echo-shell .dshm-title{font-size:16px;}
 .echo-shell .dshm-title-row{gap:3px;}
 .echo-shell .dshm-tabs{justify-content:flex-end;gap:0;}
 .echo-shell .dshm-tab{font-size:12px;padding:0 10px;letter-spacing:0;}
 .echo-shell .dshm-tab[aria-current="page"]::after{left:10px;right:10px;}
 .echo-shell .dshm-header-actions>.dshm-terminal,.echo-shell .dshm-header-actions>.dshm-iconbtn{display:none;}
 .echo-home{padding:21px 19px;}
 .echo-chapter{margin-bottom:23px;}
 .echo-eyebrow{font-size:8px;letter-spacing:.16em;}
 .echo-chapter-day{font-size:10px;}
 .echo-home-intro h2{font-size:25px;line-height:1.55;max-width:280px;margin:0 auto 12px;}
 .echo-home-intro>p{font-size:10px;letter-spacing:0;}
 .echo-habitat{height:315px;}
 .echo-creature-stage{inset:-7px -5% 30px;}
 .echo-specimen-note{left:0;top:40%;}
 .echo-habitat-tools{right:0;top:38%;}
 .echo-mark-caption{bottom:3px;right:0;font-size:0;gap:4px;}
 .echo-action-row{gap:7px;margin:20px 0 29px;}
 .echo-action-row>.echo-button{font-size:10px;padding:10px 12px;gap:5px;min-height:42px;}
 .echo-action-row>.echo-button svg{width:15px;}
 .echo-home-bottom{flex-direction:column;gap:14px;}
 .echo-text-actions{width:100%;justify-content:space-between;}
 .echo-dock{padding:12px 16px;grid-template-columns:minmax(110px,1fr) 130px;gap:12px;min-height:83px;}
 .echo-dock-art{width:37px;height:37px;}
 .echo-dock-volume{display:none;}
 .echo-dock-track{gap:8px;}
 .echo-dock-track strong{font-size:11px;}
 .echo-play-controls{gap:16px;}
 .echo-dock-progress{gap:4px;}
 .echo-dock time{font-size:8px;}
 .echo-page-heading{flex-direction:column;align-items:flex-start;gap:18px;}
 .echo-page-heading h2{font-size:25px;}
 .echo-time-room{grid-template-columns:1fr;padding:5px 20px 25px;gap:0;}
 .echo-timeline-creature{height:225px;}
 .echo-specimen-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;}
 .echo-specimen-creature{height:150px;}
 .echo-specimen-caption{padding:10px;font-size:9px;gap:8px;}
 .echo-specimen-caption>span:last-child{max-width:65px;text-align:right;line-height:1.6;}
 .echo-study-controls{gap:15px;}
 .echo-segmented button{padding:9px 12px;}
 .echo-memory-item{gap:12px;padding:20px 0;}
 .echo-memory-item time{display:none;}
 .echo-memory-number{width:25px;font-size:20px;}
 .echo-dialog{padding:30px 24px;}
 .echo-notice{bottom:100px;font-size:11px;width:max-content;}
}
/* A free silhouette owns the companion. Controls have their own fixed anchor. */
.echo-mini-presence{--echo-soft:#e8ecdf;--echo-inverse:#fafbf5;--echo-danger:#974c3b;position:fixed;right:20px;bottom:20px;z-index:2147482000;width:320px;max-width:calc(100vw - 24px);padding:18px 0 0;background:none;border:0;border-radius:0;box-shadow:none;pointer-events:none;line-height:1.5;isolation:isolate;}
.echo-mini-presence button,.echo-mini-presence input{font:inherit;pointer-events:auto;}
.echo-mini-presence button{appearance:none;border:0;background:none;color:inherit;cursor:pointer;}
.echo-mini-presence button:disabled{cursor:default;opacity:.38;}
.echo-mini-presence button:not(:disabled):active{transform:translateY(1px);}
.echo-mini-presence[data-tone="dark"]{--echo-paper:#222920;--echo-ink:#e4ebdd;--echo-muted:#adbba5;--echo-line:#46513f;--echo-accent:#b3cda3;--echo-surface:#293126;--echo-soft:#35402f;--echo-inverse:#1d2a18;--echo-danger:#e3a18e;color-scheme:dark;}
.echo-mini-grip{position:absolute;top:0;left:50%;transform:translateX(-50%);display:flex;justify-content:center;align-items:center;gap:4px;width:56px;height:24px;padding:0;cursor:grab!important;touch-action:none;border-radius:12px;}
.echo-mini-grip i{height:2px;width:3px;border-radius:50%;background:var(--echo-muted);opacity:.55;}
.echo-mini-grip:hover i,.echo-mini-grip:focus-visible i{opacity:1;}
.echo-mini-creature{position:relative;width:100%;}
.echo-mini-creature>.echo-creature{width:100%;pointer-events:auto;}
.echo-mini-memory-button{position:absolute;right:14%;bottom:18%;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;color:#a08256!important;opacity:.65;}
.echo-mini-memory-button:hover,.echo-mini-memory-button:focus-visible{opacity:1;background:var(--echo-surface);}
.echo-mini-memory-button svg{width:13px;height:13px;}
.echo-mini-foot{display:flex;justify-content:center;align-items:center;gap:7px;height:44px;margin:0;pointer-events:none;}
.echo-mini-quiet{display:grid;place-items:center;width:40px;height:40px;padding:0;border-radius:50%;color:var(--echo-muted)!important;}
.echo-mini-music{display:inline-flex;justify-content:center;align-items:center;gap:6px;min-height:40px;padding:0 12px;border-radius:20px;font-size:12px!important;color:var(--echo-muted)!important;}
.echo-mini-quiet:not(:disabled):hover,.echo-mini-music:hover,.echo-mini-music[aria-expanded="true"]{background:var(--echo-soft);color:var(--echo-accent)!important;}
.echo-mini-playback-status{display:block;width:max-content;max-width:100%;margin:2px auto 0;padding:4px 9px;font-size:11px!important;color:var(--echo-muted)!important;pointer-events:auto;text-align:center;border-radius:8px;}
.echo-mini-playback-status.is-error{color:var(--echo-danger)!important;background:var(--echo-surface);}
.echo-mini-tools{position:fixed;width:286px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;padding:14px;background:var(--echo-surface);border:1px solid var(--echo-line);border-radius:18px;box-shadow:0 12px 36px #1b2e2317;pointer-events:auto;scrollbar-width:thin;z-index:3;font-size:12px;}
.echo-mini-tools-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.echo-mini-tools-head>div{min-width:0;}
.echo-mini-tools-head strong{display:block;font-size:13px;font-weight:500;overflow-wrap:anywhere;line-height:1.55;}
.echo-mini-tools-head small{display:block;font-size:11px;color:var(--echo-muted);margin-top:3px;overflow-wrap:anywhere;}
.echo-mini-close{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:50%;color:var(--echo-muted)!important;}
.echo-mini-close:hover,.echo-mini-paper-close:hover{background:var(--echo-soft);}
.echo-mini-transport{display:flex;justify-content:center;align-items:center;gap:15px;margin:14px 0 12px;}
.echo-mini-transport button{display:grid;place-items:center;width:44px;height:44px;padding:0;border-radius:50%;}
.echo-mini-transport .echo-mini-play-main{background:var(--echo-accent);color:var(--echo-inverse);width:48px;height:48px;}
.echo-mini-transport button:not(.echo-mini-play-main):not(:disabled):hover{background:var(--echo-soft);}
.echo-mini [aria-busy="true"] svg{animation:echo-mini-loading 1s linear infinite;}
.echo-mini-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;}
.echo-mini-actions>button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:52px;padding:5px 2px;border-radius:9px;font-size:11px;}
.echo-mini-actions>button[aria-pressed="true"],.echo-mini-actions>button[aria-expanded="true"],.echo-mini-actions>button:not(:disabled):hover{background:var(--echo-soft);color:var(--echo-accent);}
.echo-mini-hint{margin:9px 0;font-size:11px;color:var(--echo-muted);overflow-wrap:anywhere;}
.echo-mini-feedback{margin-top:11px;padding:10px 0 0;border-top:1px solid var(--echo-line);font-size:11px;overflow-wrap:anywhere;}
.echo-mini-feedback p,.echo-mini-error p{margin:0;line-height:1.7;}
.echo-mini-feedback.is-error,.echo-mini-error{color:var(--echo-danger);}
.echo-mini-feedback button,.echo-mini-error button,.echo-mini-text,.echo-mini-select-track{min-height:36px;padding:7px 0;text-align:left;color:var(--echo-accent)!important;font-size:11px!important;text-decoration:underline;text-underline-offset:4px;}
.echo-mini-select-track{display:block;width:100%;text-align:center;}
.echo-mini-more{margin-top:12px;padding-top:12px;border-top:1px solid var(--echo-line);}
.echo-mini-range{display:block;}
.echo-mini-range>span{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;color:var(--echo-muted);}
.echo-mini-range time{font-variant-numeric:tabular-nums;}
.echo-mini input[type="range"]{display:block;width:100%;min-width:0;height:28px;padding:0;margin:3px 0 0;accent-color:var(--echo-accent);}
.echo-mini-volume{display:flex;align-items:center;gap:8px;margin-top:6px;}
.echo-mini-volume button{width:36px;height:36px;flex:none;display:grid;place-items:center;border-radius:50%;}
.echo-mini-volume input{flex:1;}
.echo-mini-secondary{display:flex;justify-content:space-between;gap:8px;margin-top:4px;}
.echo-mini-secondary button{min-height:36px;padding:5px 8px;font-size:11px;border-radius:8px;color:var(--echo-muted);}
.echo-mini-secondary button:hover,.echo-mini-window-actions button:hover{background:var(--echo-soft);color:var(--echo-accent);}
.echo-mini-queue{padding:4px;margin:8px 0 0;list-style:none;border-radius:10px;background:var(--echo-paper);max-height:190px;overflow:auto;scrollbar-width:thin;}
.echo-mini-queue button{display:block;width:100%;text-align:left;padding:9px 8px;border-radius:7px;font-size:12px;}
.echo-mini-queue button[aria-current="true"]{background:var(--echo-soft);color:var(--echo-accent);}
.echo-mini-queue span,.echo-mini-queue small{display:block;overflow-wrap:anywhere;}
.echo-mini-queue small{font-size:11px;color:var(--echo-muted);margin-top:3px;}
.echo-mini-window-actions{display:flex;flex-wrap:wrap;justify-content:space-between;gap:3px;padding-top:8px;margin-top:8px;border-top:1px solid var(--echo-line);}
.echo-mini-window-actions button{display:flex;align-items:center;gap:5px;min-height:36px;padding:5px 6px;border-radius:7px;font-size:11px;color:var(--echo-muted);}
.echo-mini-paper{position:fixed;width:280px;max-width:calc(100vw - 24px);padding:12px 37px 12px 15px;max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;background:var(--echo-surface);border:1px solid var(--echo-line);border-radius:4px 14px 14px 14px;box-shadow:0 5px 20px #1b2e2310;pointer-events:auto;z-index:2;}
.echo-mini-paper-title{font-size:10px;color:var(--echo-muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.echo-mini-paper p{font-size:13px;line-height:1.7;margin:5px 0 0;overflow-wrap:anywhere;}
.echo-mini-paper.is-lyrics p{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}
.echo-mini-paper.is-memory p{max-height:180px;overflow:auto;white-space:pre-wrap;scrollbar-width:thin;}
.echo-mini-paper small{display:block;margin-top:10px;font-size:11px;color:var(--echo-muted);overflow-wrap:anywhere;}
.echo-mini-paper-close{position:absolute;right:3px;top:3px;width:30px;height:30px;display:grid;place-items:center;padding:0;border-radius:50%;color:var(--echo-muted)!important;}
@keyframes echo-mini-loading{to{transform:rotate(360deg);}}
@media(pointer:coarse){.echo-mini-quiet{width:44px;height:44px;}.echo-mini-music{min-height:44px;}.echo-mini-close,.echo-mini-paper-close{width:40px;height:40px;}.echo-mini-paper{padding-right:47px;}.echo-mini-grip{height:30px;top:-4px;}.echo-mini-window-actions button,.echo-mini-secondary button,.echo-mini-text{min-height:44px;}}
@media(prefers-reduced-motion:reduce){.echo-button,.echo-mini{transition:none;}.echo-tap-pad:active{transform:none;}.echo-mini [aria-busy="true"] svg{animation:none;}}
`;

  // src/client/echo/creature.css
  var creature_default = '.echo-creature {\n  position: relative;\n  width: 100%;\n  min-width: 0;\n  isolation: isolate;\n  --echo-look-x: 0px;\n  --echo-look-y: 0px;\n  --echo-look-r: 0deg;\n  -webkit-tap-highlight-color: transparent;\n}\n\n.echo-creature-svg {\n  display: block;\n  width: 100%;\n  height: auto;\n  overflow: visible;\n  user-select: none;\n}\n\n.echo-creature-drift,\n.echo-creature-breath,\n.echo-creature-response,\n.echo-creature-attention {\n  transform-box: view-box;\n  transform-origin: var(--echo-origin-x, 50.5%) var(--echo-origin-y, 73%);\n}\n\n.echo-creature-drift {\n  animation: echo-drift var(--echo-drift-duration, 15s) ease-in-out infinite;\n}\n\n.echo-creature-breath {\n  animation: echo-breathe var(--echo-breath-duration, 8.5s) ease-in-out infinite;\n}\n\n.echo-creature-attention {\n  transform: translate(var(--echo-look-x), var(--echo-look-y)) rotate(var(--echo-look-r));\n  transition: transform 650ms cubic-bezier(.18, .7, .2, 1);\n}\n\n.echo-creature-shadow {\n  opacity: var(--echo-shadow-opacity, .21);\n  transform-box: fill-box;\n  transform-origin: center;\n  animation: echo-contact var(--echo-drift-duration, 15s) ease-in-out infinite;\n}\n\n.echo-creature-contact { animation: none; opacity: calc(var(--echo-shadow-opacity, .21) * 1.12); }\n\n.echo-creature[data-active="true"] .echo-creature-breath {\n  animation-name: echo-listen;\n  /* This conveys listening, not beat detection. Actual audio drives growth. */\n  animation-duration: var(--echo-listen-duration, 4.6s);\n}\n\n.echo-creature[data-responding="true"] .echo-creature-response {\n  animation: echo-response var(--echo-response-duration, 1.3s) cubic-bezier(.22, .68, .18, 1) both;\n}\n\n.echo-creature[data-structure="shell"] .echo-creature-drift {\n  animation-name: echo-shell-drift;\n}\n\n.echo-creature[data-structure="ribbon"] .echo-creature-drift {\n  animation-name: echo-ribbon-drift;\n}\n\n.echo-creature[data-structure="shell"][data-responding="true"] .echo-creature-response {\n  animation-name: echo-shell-response;\n}\n\n.echo-creature[data-structure="ribbon"][data-responding="true"] .echo-creature-response {\n  animation-name: echo-ribbon-response;\n}\n\n.echo-fold-leaf,\n.echo-shell-feet,\n.echo-body-shell,\n.echo-memory-pose,\n.echo-body-ribbon {\n  transition: transform 1300ms cubic-bezier(.2, .75, .15, 1), opacity 600ms ease;\n}\n\n.echo-creature[data-compact="true"] .echo-creature-drift {\n  animation-duration: 17s;\n}\n\n.echo-creature[data-compact="true"] .echo-creature-breath {\n  animation-duration: 10s;\n}\n\n.echo-creature-touch-target[role="button"] { cursor: pointer; outline: none; }\n.echo-creature-focus-ring { stroke: transparent; stroke-width: 1.25; }\n.echo-creature-touch-target:focus-visible .echo-creature-focus-ring { stroke: #718274; stroke-dasharray: 3 5; }\n.echo-creature-touch-target:focus-visible .echo-creature-surface { opacity: .94; }\n.echo-memory-mark[role="button"] { cursor: pointer; outline: none; }\n.echo-memory-halo { opacity: 0; transition: opacity 220ms ease; }\n.echo-memory-mark:hover .echo-memory-halo,\n.echo-memory-mark:focus-visible .echo-memory-halo { opacity: .75; }\n.echo-memory-mark:focus-visible .echo-memory-hit { fill: #b5905e16; }\n\n.echo-creature[data-motion="off"] .echo-creature-drift,\n.echo-creature[data-motion="off"] .echo-creature-breath,\n.echo-creature[data-motion="off"] .echo-creature-shadow,\n.echo-creature[data-motion="off"] .echo-creature-response { animation: none !important; }\n.echo-creature[data-motion="off"] .echo-creature-attention { transform: none; transition: none; }\n.echo-creature[data-motion="off"] .echo-fold-leaf,\n.echo-creature[data-motion="off"] .echo-shell-feet,\n.echo-creature[data-motion="off"] .echo-body-shell,\n.echo-creature[data-motion="off"] .echo-memory-pose,\n.echo-creature[data-motion="off"] .echo-body-ribbon { transition: none; }\n\n@keyframes echo-breathe {\n  0%, 100% { transform: scale(1, 1); }\n  48% { transform: scale(1.003, var(--echo-inhale, 1.01)); }\n}\n\n@keyframes echo-drift {\n  0%, 100% { transform: translate(0, 0) rotate(-.14deg); }\n  48% { transform: translate(.4px, -1.1px) rotate(.14deg); }\n}\n\n@keyframes echo-shell-drift {\n  0%, 100% { transform: rotate(-.12deg) translate(0, 0); }\n  55% { transform: rotate(.18deg) translate(.4px, -.3px); }\n}\n\n@keyframes echo-ribbon-drift {\n  0%, 100% { transform: translate(0, 0) rotate(-.4deg); }\n  50% { transform: translate(.8px, -2.2px) rotate(.35deg); }\n}\n\n@keyframes echo-contact {\n  0%, 100% { transform: scaleX(1); opacity: var(--echo-shadow-opacity, .21); }\n  50% { transform: scaleX(.985); opacity: calc(var(--echo-shadow-opacity, .21) * .92); }\n}\n\n@keyframes echo-listen {\n  0%, 100% { transform: scale(1) rotate(0deg); }\n  30% { transform: scale(1.003, 1.012) rotate(.22deg); }\n  62% { transform: scale(.999, 1.005) rotate(-.15deg); }\n}\n\n@keyframes echo-response {\n  0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }\n  20% { transform: translateY(1.5px) rotate(-1deg) scale(1.01, .985); }\n  48% { transform: translateY(-4.5px) rotate(1.4deg) scale(.994, 1.018); }\n  72% { transform: translateY(-1px) rotate(-.5deg) scale(1); }\n}\n\n@keyframes echo-shell-response {\n  0%, 100% { transform: translate(0, 0) rotate(0deg); }\n  20% { transform: translate(-1px, 1px) rotate(-1.3deg); }\n  52% { transform: translate(2.5px, -1.5px) rotate(1.3deg); }\n  73% { transform: translate(1px, 0) rotate(-.4deg); }\n}\n\n@keyframes echo-ribbon-response {\n  0%, 100% { transform: rotate(0deg) scale(1); }\n  25% { transform: rotate(-3deg) scale(.99, 1.012); }\n  55% { transform: rotate(3.5deg) scale(1.012, .995); }\n  79% { transform: rotate(-1deg) scale(1); }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .echo-creature *, .echo-creature *::before, .echo-creature *::after {\n    animation: none !important;\n    transition: none !important;\n  }\n  .echo-creature-attention { transform: none !important; }\n}\n';

  // src/client/echo/habitat.css
  var habitat_default = `/* A single, persistent space. Views move around its inhabitant. */
.echo-living-space {
  --eh-bg: #10181d;
  --eh-ink: #e4eceb;
  --eh-muted: #94a5a8;
  --eh-faint: #64797e;
  --eh-line: #a8c0c21c;
  --eh-hover: #c0dce60b;
  --eh-surface: #182429;
  --eh-focus: #aad4d2;
  --eh-error: #edb4a6;
  --echo-paper: var(--eh-bg);
  --echo-ink: var(--eh-ink);
  --echo-muted: var(--eh-muted);
  --echo-line: var(--eh-line);
  --echo-surface: var(--eh-surface);
  --echo-accent: var(--eh-focus);
  --dsw-alias-bg-base: var(--eh-bg);
  --dsw-alias-bg-layer-1: var(--eh-surface);
  --dsw-alias-bg-layer-2: #223036;
  --dsw-alias-bg-layer-3: #293b42;
  --dsw-alias-border-l1: #a8c0c223;
  --dsw-alias-border-l2: #a8c0c244;
  --dsw-alias-border-l3: #a8c0c277;
  --dsw-alias-label-primary: var(--eh-ink);
  --dsw-alias-label-secondary: var(--eh-muted);
  --dsw-alias-label-tertiary: var(--eh-faint);
  --dsw-alias-label-primary-inverted: #15252c;
  --dsw-alias-brand-primary: #8cbab8;
  --dsw-alias-brand-text: #a9d0ce;
  --dsw-alias-button-primary-fill: #a9d0ce;
  --dsw-alias-button-primary-hover: #b9dfdd;
  --dsw-alias-interactive-bg-hover: var(--eh-hover);
  --dsw-alias-interactive-bg-active: #b7d9dc13;
  --dsw-alias-state-error-primary: var(--eh-error);
  --dsw-alias-state-warn-primary: #cfbf9b;
  --dsw-alias-state-success-primary: #9bc9b9;
  --dsw-alias-bg-mask-2: #07111488;
  --dsw-alias-scrollbar-bg-l2: #78919440;
  --dsw-alias-scrollbar-hover-l2: #78919470;
  --dsw-alias-bg-skeleton: #223036;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  isolation: isolate;
  color: var(--eh-ink);
  background: var(--eh-bg);
  color-scheme: dark;
  font: 13px/1.6 Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;
  container: echo-habitat / size;
}
.echo-living-space[data-tone="light"] {
  --eh-bg: #e9eef0;
  --eh-ink: #263b43;
  --eh-muted: #657c84;
  --eh-faint: #81949a;
  --eh-line: #526c7b25;
  --eh-hover: #50758a0a;
  --eh-surface: #f2f6f7;
  --eh-focus: #4d7d86;
  --eh-error: #a75342;
  --dsw-alias-bg-layer-2: #e1eaed;
  --dsw-alias-bg-layer-3: #d7e3e7;
  --dsw-alias-border-l1: #526c7b25;
  --dsw-alias-border-l2: #526c7b45;
  --dsw-alias-border-l3: #526c7b77;
  --dsw-alias-label-primary-inverted: #f5fafa;
  --dsw-alias-brand-primary: #4d7d86;
  --dsw-alias-brand-text: #386b77;
  --dsw-alias-button-primary-fill: #3f6975;
  --dsw-alias-button-primary-hover: #527c87;
  --dsw-alias-interactive-bg-active: #48708215;
  --dsw-alias-state-warn-primary: #866d3d;
  --dsw-alias-state-success-primary: #437e73;
  --dsw-alias-bg-skeleton: #dce7eb;
  color-scheme: light;
}
.echo-living-space *, .echo-living-space *::before, .echo-living-space *::after { box-sizing: border-box; }
.echo-living-space button, .echo-living-space input, .echo-living-space textarea { font: inherit; }
.echo-living-space button { -webkit-tap-highlight-color: transparent; }
.echo-living-space button:disabled { cursor: default; opacity: .4; }
.echo-living-space :focus-visible { outline: 2px solid var(--eh-focus) !important; outline-offset: 5px; }
.echo-living-space input[type="range"] { width: 100%; margin: 0; height: 22px; accent-color: var(--eh-focus); cursor: pointer; }
.echo-living-space input[type="range"]:disabled { cursor: default; opacity: .4; }
.eh-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.eh-atmosphere { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.eh-distant-light { position: absolute; inset: -24% -12% 5%; background: radial-gradient(ellipse at 51% 47%, #73939b17 0%, #688a9410 20%, #10181d00 58%); }
.eh-distant-light::after { content: ""; position: absolute; inset: 0; background: linear-gradient(115deg, transparent 27%, #8cacb60a 49%, transparent 70%); transform: skewX(-12deg); }
.eh-ground { position: absolute; inset: 49% -25% -27%; background: radial-gradient(ellipse at 50% 14%, #6e919418, transparent 49%); border-top: 1px solid #72939d05; transform: perspective(650px) rotateX(19deg); }
.echo-living-space[data-tone="light"] .eh-distant-light { background: radial-gradient(ellipse at 52% 42%, #fff 0%, #f5f9fa9c 22%, #e9eef000 65%); }
.echo-living-space[data-tone="light"] .eh-ground { background: radial-gradient(ellipse at 50% 14%, #a6bdc12a, transparent 47%); }
.eh-presence-header { position: absolute; inset: 28px 34px auto; z-index: 5; display: flex; align-items: flex-start; justify-content: space-between; pointer-events: none; }
.eh-presence-header > * { pointer-events: auto; }
.eh-name { border: 0; appearance: none; background: none; color: inherit; cursor: pointer; display: grid; grid-template-columns: 7px auto; gap: 2px 12px; text-align: left; padding: 6px 0; }
.eh-name strong { font-size: 13px; font-weight: 500; letter-spacing: .1em; }
.eh-name small { grid-column: 2; color: var(--eh-faint); font-size: 11px; letter-spacing: .08em; }
.eh-name-mark { width: 4px; height: 4px; border-radius: 50%; align-self: center; background: #b3cbc2; box-shadow: 0 0 12px #b7e0d84d; }
.eh-action { border: 0; appearance: none; background: none; color: var(--eh-muted); min-height: 34px; padding: 7px 8px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 6px; font-size: 11px; line-height: 1.5; cursor: pointer; text-decoration: none; transition: color 180ms, background 180ms; }
.eh-action:hover:not(:disabled) { color: var(--eh-ink); background: var(--eh-hover); }
.eh-action[aria-pressed="true"] { color: var(--eh-focus); }
.eh-menu-toggle { width: 36px; padding: 8px; }
.eh-being-space { --eh-body-block: max(0px, calc(100cqh - 216px)); position: absolute; inset: 72px 0 106px; display: flex; align-items: center; justify-content: center; pointer-events: none; transition: transform 1100ms cubic-bezier(.2,.75,.2,1), opacity 700ms; }
/* The presence viewBox is 496 \xD7 388. This cap keeps the entire SVG, including
   memory marks and contact shadow, within the room left by fixed controls. */
.eh-being { width: min(72%, 820px); max-width: calc(var(--eh-body-block) * 1.2783505); flex: 0 1 auto; transform: translateY(-2%); pointer-events: auto; }
.eh-being > .echo-creature { width: 100%; }
.eh-being .echo-empty-life { min-height: 260px; padding: 50px 0; color: var(--eh-muted); }
.eh-being .echo-empty-life h2 { color: var(--eh-ink); font-size: 18px; font-weight: 400; }
.eh-being-whisper { position: absolute; bottom: 3%; left: 15%; right: 15%; text-align: center; color: var(--eh-faint); font-size: 11px; letter-spacing: .08em; pointer-events: none; }
.eh-relationship { position: absolute; z-index: 3; left: 34px; bottom: 132px; display: flex; flex-direction: column; align-items: flex-start; gap: 9px; }
.eh-relationship .eh-action { color: var(--eh-faint); padding-left: 0; font-size: 11px; }
.eh-relationship .eh-action:hover { color: var(--eh-ink); }
.eh-music-ground { position: absolute; z-index: 5; left: 34px; right: 34px; bottom: 26px; min-height: 64px; display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 22px; align-items: center; border-top: 1px solid var(--eh-line); padding-top: 18px; }
.eh-current-track { display: flex; align-items: center; gap: 16px; min-width: 0; width: fit-content; max-width: 100%; color: inherit; appearance: none; border: 0; background: none; padding: 4px 0; text-align: left; cursor: pointer; }
.eh-current-track > span:last-child { min-width: 0; }
.eh-current-track strong, .eh-current-track small { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eh-current-track strong { font-size: 12px; font-weight: 500; }
.eh-current-track small { font-size: 11px; margin-top: 3px; color: var(--eh-faint); }
.eh-playing-mark { display: flex; align-items: center; gap: 3px; width: 19px; height: 23px; flex: 0 0 auto; color: var(--eh-faint); }
.eh-playing-mark i { display: block; width: 2px; height: 4px; border-radius: 2px; background: currentColor; }
.eh-playing-mark.is-playing { color: var(--eh-focus); }
.eh-playing-mark.is-playing i { height: 11px; }
.eh-playing-mark.is-playing i:nth-child(2) { height: 19px; }
.eh-playing-mark.is-playing i:nth-child(3) { height: 7px; }
.eh-direct-controls { display: flex; align-items: center; gap: 14px; }
.eh-direct-controls .eh-action { width: 36px; height: 36px; }
.eh-direct-controls .eh-main-play { width: 40px; height: 40px; border: 1px solid var(--eh-line); border-radius: 50%; color: var(--eh-ink); }
.eh-find { justify-self: end; display: flex; align-items: center; gap: 22px; padding: 10px 0 10px 15px; color: var(--eh-ink); cursor: pointer; border: 0; background: transparent; appearance: none; font-size: 12px; letter-spacing: .05em; }
.eh-find kbd, .eh-search-field kbd { font-family: inherit; font-size: 11px; font-weight: 400; color: var(--eh-faint); letter-spacing: 0; }
.eh-find:hover { color: var(--eh-focus); }
.eh-context { position: absolute; z-index: 4; right: 6%; top: 18%; bottom: 122px; width: min(38%, 470px); min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--eh-line) transparent; padding: 0 8px 14px; animation: eh-appear 420ms ease both; }
.eh-context-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin: 0 0 24px; }
.eh-context-heading h2 { font-size: clamp(18px,2vw,25px); font-weight: 400; line-height: 1.5; letter-spacing: .025em; margin: 0 0 9px; overflow-wrap: anywhere; }
.eh-context-heading p { margin: 0; color: var(--eh-muted); font-size: 11px; line-height: 1.9; }
.eh-context-heading > .eh-action { flex: 0 0 32px; margin-top: -4px; }
.eh-context-heading [data-eh-heading]:focus:not(:focus-visible), .eh-utility-heading [data-eh-heading]:focus:not(:focus-visible) { outline: none; }
.echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"]) .eh-being-space { transform: translateX(-24%) scale(.8); }
.echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"]) .eh-being-whisper { color: var(--eh-faint); }
.eh-search-field { display: flex; align-items: center; gap: 15px; border-bottom: 1px solid var(--eh-faint); padding: 2px 2px 11px; }
.eh-search-field input { width: 100%; min-width: 0; border: 0; outline: none !important; color: var(--eh-ink); background: transparent; font-size: 14px; padding: 4px 0; }
.eh-search-field:focus-within { border-color: var(--eh-focus); }
.eh-search-field input::placeholder { color: var(--eh-faint); }
.eh-list-caption { display: flex; justify-content: space-between; align-items: center; gap: 12px; color: var(--eh-faint); font-size: 11px; padding: 16px 0 8px; }
.eh-list-caption .eh-action { font-size: 11px; padding-right: 0; }
.eh-song-list, .eh-memory-list { list-style: none; padding: 0; margin: 0; }
.eh-song { display: flex; align-items: center; width: 100%; gap: 14px; padding: 15px 4px; border: 0; border-bottom: 1px solid var(--eh-line); color: var(--eh-ink); background: none; text-align: left; cursor: pointer; transition: background 180ms; }
.eh-song:hover { background: var(--eh-hover); }
.eh-song-index { display: flex; align-items: center; flex: 0 0 20px; color: var(--eh-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.eh-song-copy { flex: 1; min-width: 0; }
.eh-song-copy strong { display: block; font-size: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eh-song-copy small { display: block; color: var(--eh-muted); font-size: 11px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eh-song-tail { color: var(--eh-faint); display: flex; align-items: center; gap: 14px; font-size: 11px; font-variant-numeric: tabular-nums; }
.eh-song-tail svg { opacity: 0; transition: opacity 180ms; }
.eh-song:is(:hover,:focus-visible) .eh-song-tail svg { opacity: 1; }
.eh-context-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 20px; }
.eh-context-foot .eh-action { padding-left: 0; padding-right: 0; font-size: 11px; }
.eh-load-more { display: flex; margin: 17px auto; }
.eh-empty { color: var(--eh-muted); font-size: 12px; line-height: 2; padding: 23px 0; }
.eh-subtle { color: var(--eh-faint); font-size: 11px; line-height: 1.8; }
/* Discovery is a few playable sound fragments around the same body. */
.eh-discover { inset: 15% 7% 130px; width: auto; max-height: none; padding: 0; overflow: visible; pointer-events: none; }
.eh-discover > * { pointer-events: auto; }
.eh-discover .eh-context-heading { position: absolute; left: 0; top: 0; right: 0; margin: 0; }
.eh-discover .eh-context-heading h2 { font-size: 17px; }
.eh-discover .eh-context-heading p { font-size: 11px; }
.eh-discover .eh-song-list { position: absolute; inset: 0; pointer-events: none; }
.eh-discover .eh-song-list li { width: 25%; max-width: 260px; min-width: 170px; position: absolute; pointer-events: auto; }
.eh-discover .eh-song-list li:nth-child(1) { left: 0; top: 33%; }
.eh-discover .eh-song-list li:nth-child(2) { right: 0; top: 39%; }
.eh-discover .eh-song-list li:nth-child(3) { right: 12%; bottom: 9%; }
.eh-discover .eh-song { gap: 10px; padding: 15px 0; border-color: var(--eh-line); }
.eh-discover .eh-song-index { display: none; }
.eh-discover .eh-song-copy strong { font-size: 13px; }
.eh-discover .eh-song-tail time { display: none; }
.eh-discover .eh-song-tail svg { opacity: .6; }
.eh-discover .eh-context-foot { position: absolute; left: 0; bottom: 0; gap: 22px; }
.echo-living-space[data-scene="discover"] .eh-relationship { display: none; }
.echo-living-space[data-scene="discover"] .eh-being-space { transform: scale(.83); }
.eh-time-control { margin: 28px 0; }
.eh-time-caption { display: flex; flex-direction: column; gap: 5px; margin-bottom: 15px; }
.eh-time-caption time { font-size: 11px; color: var(--eh-faint); letter-spacing: .08em; }
.eh-time-caption strong { font-size: 15px; font-weight: 400; }
.eh-time-labels { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--eh-faint); }
.eh-time-labels .eh-action { font-size: 11px; padding-right: 0; }
.eh-memory-list button { width: 100%; display: grid; grid-template-columns: 64px 1fr 16px; align-items: center; gap: 14px; color: var(--eh-ink); border: 0; border-bottom: 1px solid var(--eh-line); background: none; padding: 17px 0; text-align: left; cursor: pointer; }
.eh-memory-list button:hover { background: var(--eh-hover); }
.eh-memory-list time { color: var(--eh-faint); font-size: 11px; }
.eh-memory-list strong { font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
.eh-memory-list svg { color: var(--eh-faint); }
.eh-artist-link { margin: -14px 0 12px; padding-left: 0; font-size: 11px; }
.eh-listening-controls { display: flex; align-items: center; justify-content: center; gap: 30px; padding: 12px 0 18px; }
.eh-play-expanded { width: 52px; height: 52px; color: var(--eh-ink); border-radius: 50%; border: 1px solid var(--eh-line); }
.eh-progress > div { display: flex; justify-content: space-between; color: var(--eh-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.eh-taste-controls { display: flex; align-items: center; flex-wrap: wrap; justify-content: center; gap: 16px; margin: 16px 0; }
.eh-taste-controls .eh-action { font-size: 11px; }
.eh-taste-controls small { font-size: 11px; color: var(--eh-muted); }
.eh-volume { display: flex; align-items: center; gap: 14px; margin-top: 13px; }
.eh-volume > input { flex: 1; min-width: 30px; }
.eh-volume > .eh-action:last-child { min-width: 66px; }
.eh-lyrics-detail { padding: 16px 0; margin-top: 10px; border-top: 1px solid var(--eh-line); }
.eh-lyric-presence { position: absolute; z-index: 3; left: 25%; right: 25%; bottom: 119px; text-align: center; max-height: 80px; overflow: auto; }
.eh-lyric-line { color: var(--eh-ink); font-size: 15px; font-weight: 400; line-height: 2; margin: 0; }
.eh-lyric-note { color: var(--eh-muted); font-size: 11px; line-height: 1.9; margin: 0; }
.eh-plain-lyrics > small { color: var(--eh-faint); font-size: 11px; }
.eh-plain-lyrics > p { white-space: pre-wrap; max-height: 190px; overflow: auto; font-size: 12px; line-height: 2.2; color: var(--eh-muted); margin: 8px 0 0; }
.eh-tools { position: absolute; z-index: 12; top: 75px; right: 34px; width: 230px; max-height: calc(100% - 170px); overflow: auto; padding: 12px 17px; border: 1px solid var(--eh-line); border-radius: 10px; background: var(--eh-surface); box-shadow: 0 20px 80px #06131838; scrollbar-width: thin; }
.eh-tool-group { display: flex; flex-direction: column; align-items: stretch; padding: 6px 0; border-bottom: 1px solid var(--eh-line); }
.eh-tool-group:last-child { border-bottom: 0; }
.eh-tool-group .eh-action { justify-content: flex-start; text-align: left; min-height: 36px; }
.eh-system-status { position: absolute; z-index: 15; bottom: 100px; left: 50%; transform: translateX(-50%); max-width: min(620px,calc(100% - 40px)); display: flex; flex-direction: column; align-items: center; gap: 7px; pointer-events: none; }
.eh-system-status > * { pointer-events: auto; }
.eh-system-status .echo-sync-status { margin: 0; padding: 10px 16px; border-radius: 8px; background: var(--eh-surface); color: var(--eh-muted); box-shadow: 0 8px 32px #0002; }
.eh-feedback { display: flex; align-items: center; gap: 10px; color: var(--eh-ink); background: var(--eh-surface); border: 1px solid var(--eh-line); border-radius: 7px; padding: 7px 9px 7px 15px; box-shadow: 0 8px 40px #081c2524; font-size: 11px; line-height: 1.8; margin: 0; }
.eh-feedback.is-error { color: var(--eh-error); }
.eh-feedback .eh-action { flex: 0 0 28px; padding: 3px; min-height: 28px; }
.eh-undo { color: var(--eh-focus); background: var(--eh-surface); border: 1px solid var(--eh-line); border-radius: 5px; padding: 7px 12px; font-size: 11px; cursor: pointer; }
.eh-utility { position: absolute; inset: 78px 3% 104px; z-index: 10; display: flex; flex-direction: column; background: var(--eh-bg); border: 1px solid var(--eh-line); border-radius: 12px; box-shadow: 0 32px 100px #020a1033; overflow: hidden; animation: eh-appear 300ms ease both; }
.echo-living-space[data-scene="utility"] .eh-being-space { opacity: .14; transform: scale(.94); }
.eh-utility-heading { flex: 0 0 auto; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 13px 22px; border-bottom: 1px solid var(--eh-line); }
.eh-utility-heading h2 { font-size: 12px; color: var(--eh-muted); font-weight: 400; letter-spacing: .08em; margin: 0; }
.eh-utility-heading > .eh-action:first-child { justify-self: start; }
.eh-utility-heading > .eh-action:last-child { justify-self: end; }
.eh-back svg { transform: rotate(180deg); }
.eh-utility-scroll { overflow: auto; min-height: 0; flex: 1; overscroll-behavior: contain; scrollbar-width: thin; }
.echo-living-space .echo-utility-content { margin: 0; padding: 28px; max-width: none; color: var(--eh-ink); background: transparent; min-height: 100%; }
/* The legacy console scopes its own dark tokens. Let both the wrapper and a
   nested source-onboarding console follow this space's selected theme. */
.echo-living-space .echo-utility-content,
.echo-living-space .echo-utility-content :is(.dshm-console, .dshm-console-welcome) {
  color-scheme: inherit;
  --dsw-alias-bg-base: inherit;
  --dsw-alias-bg-layer-1: inherit;
  --dsw-alias-bg-layer-2: inherit;
  --dsw-alias-bg-layer-3: inherit;
  --dsw-alias-border-l1: inherit;
  --dsw-alias-border-l2: inherit;
  --dsw-alias-border-l3: inherit;
  --dsw-alias-label-primary: inherit;
  --dsw-alias-label-secondary: inherit;
  --dsw-alias-label-tertiary: inherit;
  --dsw-alias-label-primary-inverted: inherit;
  --dsw-alias-brand-primary: inherit;
  --dsw-alias-brand-text: inherit;
  --dsw-alias-button-primary-fill: inherit;
  --dsw-alias-button-primary-hover: inherit;
  --dsw-alias-interactive-bg-hover: inherit;
  --dsw-alias-interactive-bg-active: inherit;
  --dsw-alias-bg-mask-2: inherit;
  --dsw-alias-scrollbar-bg-l2: inherit;
  --dsw-alias-scrollbar-hover-l2: inherit;
  --dsw-alias-bg-skeleton: inherit;
  --dsw-alias-state-error-primary: inherit;
  --dsw-alias-state-success-primary: inherit;
  --dsw-alias-state-warn-primary: inherit;
}
.echo-living-space[data-tone="light"] .echo-utility-content :is(.dshm-console-card, .dshm-feature, .dshm-command-form, .dshm-console-hero, .dshm-header, .dshm-console-dock) { background: var(--eh-surface); border-color: var(--eh-line); }
.echo-living-space[data-tone="light"] .echo-utility-content .dshm-feature:is(:hover,[aria-pressed="true"]) { background: var(--dsw-alias-bg-layer-2); border-color: var(--eh-focus); }
.echo-living-space[data-tone="light"] .echo-utility-content :is(.dshm-kicker, .dshm-feature svg, .dshm-command-form > svg, .dshm-console-log time) { color: var(--dsw-alias-brand-text); }
.echo-living-space .echo-modal-shade { --echo-paper: var(--eh-bg); --echo-ink: var(--eh-ink); --echo-muted: var(--eh-muted); --echo-line: var(--eh-line); --echo-surface: var(--eh-surface); --echo-accent: var(--eh-focus); position: absolute; color: var(--eh-ink); background: #07121724; backdrop-filter: none; color-scheme: inherit; justify-content: flex-end; padding: 70px max(6%,24px); }
.echo-living-space .echo-dialog { background: var(--eh-surface); width: min(390px,100%); max-height: 100%; border-color: var(--eh-line); color: var(--eh-ink); box-shadow: 0 25px 100px #06121b55; border-radius: 8px; padding: 31px; overscroll-behavior: contain; }
.echo-living-space .echo-dialog h2 { font-family: inherit; font-weight: 400; font-size: 23px; }
.echo-living-space .echo-dialog .echo-eyebrow { color: var(--eh-faint); }
.echo-living-space .echo-field, .echo-living-space .echo-memory-reading p { color: var(--eh-muted); }
.echo-living-space .echo-field input, .echo-living-space .echo-field textarea { color: var(--eh-ink); background: var(--eh-bg); border-color: var(--eh-line); }
.echo-living-space .echo-button { color: var(--eh-ink); border-color: var(--eh-line); background: var(--eh-hover); }
.echo-living-space .echo-button-primary { color: var(--eh-bg); background: var(--eh-focus); border-color: transparent; }
.echo-living-space .echo-tap-pad { background: var(--eh-bg); border-color: var(--eh-line); color: var(--eh-focus); }
.echo-living-space .echo-beat-sequence i { background: var(--eh-line); }
.echo-living-space .echo-beat-sequence i.is-filled { background: var(--eh-focus); }
.echo-living-space .echo-related-track { background: var(--eh-bg); color: var(--eh-muted); }
.echo-living-space .echo-error { color: var(--eh-error); }
@keyframes eh-appear { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
@container echo-habitat (max-width: 900px) {
  .eh-context { right: 4%; width: 43%; top: 18%; }
  .eh-being { width: 86%; }
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"]) .eh-being-space { transform: translateX(-25%) scale(.73); }
  .eh-relationship { bottom: 130px; left: 25px; }
  .eh-presence-header { left: 25px; right: 25px; }
  .eh-music-ground { left: 25px; right: 25px; gap: 16px; }
  .eh-discover { inset: 16% 5% 130px; width: auto; }
  .eh-discover .eh-song-list li { min-width: 155px; width: 27%; }
}
@container echo-habitat (max-width: 620px) {
  .eh-presence-header { inset: 18px 19px auto; }
  .eh-name strong { font-size: 12px; }
  .eh-being-space { --eh-body-block: max(0px, calc(100cqh - 270px)); inset: 72px -7% 170px; }
  .eh-being { width: min(103%, 600px); }
  .eh-being-whisper { bottom: 14%; font-size: 11px; }
  .eh-relationship { left: 19px; bottom: 130px; gap: 1px; }
  .eh-relationship .eh-action { font-size: 11px; }
  .eh-music-ground { left: 19px; right: 19px; bottom: 19px; grid-template-columns: minmax(0,1fr) auto auto; gap: 10px; padding-top: 16px; }
  .eh-current-track { gap: 9px; }
  .eh-current-track strong { font-size: 11px; }
  .eh-current-track small { font-size: 11px; }
  .eh-playing-mark { display: none; }
  .eh-direct-controls { gap: 5px; }
  .eh-direct-controls .eh-main-play { width: 36px; height: 36px; }
  .eh-direct-controls .eh-action:last-child { width: 30px; padding: 4px; }
  .eh-find { font-size: 11px; gap: 0; padding: 9px 0 9px 9px; }
  .eh-find kbd { display: none; }
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being-space { --eh-body-block: 228px; inset: 64px 0 auto; height: 236px; transform: none; }
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being { width: min(83%,350px); }
  .echo-living-space:not([data-scene="encounter"]) .eh-being-whisper { display: none; }
  .echo-living-space:not([data-scene="encounter"]) .eh-relationship { display: none; }
  .eh-context { top: 308px; right: 19px; left: 19px; bottom: 103px; width: auto; max-height: none; padding: 0 3px 10px; }
  .eh-context-heading { margin-bottom: 16px; gap: 12px; }
  .eh-context-heading h2 { font-size: 19px; margin-bottom: 6px; }
  .eh-context-heading p { font-size: 11px; }
  .eh-song { padding: 12px 2px; }
  .eh-song-tail svg { opacity: .6; }
  .eh-discover { overflow: auto; pointer-events: auto; }
  .eh-discover .eh-context-heading, .eh-discover .eh-context-foot, .eh-discover .eh-song-list, .eh-discover .eh-song-list li { position: static; width: auto; max-width: none; min-width: 0; pointer-events: auto; }
  .eh-discover .eh-context-heading { margin-bottom: 13px; }
  .eh-discover .eh-song-copy strong { font-size: 12px; }
  .eh-discover .eh-context-foot { gap: 14px; }
  .eh-time-control { margin: 18px 0; }
  .eh-lyric-presence { bottom: 156px; left: 38%; right: 7%; text-align: right; max-height: 74px; }
  .eh-lyric-line { font-size: 12px; }
  .eh-tools { top: 65px; right: 18px; max-height: calc(100% - 165px); }
  .eh-system-status { bottom: 101px; max-width: calc(100% - 30px); width: max-content; }
  .eh-utility { inset: 64px 12px 99px; }
  .eh-utility-heading { padding: 10px; gap: 5px; grid-template-columns: 1fr auto; }
  .eh-utility-heading h2 { display: none; }
  .echo-living-space .echo-utility-content { padding: 17px; }
  .echo-living-space .echo-modal-shade { justify-content: center; align-items: flex-end; padding: 20px 18px 100px; }
  .echo-living-space .echo-dialog { padding: 26px 24px; max-height: calc(100% - 35px); }
}
/* Height belongs to the host panel, which may be much shorter than a browser
   viewport. Keep the player anchored and scroll only the surrounding content. */
@container echo-habitat (max-height: 680px) {
  .eh-presence-header { top: 14px; }
  .eh-music-ground { bottom: 14px; padding-top: 12px; }
  .eh-relationship { bottom: 112px; gap: 4px; }
  .eh-utility { top: 64px; bottom: 92px; }
  .eh-tools { top: 60px; max-height: calc(100cqh - 154px); }
  .eh-system-status { bottom: 90px; max-height: max(0px, calc(100cqh - 148px)); overflow: auto; scrollbar-width: thin; }
  .eh-system-status > * { flex: 0 0 auto; }
  .eh-being .echo-empty-life { min-height: 0; padding: 12px 0; }
}
@container echo-habitat (max-width: 620px) and (max-height: 680px) {
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being-space {
    --eh-body-block: max(0px, calc(clamp(64px, 100cqh - 330px, 180px) - 12px));
    top: 56px;
    height: clamp(64px, calc(100cqh - 330px), 180px);
  }
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being { width: min(83%, 260px); }
  .eh-context { top: calc(66px + clamp(64px, 100cqh - 330px, 180px)); bottom: 96px; }
}
@container echo-habitat (max-height: 520px) {
  .eh-presence-header { top: 8px; }
  .eh-being-space { --eh-body-block: max(0px, calc(100cqh - 174px)); top: 58px; bottom: 90px; }
  .eh-being-whisper { display: none; }
  .eh-context { top: 68px; bottom: 92px; }
  .eh-context-heading { margin-bottom: 12px; }
  .eh-context-heading h2 { font-size: 18px; margin-bottom: 4px; }
  .eh-context-heading p { display: none; }
  .eh-music-ground { bottom: 10px; min-height: 60px; padding-top: 8px; }
  .eh-current-track small { margin-top: 0; }
  .eh-tools { top: 56px; max-height: calc(100cqh - 142px); }
  .eh-utility { top: 56px; bottom: 82px; }
  .eh-utility-heading { padding-top: 8px; padding-bottom: 8px; }
  .eh-time-control { margin: 15px 0; }
  .eh-lyric-presence { bottom: 88px; max-height: 62px; }
  .echo-living-space[data-scene="encounter"]:has(.eh-lyric-presence) .eh-being-space { --eh-body-block: max(0px, calc(100cqh - 240px)); bottom: 158px; }
  .echo-living-space .echo-modal-shade { padding: 12px max(4%,16px); }
  .echo-living-space .echo-dialog { max-height: 100%; padding: 24px; }
}
@container echo-habitat (min-width: 621px) and (max-height: 520px) {
  .eh-discover { top: 68px; right: 5%; left: auto; bottom: 92px; width: 40%; overflow: auto; pointer-events: auto; }
  .eh-discover .eh-context-heading, .eh-discover .eh-context-foot, .eh-discover .eh-song-list, .eh-discover .eh-song-list li { position: static; width: auto; max-width: none; min-width: 0; pointer-events: auto; }
  .eh-discover .eh-context-foot { gap: 14px; }
  .echo-living-space[data-scene="discover"] .eh-being-space { transform: translateX(-24%) scale(.8); }
}
@container echo-habitat (max-width: 620px) and (max-height: 520px) {
  .eh-presence-header { left: 15px; right: 15px; }
  .eh-music-ground { left: 15px; right: 15px; gap: 8px; }
  .eh-context { top: calc(66px + clamp(64px, 100cqh - 330px, 180px)); bottom: 90px; }
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being-space {
    --eh-body-block: max(0px, calc(clamp(64px, 100cqh - 330px, 180px) - 12px));
    top: 56px;
    bottom: auto;
    height: clamp(64px, calc(100cqh - 330px), 180px);
  }
  .echo-living-space[data-scene="encounter"] .eh-being-space { inset: 64px 12px 96px 116px; }
  .echo-living-space[data-scene="encounter"] .eh-being { width: 100%; }
  .eh-relationship { left: 15px; bottom: 98px; gap: 2px; }
  .eh-relationship .eh-action { padding-right: 0; gap: 6px; }
  .eh-lyric-presence { left: 116px; right: 12px; }
  .eh-utility { left: 9px; right: 9px; }
}
@container echo-habitat (max-height: 340px) {
  .eh-name small { display: none; }
  .eh-presence-header { top: 6px; }
  .eh-utility { top: 8px; bottom: 78px; }
  .eh-tools { top: 52px; max-height: calc(100cqh - 132px); }
  .eh-being .echo-empty-life h2 { font-size: 14px; }
  .eh-being .echo-empty-life p { display: none; }
}
@container echo-habitat (max-width: 620px) and (max-height: 340px) {
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being-space {
    --eh-body-block: max(0px, calc(100cqh - 158px));
    inset: 56px auto 88px 10px;
    height: auto;
    width: 82px;
  }
  .echo-living-space:is([data-scene="search"],[data-scene="memory"],[data-scene="listening"],[data-scene="discover"]) .eh-being { width: 100%; }
  .eh-context { top: 56px; left: 106px; right: 12px; bottom: 86px; }
  .eh-context-heading { gap: 5px; }
  .eh-context-heading h2 { font-size: 16px; }
  .eh-song-index, .eh-song-tail time { display: none; }
  .eh-song { gap: 8px; }
  .eh-list-caption, .eh-taste-controls { flex-wrap: wrap; gap: 5px; }
  .eh-memory-list button { grid-template-columns: 1fr 16px; gap: 6px; }
  .eh-memory-list time { grid-column: 1 / -1; }
}
@media (any-pointer: coarse) {
  .echo-living-space :is(.eh-action, .eh-find, .eh-current-track, .eh-name, .eh-song, .eh-memory-list button, .eh-undo, .echo-dialog-close, .echo-button, .echo-sync-status button) { min-width: 44px; min-height: 44px; }
  .echo-living-space .eh-direct-controls .eh-action { width: 44px; height: 44px; }
  .echo-living-space .eh-context-heading > .eh-action, .echo-living-space .eh-feedback .eh-action { flex-basis: 44px; }
  .echo-living-space input[type="range"] { height: 44px; }
  .echo-living-space .eh-search-field input { min-height: 44px; }
  .echo-living-space .echo-utility-content :is(button, a[href], input:not([type="checkbox"]):not([type="radio"]), select) { min-height: 44px; }
  .echo-living-space .echo-utility-content :is(button, a[href]) { min-width: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .echo-living-space *, .echo-living-space *::before, .echo-living-space *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
`;

  // src/client/index.js
  window.__ModuleLoader__.load({
    id: "@vicyangorg/dsh-music",
    factory(require2) {
      const React = require2("react");
      const h = React.createElement;
      const { useState, useEffect, useMemo, useRef, useCallback } = React;
      const { EchoHabitat, EchoGallery, EchoMini } = createEchoUI(React);
      let ReactDOM = null;
      try {
        ReactDOM = require2("react-dom");
      } catch {
        ReactDOM = null;
      }
      function portalToBody(node) {
        if (!ReactDOM || typeof ReactDOM.createPortal !== "function" || typeof document === "undefined") return node;
        return ReactDOM.createPortal(node, document.body);
      }
      const NS = "dshMusic";
      const PANEL_ID = "music";
      const zh = {
        consoleUseModel: "\u4F7F\u7528 Harness \u6A21\u578B\u7406\u89E3\u6307\u4EE4",
        consoleModelHint: "\u4EC5\u53D1\u9001\u8F93\u5165\u7684\u6307\u4EE4\u7ED9\u5F53\u524D\u914D\u7F6E\u7684\u6A21\u578B\u670D\u52A1\u3002",
        consoleModelBusy: "\u7406\u89E3\u6307\u4EE4\u4E2D\u2026",
        consoleModelApplied: "\u6A21\u578B\u7406\u89E3",
        consoleModelFallback: "\u6A21\u578B\u6682\u4E0D\u53EF\u7528\uFF0C\u5DF2\u7528\u672C\u5730\u89C4\u5219\u751F\u6210\u3002",
        consoleHome: "\u9996\u9875",
        consoleHomeTitle: "dsh-music",
        consoleHomeCopy: "\u4E3A\u5DE5\u4F5C\u548C\u521B\u4F5C\u9009\u4E00\u6BB5\u914D\u4E50\u3002\u4ECE\u4F60\u7684\u66F2\u5E93\u5F00\u59CB\u3002",
        consoleStart: "\u6253\u5F00\u7B56\u5C55\u53F0",
        consoleStudio: "\u97F3\u4E50\u7B56\u5C55\u53F0",
        consoleStudioCopy: "\u8F93\u5165\u573A\u666F\u3001\u65F6\u957F\u3001\u6B4C\u624B\u6216\u6D41\u6D3E\uFF0C\u4ECE\u672C\u5730\u66F2\u5E93\u751F\u6210\u64AD\u653E\u961F\u5217\u3002",
        consolePrompt: "\u7B56\u5C55\u6307\u4EE4",
        consoleGenerate: "\u751F\u6210",
        consoleProfile: "\u6211\u7684\u97F3\u4E50\u753B\u50CF",
        consoleTarget: "\u76EE\u6807",
        consoleCommand: "\u547D\u4EE4\u9762\u677F",
        consoleCommandPlaceholder: "\u641C\u7D22\u672C\u5730\u6B4C\u66F2\uFF0C\u6216\u8F93\u5165 / \u6307\u4EE4",
        consoleNoCommand: "\u6CA1\u6709\u5339\u914D\u7684\u547D\u4EE4\u3002",
        consoleSendPrompt: "\u6309\u56DE\u8F66\u5C06\u8FD9\u6761\u63CF\u8FF0\u9001\u5230\u7B56\u5C55\u53F0\u3002",
        consoleSave: "\u4FDD\u5B58\u6B4C\u5355",
        consoleSaved: "\u5DF2\u4FDD\u5B58",
        consolePlaylists: "\u5DF2\u4FDD\u5B58\u6B4C\u5355",
        consoleRemove: "\u79FB\u9664\u6B4C\u5355",
        consoleNoSaved: "\u751F\u6210\u6B4C\u5355\u540E\u53EF\u5728\u8FD9\u91CC\u4FDD\u5B58\u5E76\u518D\u6B21\u64AD\u653E\u3002",
        consoleSaveError: "\u65E0\u6CD5\u4FDD\u5B58\u6D4F\u89C8\u5668\u6570\u636E\uFF0C\u8BF7\u68C0\u67E5\u5B58\u50A8\u6743\u9650\u6216\u7A7A\u95F4\u3002",
        consoleMissing: "\u6B4C\u5355\u91CC\u7684\u6B4C\u66F2\u76EE\u524D\u90FD\u4E0D\u5728\u66F2\u5E93\u4E2D\u3002",
        consoleNoMatches: "\u6CA1\u6709\u627E\u5230\u7B26\u5408\u6761\u4EF6\u4E14\u53EF\u64AD\u653E\u7684\u6B4C\u66F2\u3002\u8BD5\u8BD5\u51CF\u5C11\u9650\u5236\uFF0C\u6216\u68C0\u67E5\u66F2\u5E93\u548C\u66F2\u76EE\u6807\u7B7E\u3002",
        consoleLog: "\u7B56\u5C55\u65E5\u5FD7",
        consoleNoLogs: "\u751F\u6210\u6216\u64AD\u653E\u540E\u4F1A\u663E\u793A\u64CD\u4F5C\u8BB0\u5F55\u3002",
        consoleLogGenerated: "\u751F\u6210\u961F\u5217",
        consoleLogPlayed: "\u5F00\u59CB\u64AD\u653E",
        consoleLogSaved: "\u4FDD\u5B58\u6B4C\u5355",
        consoleLogOpened: "\u6253\u5F00\u6B4C\u5355",
        consoleLogRemoved: "\u79FB\u9664\u6B4C\u5355",
        consoleExploreArtist: "\u63A2\u7D22\u6B4C\u624B\u8D44\u6599",
        consoleHistoryError: "\u6536\u542C\u8BB0\u5F55\u6682\u65F6\u65E0\u6CD5\u52A0\u8F7D\uFF0C\u53EF\u5207\u6362\u5230\u5176\u4ED6\u73A9\u6CD5\u3002",
        consoleMode_playlist: "\u667A\u80FD\u6B4C\u5355",
        consoleHint_playlist: "\u4F8B\u5982\uFF1A40 \u5206\u949F\u7684\u6447\u6EDA\u6B4C\u5355",
        consoleMode_radio: "\u79C1\u4EBA\u7535\u53F0",
        consoleHint_radio: "\u6309\u573A\u666F\u548C\u53E3\u5473\u751F\u6210\u4E00\u7EC4\u8FDE\u7EED\u64AD\u653E\u7684\u6B4C",
        consoleMode_history: "\u97F3\u4E50\u65F6\u5149\u673A",
        consoleHint_history: "\u91CD\u542C\u6700\u8FD1 30 \u5929\u5185\u64AD\u8FC7\u7684\u6B4C",
        consoleMode_find: "\u97F3\u4E50\u8003\u53E4",
        consoleHint_find: "\u8F93\u5165\u6B4C\u66F2\u3001\u6B4C\u624B\u6216\u4E13\u8F91\uFF0C\u7559\u7A7A\u63A2\u7D22\u5F53\u524D\u6B4C\u66F2",
        consoleMode_daily: "\u6BCF\u65E5\u76F2\u76D2",
        consoleHint_daily: "\u6BCF\u5929\u62BD\u53D6\u81F3\u591A 5 \u9996\u672C\u5730\u66F2\u76EE",
        consolePresetFocus: "60 \u5206\u949F\u6DF1\u5EA6\u4E13\u6CE8",
        consolePresetRelax: "40 \u5206\u949F\u6DF1\u591C\u653E\u677E",
        consolePresetEnergy: "30 \u5206\u949F\u8FD0\u52A8\u6B4C\u5355",
        panel: "\u97F3\u4E50",
        welcomeTitle: "\u6B22\u8FCE\u4F7F\u7528 dsh-music",
        welcomeSub: "\u672C\u5730\u4F18\u5148\u7684\u97F3\u4E50\u5E93\u4E0E\u63A8\u8350\u3002\u82B1\u4E00\u5206\u949F\u544A\u8BC9\u6211\u4F60\u60F3\u542C\u4EC0\u4E48\uFF0C\u6211\u628A\u754C\u9762\u8C03\u5230\u5408\u4F60\u53E3\u5473\u3002",
        welcomeStart: "\u5F00\u59CB\u8BBE\u7F6E",
        welcomeSkip: "\u5148\u968F\u4FBF\u770B\u770B",
        welcomeBack: "\u8FD4\u56DE\u754C\u9762",
        welcomePoint1: "\u64AD\u653E\u672C\u5730\u66F2\u5E93\uFF0C\u6B4C\u8BCD\u4E0E\u6B4C\u624B\u8D44\u6599\u9F50\u5168",
        welcomePoint2: "\u6309\u4F60\u7684\u53E3\u5473\u63A8\u8350\uFF0C\u559C\u6B22\u7684\u6B4C\u624D\u5165\u5E93",
        welcomePoint3: "\u6240\u6709\u6570\u636E\u53EA\u7559\u5728\u8FD9\u53F0\u7535\u8111\u4E0A",
        welcomeTasteTitle: "\u4F60\u559C\u6B22\u542C\u4EC0\u4E48\uFF1F",
        welcomeTasteSub: "\u53EF\u4EE5\u591A\u9009\uFF0C\u4E5F\u53EF\u4EE5\u8DF3\u8FC7\uFF1B\u4E4B\u540E\u968F\u65F6\u80FD\u5728\u63A8\u8350\u91CC\u8C03\u6574\u3002",
        welcomeGenres: "\u6D41\u6D3E",
        welcomeLanguages: "\u8BED\u8A00",
        welcomePrev: "\u4E0A\u4E00\u6B65",
        welcomeNext: "\u4E0B\u4E00\u6B65",
        welcomeLibTitle: "\u4ECE\u54EA\u91CC\u5F00\u59CB\uFF1F",
        welcomeLibSub: "\u5DF2\u7ECF\u6709\u672C\u5730\u97F3\u4E50\u5C31\u9009\u7B2C\u4E00\u4E2A\uFF1B\u6CA1\u6709\u7684\u8BDD\uFF0C\u6211\u51C6\u5907\u4E86\u4E00\u4E2A\u514D\u8D39\u7684\u516C\u5171\u7248\u6743 starter \u66F2\u5E93\u3002",
        welcomeLocalTitle: "\u4F7F\u7528\u6211\u5DF2\u6709\u7684\u97F3\u4E50\u5E93",
        welcomeLocalBody: "\u626B\u63CF ~/Music/dsh-music\u3001spotify-liked \u7B49\u9ED8\u8BA4\u76EE\u5F55",
        welcomeStarterTitle: "\u7528\u63D2\u4EF6\u9ED8\u8BA4 starter \u66F2\u5E93",
        welcomeStarterBody: "\u51E0\u9996 CC0 / \u516C\u6709\u9886\u57DF\u66F2\u76EE\uFF0C\u9010\u9996\u6838\u5B9E\u5E76\u7F72\u540D",
        welcomeStarterHint: "\u66F2\u76EE\u4F1A\u4E32\u884C\u53D6\u56DE\u5230 ~/Music/dsh-music/starter\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u5165\u5E93\uFF1B\u7F51\u7EDC\u5931\u8D25\u4F1A\u8DF3\u8FC7\uFF0C\u4E0D\u5F71\u54CD\u4F7F\u7528\u3002",
        welcomeLocalHint: "\u5B8C\u6210\u540E\u4F1A\u7ACB\u5373\u626B\u63CF\u66F2\u5E93\u5E76\u8FDB\u5165\u66F2\u5E93\u9875\u3002",
        welcomeFinish: "\u5B8C\u6210",
        welcomeStarterDownloading: "\u6B63\u5728\u51C6\u5907 starter \u66F2\u5E93\u2026",
        welcomeStarterReady: "starter \u66F2\u5E93\u5DF2\u5C31\u7EEA",
        welcomeStarterSkipped: "\u7F51\u7EDC\u4E0D\u53EF\u7528\uFF0C\u5DF2\u8DF3\u8FC7 starter\uFF0C\u7A0D\u540E\u53EF\u5728\u63A8\u8350\u9875\u63A2\u7D22",
        welcomeCredits: "\u66F2\u76EE\u4E0E\u8BB8\u53EF",
        welcomeEnter: "\u8FDB\u5165\u63A8\u8350",
        welcomeSaveFail: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5",
        welcomePreview: "\u9884\u89C8\u6B22\u8FCE\u9875",
        genre_jazz: "\u7235\u58EB",
        genre_classical: "\u53E4\u5178",
        genre_electronic: "\u7535\u5B50",
        genre_blues: "\u5E03\u9C81\u65AF",
        genre_reggae: "\u96F7\u9B3C",
        genre_soul: "\u7075\u9B42\u4E50",
        genre_folk: "\u6C11\u8C23",
        genre_metal: "\u91D1\u5C5E",
        genre_funk: "\u653E\u514B",
        genre_ambient: "\u6C1B\u56F4",
        lang_zh: "\u4E2D\u6587",
        lang_en: "\u82F1\u8BED",
        lang_yue: "\u7CA4\u8BED",
        lang_ja: "\u65E5\u8BED",
        lang_ko: "\u97E9\u8BED",
        lang_fr: "\u6CD5\u8BED",
        lang_es: "\u897F\u73ED\u7259\u8BED",
        lang_pt: "\u8461\u8404\u7259\u8BED",
        lang_it: "\u610F\u5927\u5229\u8BED",
        welcomeTasteNote: "\u504F\u597D\u53EA\u7528\u4E8E\u5FAE\u8C03\u63A2\u7D22\u6279\u6B21\uFF0C\u4E0D\u4F1A\u9501\u6B7B\u4F60\u7684\u63A8\u8350\uFF1B\u4E4B\u540E\u968F\u65F6\u80FD\u6539\u3002",
        favsTitle: "\u6211\u559C\u6B22",
        favsViewAll: "\u67E5\u770B\u5168\u90E8",
        favsBack: "\u8FD4\u56DE\u66F2\u5E93",
        favsEmpty: "\u8FD8\u6CA1\u6709\u559C\u6B22\u7684\u6B4C\u2014\u2014\u70B9\u4EFB\u610F\u6B4C\u66F2\u7684 \u2665\uFF0C\u5B83\u5C31\u4F1A\u8FDB\u5165\u8FD9\u91CC\u3002",
        artistReadyToast: "\u6B4C\u624B\u9875\u5DF2\u5C31\u7EEA",
        pageReadyToast: "\u9875\u9762\u5DF2\u52A0\u8F7D\u5B8C\u6210",
        closeNotice: "\u5173\u95ED\u63D0\u793A",
        libTabsLabel: "\u66F2\u5E93\u89C6\u56FE",
        libTabLibrary: "\u66F2\u5E93",
        libTabLikes: "\u6211\u559C\u6B22",
        playLikes: "\u64AD\u653E\u6211\u559C\u6B22",
        likesEmptyTitle: "\u8FD8\u6CA1\u6709\u559C\u6B22\u7684\u6B4C",
        likesEmptyBody: "\u5728\u66F2\u5E93\u91CC\u70B9 \u2665\uFF0C\u6B4C\u66F2\u4F1A\u81EA\u52A8\u5165\u5E93\u5E76\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
        dislikeBtn: "\u4E0D\u559C\u6B22",
        undislikeBtn: "\u53D6\u6D88\u4E0D\u559C\u6B22",
        undislikedBtn: "\u5DF2\u6807\u8BB0\u4E0D\u559C\u6B22\uFF0C\u70B9\u51FB\u53D6\u6D88",
        statDislikes: "\u4E0D\u559C\u6B22",
        dislikesTitle: "\u4E0D\u559C\u6B22\u7684\u6B4C",
        dislikesEmpty: "\u8FD8\u6CA1\u6709\u6807\u8BB0\u4E0D\u559C\u6B22\u7684\u6B4C",
        genre_pop: "\u6D41\u884C",
        genre_rock: "\u6447\u6EDA",
        genre_hiphop: "\u8BF4\u5531",
        genre_punk: "\u670B\u514B",
        genre_country: "\u4E61\u6751",
        welcomePathLabel: "\u97F3\u4E50\u76EE\u5F55\uFF08\u53EF\u9009\uFF09",
        welcomePathPlaceholder: "~/Music/\u6211\u7684\u97F3\u4E50",
        welcomePathHint: "\u7559\u7A7A\u5219\u4F7F\u7528\u5DF2\u7ECF\u626B\u63CF\u5230\u7684\u66F2\u5E93\uFF1B\u586B\u4E86\u4F1A\u81EA\u52A8\u6302\u8F7D\u5E76\u91CD\u65B0\u626B\u63CF\u3002",
        tabLibrary: "\u66F2\u5E93",
        tabReco: "\u63A8\u8350",
        tabNow: "\u6B63\u5728\u64AD\u653E",
        searchPlaceholder: "\u641C\u7D22\u6B4C\u66F2\u3001\u6B4C\u624B\u6216\u4E13\u8F91",
        groupNone: "\u5217\u8868",
        groupArtist: "\u6309\u6B4C\u624B",
        groupAlbum: "\u6309\u4E13\u8F91",
        groupLabel: "\u5206\u7EC4\u65B9\u5F0F",
        rescan: "\u91CD\u65B0\u626B\u63CF",
        rescanning: "\u626B\u63CF\u4E2D\u2026",
        tracksUnit: "\u9996",
        playAll: "\u64AD\u653E\u5168\u90E8",
        shufflePlay: "\u968F\u673A\u64AD\u653E",
        loading: "\u6B63\u5728\u626B\u63CF\u66F2\u5E93\u2026",
        loadError: "\u66F2\u5E93\u52A0\u8F7D\u5931\u8D25",
        retry: "\u91CD\u8BD5",
        emptyLibraryTitle: "\u66F2\u5E93\u8FD8\u662F\u7A7A\u7684",
        emptyLibraryBody: "\u641C\u6B4C\u624B\u6216\u6B4C\u540D\u5C31\u80FD\u5728\u7EBF\u8BD5\u542C\uFF0C\u559C\u6B22\u7684\u6B4C\u4F1A\u81EA\u52A8\u5165\u5E93\uFF1B\u5DF2\u6709\u97F3\u4E50\u4E5F\u53EF\u4EE5\u653E\u8FDB\u626B\u63CF\u76EE\u5F55\u3002",
        emptySearchCta: "\u641C\u6B4C\u624B/\u6B4C\u540D\u8BD5\u542C",
        emptyAddDirHint: "\u9ED8\u8BA4\u626B\u63CF\u76EE\u5F55\uFF08\u652F\u6301 mp3 / flac / m4a / wav \u7B49\uFF09\uFF1A",
        emptyRescanCta: "\u91CD\u65B0\u626B\u63CF\u66F2\u5E93",
        emptyDirNote: "\u4E5F\u53EF\u4EE5\u5728\u63D2\u4EF6\u914D\u7F6E\u91CC\u7528 directories \u81EA\u5B9A\u4E49\u626B\u63CF\u76EE\u5F55\u3002",
        syncOptional: "Spotify \u540C\u6B65\uFF08\u53EF\u9009\uFF09",
        syncOptionalHint: "\u53EF\u9009\u529F\u80FD\uFF1A\u9700\u8981\u673A\u5668\u4E0A\u5DF2\u5B89\u88C5 spotify-sync CLI\uFF0C\u6CA1\u6709\u4E5F\u4E0D\u5F71\u54CD\u542C\u6B4C",
        syncUnavailableHint: "\u672A\u68C0\u6D4B\u5230 spotify-sync CLI\uFF0C\u540C\u6B65\u529F\u80FD\u6682\u4E0D\u53EF\u7528\uFF08\u53EF\u8DF3\u8FC7\uFF0C\u4E0D\u5F71\u54CD\u542C\u6B4C\uFF09",
        exploreChip: "\u63A2\u7D22\u6279\u6B21",
        recoColdTitle: "\u8FD8\u6CA1\u6709\u6536\u542C\u5386\u53F2",
        recoColdBody: "\u5148\u641C\u6B4C\u624B\u6216\u6B4C\u540D\u8BD5\u542C\uFF0C\u559C\u6B22\u7684\u6B4C\u4F1A\u81EA\u52A8\u5165\u5E93\uFF1B\u542C\u8FC7\u51E0\u9996\u540E\u8FD9\u91CC\u4F1A\u6309\u4F60\u7684\u53E3\u5473\u63A8\u8350\u3002",
        unknownAlbum: "\u672A\u77E5\u4E13\u8F91",
        unknownArtist: "\u672A\u77E5\u6B4C\u624B",
        nowPlaying: "\u6B63\u5728\u64AD\u653E",
        queue: "\u64AD\u653E\u961F\u5217",
        queueEmpty: "\u961F\u5217\u7A7A\u7A7A\u5982\u4E5F\uFF0C\u53BB\u66F2\u5E93\u70B9\u4E00\u9996\u6B4C\u5427\u3002",
        noTrackTitle: "\u8FD8\u6CA1\u6709\u5728\u64AD\u653E\u7684\u6B4C",
        noTrackBody: "\u53BB\u66F2\u5E93\u6311\u4E00\u9996\uFF0C\u6309\u4E0B\u64AD\u653E\uFF0C\u8FD9\u91CC\u4F1A\u53D8\u6210\u4F60\u7684\u4E13\u5C5E\u64AD\u653E\u53F0\u3002",
        goLibrary: "\u53BB\u66F2\u5E93",
        play: "\u64AD\u653E",
        pause: "\u6682\u505C",
        prev: "\u4E0A\u4E00\u9996",
        next: "\u4E0B\u4E00\u9996",
        shuffle: "\u968F\u673A\u64AD\u653E",
        shuffleOn: "\u968F\u673A\u64AD\u653E\uFF1A\u5F00",
        repeat: "\u5FAA\u73AF\u6A21\u5F0F",
        repeatOff: "\u5FAA\u73AF\uFF1A\u5173",
        repeatAll: "\u5FAA\u73AF\uFF1A\u5217\u8868\u5FAA\u73AF",
        repeatOne: "\u5FAA\u73AF\uFF1A\u5355\u66F2\u5FAA\u73AF",
        volume: "\u97F3\u91CF",
        mute: "\u9759\u97F3",
        unmute: "\u53D6\u6D88\u9759\u97F3",
        stop: "\u505C\u6B62\u5E76\u5173\u95ED",
        miniLabel: "\u8FF7\u4F60\u64AD\u653E\u6761",
        openNow: "\u6253\u5F00\u6B63\u5728\u64AD\u653E",
        playError: "\u64AD\u653E\u51FA\u9519",
        recoTitle: "\u63A8\u8350",
        recoBody: '\u57FA\u4E8E\u4F60\u7684\u6536\u542C\u5386\u53F2\uFF0C\u6BCF\u6279\u7EA6 10 \u9996\uFF1A7 \u9996\u53E3\u5473\u76F8\u8FD1 + 3 \u9996\u5F3A\u5236\u63A2\u7D22\uFF08\u6D41\u6D3E / \u8BED\u8A00 / \u5E74\u4EE3\u8F6E\u6362\uFF0C\u8FD8\u6709"\u610F\u5916\u4E4B\u559C"\u4F4D\uFF09\uFF0C\u5E2E\u4F60\u6253\u7834\u4FE1\u606F\u8327\u623F\u3002',
        recoNote: "\u6BCF\u9996\u5019\u9009\u90FD\u4F1A\u5148\u8054\u7F51\u6838\u5B9E\u771F\u5B9E\u5B58\u5728\uFF0C\u9644\u63A8\u8350\u7406\u7531\uFF1B\u8BD5\u542C\u4E0D\u5360\u7A7A\u95F4\uFF0C\u559C\u6B22\u7684\u6B4C\u624D\u81EA\u52A8\u5165\u5E93\u5230 ~/Music/dsh-music\u3002",
        recoTaste: "\u53E3\u5473\u76F8\u8FD1",
        recoSimilar: "\u76F8\u8FD1",
        recoExplore: "\u5F3A\u5236\u63A2\u7D22",
        recoVerify: "\u8054\u7F51\u6838\u5B9E",
        searchEmpty: "\u6CA1\u6709\u5339\u914D\u7684\u6B4C\u66F2\uFF0C\u6362\u4E2A\u5173\u952E\u8BCD\u8BD5\u8BD5\u3002",
        untitled: "\u672A\u547D\u540D",
        sourceSpotify: "Spotify \u6536\u85CF",
        sourceDsh: "\u63A8\u8350\u5165\u5E93",
        sourceApple: "Apple Music",
        seekLabel: "\u64AD\u653E\u8FDB\u5EA6",
        playTrack: "\u64AD\u653E\u8FD9\u9996\u6B4C",
        scanFailedHint: "\u8BF7\u786E\u8BA4 Host \u534A\u5DF2\u5B89\u88C5\u5E76\u542F\u7528\uFF08/dsh-music/api/library\uFF09\u3002",
        networkError: "\u65E0\u6CD5\u8FDE\u63A5\u97F3\u4E50\u670D\u52A1\uFF0C\u8BF7\u786E\u8BA4\u63D2\u4EF6 Host \u534A\u5DF2\u542F\u7528\u3002",
        audioError: "\u97F3\u9891\u52A0\u8F7D\u5931\u8D25\uFF0C\u6587\u4EF6\u53EF\u80FD\u5DF2\u79FB\u52A8\u6216\u635F\u574F\u3002",
        lyricsTitle: "\u6B4C\u8BCD",
        lyricsNone: "\u6682\u65E0\u6B4C\u8BCD\uFF0C\u4EC5\u64AD\u653E",
        lyricsLoading: "\u6B4C\u8BCD\u52A0\u8F7D\u4E2D\u2026",
        lyricsError: "\u6B4C\u8BCD\u52A0\u8F7D\u5931\u8D25",
        lyricsRetry: "\u91CD\u8BD5",
        lyricsSourceEmbedded: "\u5185\u5D4C\u6807\u7B7E",
        lyricsSourceLrclib: "LRCLIB",
        lyricsSourceWeb: "\u8054\u7F51\u8865\u9F50",
        lyricsSource: "\u6B4C\u8BCD\u6765\u6E90",
        artistOpen: "\u67E5\u770B\u6B4C\u624B\u5361\u7247",
        artistIntro: "\u7B80\u4ECB",
        artistNews: "\u8FD1\u671F\u52A8\u6001",
        artistTrivia: "\u9038\u95FB\u8DA3\u4E8B",
        artistSimilarArtists: "\u76F8\u4F3C\u6B4C\u624B",
        artistSimilarSongs: "\u76F8\u4F3C\u6B4C\u66F2",
        kindFact: "\u4E8B\u5B9E",
        kindRumor: "\u4F20\u95FB",
        citeLink: "\u6765\u6E90\u94FE\u63A5",
        citeSource: "\u6765\u6E90",
        noSection: "\u6682\u65E0\u5185\u5BB9",
        statPlays: "\u64AD\u653E\u6B21\u6570",
        statSeconds: "\u603B\u65F6\u957F",
        statSongs: "\u6B4C\u66F2\u6570",
        statArtists: "\u6B4C\u624B\u6570",
        statSkipped: "\u8DF3\u8FC7\u6B21\u6570",
        statCompletion: "\u5E73\u5747\u5B8C\u6574\u5EA6",
        trendTitle: "\u8FD1 7 \u5929",
        topSongs: "\u5E38\u542C\u6B4C\u66F2",
        topUnplayable: "\u8BE5\u6B4C\u66F2\u5F53\u524D\u4E0D\u5728\u66F2\u5E93\uFF0C\u65E0\u6CD5\u64AD\u653E",
        topArtists: "\u5E38\u542C\u6B4C\u624B",
        playsUnit: "\u6B21",
        modeOne: "\u5355\u66F2\u5FAA\u73AF",
        modeOrder: "\u987A\u5E8F\u64AD\u653E",
        modeShuffle: "\u968F\u673A\u64AD\u653E",
        hideMini: "\u9690\u85CF\u8FF7\u4F60\u64AD\u653E\u6761",
        showMini: "\u663E\u793A\u8FF7\u4F60\u64AD\u653E\u6761",
        recoToday: "\u4ECA\u65E5\u63A8\u8350",
        recoArtist: "\u6B4C\u624B\u63A8\u8350",
        recoNew: "\u65B0\u6B4C\u63A8\u8350",
        recoSectionEmpty: "\u8FD9\u4E00\u680F\u8FD8\u6CA1\u6709\u5185\u5BB9\uFF0C\u70B9\u300C\u6362\u4E00\u6279\u300D\u751F\u6210\u3002",
        deleteTrack: "\u5220\u9664",
        revealTrack: "\u5728 Finder \u663E\u793A",
        deleteConfirm: "\u4ECE\u66F2\u5E93\u5220\u9664\u8FD9\u9996\u6B4C\uFF1F\u672C\u5730\u6587\u4EF6\u4F1A\u88AB\u79FB\u9664\u3002",
        deleteLikedConfirm: "\u8FD9\u662F Spotify \u6536\u85CF\u91CC\u7684\u6B4C\u3002\u5220\u9664\u53EA\u4F1A\u53BB\u6389\u672C\u5730\u6587\u4EF6\uFF0C\u4E0D\u4F1A\u53D6\u6D88\u4E91\u7AEF\u6536\u85CF\u3002\u786E\u5B9A\u7EE7\u7EED\uFF1F",
        deleteLikedConfirm2: "\u518D\u6B21\u786E\u8BA4\uFF1A\u672C\u5730\u6587\u4EF6\u5220\u9664\u540E\u65E0\u6CD5\u4ECE\u63D2\u4EF6\u6062\u590D\u3002",
        deleteFailed: "\u5220\u9664\u5931\u8D25",
        searchTypeSong: "\u6B4C\u66F2",
        searchTypeArtist: "\u6B4C\u624B",
        searchWebTitle: "\u7F51\u4E0A\u8865\u5168\uFF08MusicBrainz\uFF09",
        searchNoLocal: "\u672C\u5730\u66F2\u5E93\u6CA1\u6709\u5339\u914D\uFF0C\u53EF\u4EE5\u8BD5\u8BD5\u4E0B\u9762\u7684\u5728\u7EBF\u8865\u5168\u3002",
        styleBtn: "\u641C\u98CE\u683C",
        stylePlaceholder: "\u63CF\u8FF0\u4E00\u79CD\u98CE\u683C\uFF0C\u5982\uFF1A\u6DF1\u591C\u7235\u58EB / \u7CA4\u8BED\u7ECF\u5178",
        styleLoading: "\u6B63\u5728\u6309\u98CE\u683C\u68C0\u7D22\u5E76\u9010\u9996\u6838\u5B9E\uFF0C\u7EA6\u9700\u51E0\u5341\u79D2\u2026",
        styleError: "\u98CE\u683C\u641C\u7D22\u5931\u8D25",
        styleEmpty: "\u6CA1\u6709\u5339\u914D\u8FD9\u4E2A\u98CE\u683C\u7684\u5DF2\u6838\u5B9E\u6B4C\u66F2\uFF0C\u6362\u4E2A\u63CF\u8FF0\u8BD5\u8BD5\u3002",
        interpretedAs: "\u7406\u89E3\u4E3A",
        styleChip: "\u98CE\u683C",
        backToReco: "\u8FD4\u56DE\u63A8\u8350",
        colToday: "\u4ECA\u65E5\u63A8\u8350",
        colArtist: "\u6B4C\u624B\u63A8\u8350",
        colNew: "\u65B0\u6B4C\u63A8\u8350",
        playColumn: "\u64AD\u653E\u672C\u680F",
        likeBtn: "\u559C\u6B22",
        likedBtn: "\u5DF2\u559C\u6B22",
        unlikeBtn: "\u53D6\u6D88\u559C\u6B22",
        previewLoading: "\u8BD5\u542C\u51C6\u5907\u4E2D\uFF0C\u8BF7\u7A0D\u5019\u2026",
        previewFail: "\u8BD5\u542C\u5931\u8D25",
        previewNoVerify: "\u8BE5\u66F2\u76EE\u7F3A\u5C11\u6838\u5B9E\u8BB0\u5F55\uFF0C\u6682\u65E0\u6CD5\u8BD5\u542C",
        previewLabel: "\u8BD5\u542C\uFF08\u4E0D\u5165\u5E93\uFF09",
        modeHintOne: "\u5355\u66F2\u5FAA\u73AF\uFF1A\u53CD\u590D\u64AD\u653E\u5F53\u524D\u8FD9\u9996",
        modeHintOrder: "\u987A\u5E8F\u64AD\u653E\uFF1A\u6309\u961F\u5217\u4F9D\u6B21\u64AD\u653E",
        modeCycleHint: "\u70B9\u51FB\u5207\u6362\u64AD\u653E\u6A21\u5F0F",
        modeHintShuffle: "\u968F\u673A\u64AD\u653E\uFF1A\u6BCF\u8F6E\u6253\u4E71\u4E0D\u91CD\u590D",
        artistPageBack: "\u8FD4\u56DE\u63A8\u8350",
        artistSongs: "\u6B4C\u66F2",
        artistLoading: "\u6B63\u5728\u6253\u5F00\u6B4C\u624B\u9875\u2026",
        artistError: "\u6B4C\u624B\u9875\u52A0\u8F7D\u5931\u8D25",
        artistNoSongs: "\u8FD9\u4F4D\u6B4C\u624B\u6682\u65F6\u6CA1\u6709\u5DF2\u6838\u5B9E\u7684\u6B4C\u66F2\u3002",
        miniNeedsTrack: "\u64AD\u653E\u4EFB\u610F\u6B4C\u66F2\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u8FF7\u4F60\u64AD\u653E\u6761",
        miniCollapse: "\u6536\u8D77",
        miniExpand: "\u5C55\u5F00",
        miniDrag: "\u62D6\u52A8\u8C03\u6574\u4F4D\u7F6E",
        miniLyrics: "\u6B4C\u8BCD",
        playList: "\u64AD\u653E\u8BE5\u5217\u8868",
        recoGenerate: "\u751F\u6210\u63A8\u8350",
        recoRegenerate: "\u6362\u4E00\u6279",
        recoGenerating: "\u6B63\u5728\u751F\u6210\u63A8\u8350\uFF08\u6BCF\u9996\u5019\u9009\u5148\u8054\u7F51\u6838\u5B9E\uFF0C\u7EA6\u9700\u534A\u5206\u949F\uFF09\u2026",
        recoRefresh: "\u91CD\u65B0\u63A8\u8350\u672C\u680F",
        recoRefreshHint: "\u53EA\u91CD\u7B97\u8FD9\u4E00\u680F\uFF0C\u5176\u4F59\u4E24\u680F\u4FDD\u6301\u5F53\u5929\u5DF2\u56FA\u5316\u7684\u5185\u5BB9",
        recoRefreshing: "\u6B63\u5728\u91CD\u65B0\u63A8\u8350\u8FD9\u4E00\u680F\u2026",
        recoRefreshBusy: "\u8FD9\u4E00\u680F\u6B63\u5728\u751F\u6210\u4E2D\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5",
        recoEmptyTitle: "\u8FD8\u6CA1\u6709\u63A8\u8350",
        recoEmptyBody: "\u57FA\u4E8E\u4F60\u7684\u6536\u542C\u5386\u53F2\u751F\u6210\u4E00\u6279 10 \u9996\uFF1A7 \u9996\u53E3\u5473\u76F8\u8FD1 + 3 \u9996\u5F3A\u5236\u63A2\u7D22\uFF08\u6D41\u6D3E/\u8BED\u8A00/\u5E74\u4EE3\u8F6E\u6362\uFF09\uFF0C\u6BCF\u9996\u90FD\u5148\u8054\u7F51\u6838\u5B9E\u771F\u5B9E\u5B58\u5728\uFF0C\u675C\u7EDD\u5E7B\u89C9\u6B4C\u66F2\u3002\u591A\u542C\u51E0\u9996\u6B4C\uFF0C\u63A8\u8350\u4F1A\u66F4\u61C2\u4F60\u3002",
        recoError: "\u63A8\u8350\u751F\u6210\u5931\u8D25",
        downloadTitle: "\u5165\u5E93\u961F\u5217",
        downloadBtn: "\u5165\u5E93",
        downloading: "\u5165\u5E93\u4E2D\u2026",
        downloadDone: "\u5DF2\u5165\u5E93",
        downloadFail: "\u5931\u8D25",
        downloadPlay: "\u5DF2\u5165\u5E93\uFF0C\u66F2\u5E93\u5DF2\u5237\u65B0\uFF0C\u53EF\u76F4\u63A5\u64AD\u653E\u3002",
        downloadError: "\u5165\u5E93\u5931\u8D25",
        downloadIdle: "\u6682\u65E0\u5165\u5E93\u4EFB\u52A1",
        syncBtn: "\u540C\u6B65 Spotify",
        syncing: "\u540C\u6B65\u4E2D\u2026",
        syncCloud: "\u4E91\u7AEF\u6536\u85CF",
        syncAdded: "\u65B0\u589E\u5165\u5E93",
        syncRemoved: "\u4E91\u7AEF\u79FB\u9664",
        syncOk: "\u672C\u5730\u5DF2\u6709",
        syncFail: "\u5931\u8D25",
        syncMissing: "\u672C\u5730\u7F3A\u5931",
        syncError: "\u540C\u6B65\u5931\u8D25",
        tabHistory: "\u5386\u53F2",
        historyTitle: "\u6536\u542C\u5386\u53F2",
        historyEmpty: "\u8FD8\u6CA1\u6709\u64AD\u653E\u8BB0\u5F55\uFF0C\u53BB\u66F2\u5E93\u653E\u51E0\u9996\u6B4C\u5427\u3002",
        historyLoading: "\u5386\u53F2\u52A0\u8F7D\u4E2D\u2026",
        historyError: "\u5386\u53F2\u52A0\u8F7D\u5931\u8D25",
        historySkipped: "\u8DF3\u8FC7",
        historyComplete: "\u5B8C\u6574\u5EA6",
        verified: "\u5DF2\u6838\u5B9E"
      };
      const en = {
        consoleUseModel: "Interpret with Harness model",
        consoleModelHint: "Only the typed prompt is sent to the configured model service.",
        consoleModelBusy: "Interpreting\u2026",
        consoleModelApplied: "Model interpretation",
        consoleModelFallback: "The model was unavailable. Local rules generated this queue.",
        consoleHome: "Home",
        consoleHomeTitle: "dsh-music",
        consoleHomeCopy: "A soundtrack for work and creativity. Start with your own library.",
        consoleStart: "Open curation",
        consoleStudio: "Music studio",
        consoleStudioCopy: "Describe a scene, duration, artist or genre to make a queue from your local library.",
        consolePrompt: "Curation prompt",
        consoleGenerate: "Generate",
        consoleProfile: "Listening profile",
        consoleTarget: "Target",
        consoleCommand: "Command palette",
        consoleCommandPlaceholder: "Search local tracks or enter a / command",
        consoleNoCommand: "No matching commands.",
        consoleSendPrompt: "Press Enter to open this prompt in the music studio.",
        consoleSave: "Save playlist",
        consoleSaved: "Saved",
        consolePlaylists: "Saved playlists",
        consoleRemove: "Remove playlist",
        consoleNoSaved: "Save a generated playlist to play it again here.",
        consoleSaveError: "Browser storage is unavailable or full.",
        consoleMissing: "The tracks in this playlist are no longer in the library.",
        consoleNoMatches: "No playable tracks matched. Try fewer filters or check your library tags.",
        consoleLog: "Curation log",
        consoleNoLogs: "Your curation and playback actions will appear here.",
        consoleLogGenerated: "Queue generated",
        consoleLogPlayed: "Playback started",
        consoleLogSaved: "Playlist saved",
        consoleLogOpened: "Playlist opened",
        consoleLogRemoved: "Playlist removed",
        consoleExploreArtist: "Explore this artist",
        consoleHistoryError: "Listening history is unavailable. Other modes are still available.",
        consoleMode_playlist: "Smart playlist",
        consoleHint_playlist: "Try: a 40 minute rock playlist",
        consoleMode_radio: "Personal radio",
        consoleHint_radio: "Build a listening queue around your preferences",
        consoleMode_history: "Time machine",
        consoleHint_history: "Replay tracks from the last 30 days",
        consoleMode_find: "Music archaeology",
        consoleHint_find: "Search by song, artist or album, or leave blank for the current track",
        consoleMode_daily: "Daily discovery",
        consoleHint_daily: "Uncover up to five local tracks each day",
        consolePresetFocus: "60 minutes of coding focus",
        consolePresetRelax: "40 minutes to relax",
        consolePresetEnergy: "30 minute workout",
        panel: "Music",
        welcomeTitle: "Welcome to dsh-music",
        welcomeSub: "A local-first music library and recommender. Tell me what you like and I will tune the panel to you.",
        welcomeStart: "Set it up",
        welcomeSkip: "Just browse",
        welcomeBack: "Back to the app",
        welcomePoint1: "Play your local library with lyrics and artist profiles",
        welcomePoint2: "Recommendations tuned to your taste; only liked songs are saved",
        welcomePoint3: "Everything stays on this computer",
        welcomeTasteTitle: "What do you like to hear?",
        welcomeTasteSub: "Pick as many as you want, or skip; you can change this later in Recommendations.",
        welcomeGenres: "Genres",
        welcomeLanguages: "Languages",
        welcomePrev: "Back",
        welcomeNext: "Next",
        welcomeLibTitle: "Where should we start?",
        welcomeLibSub: "Already have local music? Pick the first one. Otherwise I prepared a free public-domain starter library.",
        welcomeLocalTitle: "Use my existing music",
        welcomeLocalBody: "Scan ~/Music/dsh-music, spotify-liked and other default folders",
        welcomeStarterTitle: "Use the built-in starter library",
        welcomeStarterBody: "A few CC0 / public-domain tracks, verified and credited one by one",
        welcomeStarterHint: "Tracks download one at a time to ~/Music/dsh-music/starter and are added automatically; network failures are skipped, never blocking.",
        welcomeLocalHint: "The library will be scanned right away and you will land in Library.",
        welcomeFinish: "Finish",
        welcomeStarterDownloading: "Preparing the starter library\u2026",
        welcomeStarterReady: "Starter library is ready",
        welcomeStarterSkipped: "Network unavailable \u2014 starter skipped, explore Recommendations instead",
        welcomeCredits: "Tracks & licences",
        welcomeEnter: "Open Recommendations",
        welcomeSaveFail: "Could not save \u2014 please try again",
        welcomePreview: "Preview welcome",
        genre_jazz: "Jazz",
        genre_classical: "Classical",
        genre_electronic: "Electronic",
        genre_blues: "Blues",
        genre_reggae: "Reggae",
        genre_soul: "Soul",
        genre_folk: "Folk",
        genre_metal: "Metal",
        genre_funk: "Funk",
        genre_ambient: "Ambient",
        lang_zh: "Chinese",
        lang_en: "English",
        lang_yue: "Cantonese",
        lang_ja: "Japanese",
        lang_ko: "Korean",
        lang_fr: "French",
        lang_es: "Spanish",
        lang_pt: "Portuguese",
        lang_it: "Italian",
        welcomeTasteNote: "Preferences only bias the discovery batch - nothing is locked, and you can change them any time.",
        favsTitle: "Liked",
        favsViewAll: "View all",
        favsBack: "Back to library",
        favsEmpty: "No liked songs yet \u2014 hit the heart on any song and it lands here.",
        artistReadyToast: "Artist page ready",
        pageReadyToast: "Page ready",
        closeNotice: "Dismiss",
        libTabsLabel: "Library views",
        libTabLibrary: "Library",
        libTabLikes: "Liked",
        playLikes: "Play liked",
        likesEmptyTitle: "No liked songs yet",
        likesEmptyBody: "Hit the heart on any song to add it to your library and to this list.",
        dislikeBtn: "Dislike",
        undislikeBtn: "Undo dislike",
        undislikedBtn: "Marked as disliked \u2014 click to undo",
        statDislikes: "Disliked",
        dislikesTitle: "Disliked songs",
        dislikesEmpty: "Nothing disliked yet",
        genre_pop: "Pop",
        genre_rock: "Rock",
        genre_hiphop: "Hip-hop",
        genre_punk: "Punk",
        genre_country: "Country",
        welcomePathLabel: "Music folder (optional)",
        welcomePathPlaceholder: "~/Music/My Music",
        welcomePathHint: "Leave empty to use the library already scanned; a folder is mounted and rescanned.",
        tabLibrary: "Library",
        tabReco: "For You",
        tabNow: "Now Playing",
        searchPlaceholder: "Search songs, artists or albums",
        groupNone: "List",
        groupArtist: "By artist",
        groupAlbum: "By album",
        groupLabel: "Group by",
        rescan: "Rescan",
        rescanning: "Scanning\u2026",
        tracksUnit: "tracks",
        playAll: "Play all",
        shufflePlay: "Shuffle",
        loading: "Scanning your library\u2026",
        loadError: "Library failed to load",
        retry: "Retry",
        emptyLibraryTitle: "Your library is empty",
        emptyLibraryBody: "Search an artist or song to preview it right away \u2014 liked songs are added automatically. Your own music can also go into the scanned folders.",
        emptySearchCta: "Search to preview",
        emptyAddDirHint: "Default scanned folders (mp3 / flac / m4a / wav\u2026):",
        emptyRescanCta: "Rescan library",
        emptyDirNote: "You can also set custom folders with `directories` in the plugin config.",
        syncOptional: "Spotify sync (optional)",
        syncOptionalHint: "Optional: needs the spotify-sync CLI installed; music works without it",
        syncUnavailableHint: "spotify-sync CLI not found \u2014 sync is unavailable (safe to skip)",
        exploreChip: "Exploration batch",
        recoColdTitle: "No listening history yet",
        recoColdBody: "Search and preview some songs first \u2014 liked songs are added automatically, and recommendations will follow your taste.",
        unknownAlbum: "Unknown album",
        unknownArtist: "Unknown artist",
        nowPlaying: "Now playing",
        queue: "Queue",
        queueEmpty: "The queue is empty \u2014 pick a song from the library.",
        noTrackTitle: "Nothing is playing",
        noTrackBody: "Pick a song from the library and press play; this becomes your personal deck.",
        goLibrary: "Open library",
        play: "Play",
        pause: "Pause",
        prev: "Previous",
        next: "Next",
        shuffle: "Shuffle",
        shuffleOn: "Shuffle: on",
        repeat: "Repeat mode",
        repeatOff: "Repeat: off",
        repeatAll: "Repeat: queue",
        repeatOne: "Repeat: one",
        volume: "Volume",
        mute: "Mute",
        unmute: "Unmute",
        stop: "Stop and close",
        miniLabel: "Mini player",
        openNow: "Open Now Playing",
        playError: "Playback error",
        recoTitle: "For You",
        recoBody: "Built from your listening history, ~10 tracks per batch: 7 close to your taste + 3 forced explorations (genre / language / era rotation plus a wildcard slot) to break the filter bubble.",
        recoNote: "Every candidate is verified online first and ships with a reason; previews cost no space, and only liked songs land in ~/Music/dsh-music.",
        recoTaste: "Close to taste",
        recoSimilar: "Similar",
        recoExplore: "Forced exploration",
        recoVerify: "Verified online",
        searchEmpty: "No matching tracks \u2014 try another keyword.",
        untitled: "Untitled",
        sourceSpotify: "Spotify liked",
        sourceDsh: "Recommended",
        sourceApple: "Apple Music",
        seekLabel: "Seek",
        playTrack: "Play this track",
        scanFailedHint: "Make sure the Host half is installed and enabled (/dsh-music/api/library).",
        networkError: "Cannot reach the music service. Is the plugin Host half enabled?",
        audioError: "Audio failed to load; the file may have moved or is corrupt.",
        lyricsTitle: "Lyrics",
        lyricsNone: "No lyrics \u2014 just play",
        lyricsLoading: "Loading lyrics\u2026",
        lyricsError: "Lyrics failed to load",
        lyricsRetry: "Retry",
        lyricsSourceEmbedded: "Embedded tags",
        lyricsSourceLrclib: "LRCLIB",
        lyricsSourceWeb: "Web lookup",
        lyricsSource: "Lyrics source",
        artistOpen: "Open artist card",
        artistIntro: "Intro",
        artistNews: "Recent news",
        artistTrivia: "Trivia",
        artistSimilarArtists: "Similar artists",
        artistSimilarSongs: "Similar songs",
        kindFact: "Fact",
        kindRumor: "Rumor",
        citeLink: "Source link",
        citeSource: "Source",
        noSection: "Nothing here yet",
        statPlays: "Plays",
        statSeconds: "Listening time",
        statSongs: "Songs",
        statArtists: "Artists",
        statSkipped: "Skipped",
        statCompletion: "Avg completion",
        trendTitle: "Last 7 days",
        topSongs: "Most played songs",
        topUnplayable: "This song is not in your library right now",
        topArtists: "Most played artists",
        playsUnit: "plays",
        modeOne: "Repeat one",
        modeOrder: "In order",
        modeShuffle: "Shuffle",
        hideMini: "Hide mini player",
        showMini: "Show mini player",
        recoToday: "Today",
        recoArtist: "By artist",
        recoNew: "New",
        recoSectionEmpty: "Nothing in this section yet. Generate a new batch.",
        deleteTrack: "Delete",
        revealTrack: "Show in Finder",
        deleteConfirm: "Remove this track from the library? The local file will be deleted.",
        deleteLikedConfirm: "This is a Spotify liked track. Deleting removes only the local file, not the cloud like. Continue?",
        deleteLikedConfirm2: "Confirm again: the local file cannot be restored from the plugin.",
        deleteFailed: "Delete failed",
        searchTypeSong: "Songs",
        searchTypeArtist: "Artists",
        searchWebTitle: "Web matches (MusicBrainz)",
        searchNoLocal: "Nothing local matched \u2014 try a web match below.",
        styleBtn: "Search style",
        stylePlaceholder: "Describe a vibe, e.g. late-night jazz / cantonese classics",
        styleLoading: "Searching by style and verifying each track (~tens of seconds)\u2026",
        styleError: "Style search failed",
        styleEmpty: "No verified songs match that style \u2014 try another description.",
        interpretedAs: "Understood as",
        styleChip: "Style",
        backToReco: "Back to recommendations",
        colToday: "Today for You",
        colArtist: "Artists",
        colNew: "New Finds",
        playColumn: "Play column",
        likeBtn: "Like",
        likedBtn: "Liked",
        unlikeBtn: "Unlike",
        previewLoading: "Preparing preview\u2026",
        previewFail: "Preview failed",
        previewNoVerify: "This track has no verification record yet \u2014 preview unavailable.",
        previewLabel: "Preview (not added to library)",
        modeHintOne: "Repeat one: loop the current song",
        modeHintOrder: "Play in order through the queue",
        modeCycleHint: "Click to switch play mode",
        modeHintShuffle: "Shuffle: random each pass, no repeats",
        artistPageBack: "Back to recommendations",
        artistSongs: "Songs",
        artistLoading: "Opening artist page\u2026",
        artistError: "Artist page failed to load",
        artistNoSongs: "No verified songs for this artist yet.",
        miniNeedsTrack: "Play any song and the mini player appears here",
        miniCollapse: "Collapse",
        miniExpand: "Expand",
        miniDrag: "Drag to move",
        miniLyrics: "Lyrics",
        playList: "Play this list",
        recoGenerate: "Generate",
        recoRegenerate: "Another batch",
        recoGenerating: "Generating recommendations (every candidate is verified online first, ~30s)\u2026",
        recoRefresh: "Refresh this column",
        recoRefreshHint: "Recomputes only this column; the other two keep today's fixed snapshot",
        recoRefreshing: "Refreshing this column\u2026",
        recoRefreshBusy: "This column is being generated \u2014 try again in a moment",
        recoEmptyTitle: "No recommendations yet",
        recoEmptyBody: "We build a batch of 10 from your listening history: 7 close to your taste + 3 forced explorations (genre / language / era rotation), each verified online before it shows up. Play a few more songs and it gets smarter.",
        recoError: "Recommendations failed",
        downloadTitle: "Add-to-library queue",
        downloadBtn: "Add",
        downloading: "Adding\u2026",
        downloadDone: "In library",
        downloadFail: "Failed",
        downloadPlay: "Added \u2014 the library was refreshed; play it from Library.",
        downloadError: "Could not add to library",
        downloadIdle: "Nothing queued",
        syncBtn: "Sync Spotify",
        syncing: "Syncing\u2026",
        syncCloud: "Cloud liked",
        syncAdded: "New songs",
        syncRemoved: "Removed from cloud",
        syncOk: "Already local",
        syncFail: "Failed",
        syncMissing: "Missing locally",
        syncError: "Sync failed",
        tabHistory: "History",
        historyTitle: "Listening history",
        historyEmpty: "No plays yet \u2014 go play something from the library.",
        historyLoading: "Loading history\u2026",
        historyError: "History failed to load",
        historySkipped: "Skipped",
        historyComplete: "Completion",
        verified: "Verified"
      };
      const cx = (...parts) => parts.filter(Boolean).join(" ");
      function formatTime2(sec) {
        if (sec == null || !isFinite(sec) || sec < 0) return "--:--";
        const s = Math.floor(sec % 60);
        const m = Math.floor(sec / 60) % 60;
        const hh = Math.floor(sec / 3600);
        const mm = hh > 0 ? String(m).padStart(2, "0") : String(m);
        return (hh > 0 ? hh + ":" : "") + mm + ":" + String(s).padStart(2, "0");
      }
      const baseUrl = typeof document !== "undefined" ? document.baseURI : "/";
      const resolveUrl = (path) => {
        try {
          const rel = String(path).replace(/^\/+/, "");
          return new URL(rel, baseUrl).href;
        } catch {
          return path;
        }
      };
      const T2S = {
        \u8F1D: "\u8F89",
        \u6B72: "\u5C81",
        \u8ECC: "\u8F68",
        \u8DE1: "\u8FF9",
        \u7336: "\u72B9",
        \u95CA: "\u9614",
        \u5922: "\u68A6",
        \u6DDA: "\u6CEA",
        \u6A4B: "\u6865",
        \u727D: "\u7275",
        \u639B: "\u6302",
        \u9D3F: "\u9E3D",
        \u8207: "\u4E0E",
        \u59B3: "\u4F60",
        \u6E6F: "\u6C64",
        \u8E48: "\u8E48",
        \u5F4E: "\u5F2F",
        \u5442: "\u5415",
        \u5B6B: "\u5B59",
        \u5F35: "\u5F20",
        \u5B78: "\u5B66",
        \u9673: "\u9648",
        \u8449: "\u53F6",
        \u856D: "\u8427",
        \u8A31: "\u8BB8",
        \u8B5A: "\u8C2D",
        \u912D: "\u90D1",
        \u9EC3: "\u9EC4",
        \u76E7: "\u5362",
        \u611B: "\u7231",
        \u6200: "\u604B",
        \u98A8: "\u98CE",
        \u96F2: "\u4E91",
        \u8ECA: "\u8F66",
        \u99AC: "\u9A6C",
        \u9CE5: "\u9E1F",
        \u8A9E: "\u8BED",
        \u96E3: "\u96BE",
        \u5834: "\u573A",
        \u904A: "\u6E38",
        \u6232: "\u620F",
        \u5091: "\u6770",
        \u6703: "\u4F1A",
        \u57F7: "\u6267",
        \u66D6: "\u66A7",
        \u7121: "\u65E0",
        \u66C9: "\u6653",
        \u6FD5: "\u6E7F",
        \u5167: "\u5185",
        \u50B7: "\u4F24",
        \u7661: "\u75F4",
        \u8072: "\u58F0",
        \u7D55: "\u7EDD",
        \u5C0D: "\u5BF9",
        \u7D42: "\u7EC8",
        \u96D9: "\u53CC",
        \u767C: "\u53D1",
        \u904E: "\u8FC7",
        \u5F8C: "\u540E",
        \u958B: "\u5F00",
        \u95DC: "\u5173",
        \u9580: "\u95E8",
        \u898B: "\u89C1",
        \u807D: "\u542C",
        \u66F8: "\u4E66",
        \u756B: "\u753B",
        \u6A02: "\u4E50",
        \u5718: "\u56E2",
        \u968A: "\u961F",
        \u54E1: "\u5458",
        \u98DB: "\u98DE",
        \u6A5F: "\u673A",
        \u96DE: "\u9E21",
        \u9D28: "\u9E2D",
        \u9B5A: "\u9C7C",
        \u98EF: "\u996D",
        \u9EB5: "\u9762",
        \u85DD: "\u827A",
        \u9418: "\u949F",
        \u97FF: "\u54CD",
        \u6B78: "\u5F52",
        \u8A0A: "\u8BAF",
        \u865F: "\u53F7",
        \u500B: "\u4E2A",
        \u5011: "\u4EEC",
        \u9019: "\u8FD9",
        \u88E1: "\u91CC",
        \u9EBC: "\u4E48",
        \u7FA9: "\u4E49",
        \u65BC: "\u4E8E",
        \u6230: "\u6218",
        \u8853: "\u672F",
        \u88DC: "\u8865",
        \u842C: "\u4E07",
        \u5C08: "\u4E13",
        \u696D: "\u4E1A",
        \u6B77: "\u5386",
        \u52D5: "\u52A8",
        \u975C: "\u9759",
        \u8B93: "\u8BA9",
        \u8AB0: "\u8C01",
        \u8B8A: "\u53D8",
        \u6771: "\u4E1C",
        \u5169: "\u4E24",
        \u56B4: "\u4E25",
        \u81E8: "\u4E34",
        \u70BA: "\u4E3A",
        \u860B: "\u82F9",
        \u5E36: "\u5E26",
        \u96E2: "\u79BB",
        \u96DC: "\u6742",
        \u9928: "\u9986",
        \u982D: "\u5934",
        \u9EDE: "\u70B9",
        \u5EF3: "\u5385",
        \u932F: "\u9519",
        \u9304: "\u5F55",
        \u9322: "\u94B1",
        \u9577: "\u957F",
        \u6642: "\u65F6",
        \u93C8: "\u94FE",
        \u9583: "\u95EA",
        \u9592: "\u95F2",
        \u554F: "\u95EE",
        \u9593: "\u95F4",
        \u8AA4: "\u8BEF",
        \u60B6: "\u95F7",
        \u58FD: "\u5BFF",
        \u89BA: "\u89C9",
        \u89BD: "\u89C8",
        \u89C0: "\u89C2",
        \u6B61: "\u6B22",
        \u6B98: "\u6B8B",
        \u6E4A: "\u51D1",
        \u6EC5: "\u706D",
        \u6EFF: "\u6EE1",
        \u6F38: "\u6E10",
        \u71D2: "\u70E7",
        \u71C8: "\u706F",
        \u7368: "\u72EC",
        \u7372: "\u83B7",
        \u74B0: "\u73AF",
        \u7A2E: "\u79CD",
        \u7A4D: "\u79EF",
        \u7AAE: "\u7A77",
        \u7AF6: "\u7ADE",
        \u7B46: "\u7B14",
        \u7BC9: "\u7B51",
        \u7C21: "\u7B80",
        \u985E: "\u7C7B",
        \u7D1A: "\u7EA7",
        \u7DF4: "\u7EC3",
        \u7E23: "\u53BF",
        \u7E54: "\u7EC7",
        \u7E8C: "\u7EED",
        \u7D93: "\u7ECF",
        \u7DE3: "\u7F18",
        \u7DE8: "\u7F16",
        \u7DE9: "\u7F13",
        \u7E2E: "\u7F29",
        \u5287: "\u5267",
        \u52F8: "\u529D",
        \u52DD: "\u80DC",
        \u52D9: "\u52A1",
        \u5340: "\u533A",
        \u91AB: "\u533B",
        \u5EE0: "\u5382",
        \u5EE2: "\u5E9F",
        \u5F37: "\u5F3A",
        \u5F48: "\u5F39",
        \u5FB9: "\u5F7B",
        \u61B6: "\u5FC6",
        \u61F7: "\u6000",
        \u64C1: "\u62E5",
        \u64CA: "\u51FB",
        \u64DA: "\u636E",
        \u64EC: "\u62DF",
        \u651D: "\u6444",
        \u6575: "\u654C",
        \u65B7: "\u65AD",
        \u820A: "\u65E7",
        \u986F: "\u663E",
        \u9802: "\u9876",
        \u9813: "\u987F",
        \u983B: "\u9891",
        \u9846: "\u9897",
        \u984C: "\u9898",
        \u984F: "\u989C",
        \u9858: "\u613F",
        \u990A: "\u517B",
        \u9918: "\u4F59",
        \u9935: "\u5582",
        \u99B3: "\u9A70",
        \u9A45: "\u9A71",
        \u9A5A: "\u60CA",
        \u7662: "\u75D2",
        \u7562: "\u6BD5"
      };
      function normalizeZh(s) {
        const lower = String(s || "").toLowerCase();
        let out = "";
        for (const ch of lower) out += T2S[ch] || ch;
        return out;
      }
      function isLibraryTrackId(id) {
        return typeof id === "string" && /^[0-9a-f]{16}$/.test(id);
      }
      function libraryTrackId(item) {
        if (isLibraryTrackId(item?.id)) return item.id;
        return isLibraryTrackId(item?.trackId) ? item.trackId : null;
      }
      function readPrefs() {
        try {
          const raw = localStorage.getItem("dsh-music.prefs");
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      }
      function writePrefs(patch) {
        try {
          localStorage.setItem("dsh-music.prefs", JSON.stringify({ ...readPrefs(), ...patch }));
        } catch {
        }
      }
      function createStore(initial) {
        let state = initial;
        const listeners = /* @__PURE__ */ new Set();
        return {
          getSnapshot: () => state,
          subscribe: (fn) => {
            listeners.add(fn);
            return () => {
              listeners.delete(fn);
            };
          },
          set: (patch) => {
            state = { ...state, ...patch };
            for (const fn of [...listeners]) fn();
          }
        };
      }
      function makeIcon(nodes, defaults2) {
        return function Icon({ size = 18, style, className } = {}) {
          return h("svg", {
            viewBox: "0 0 24 24",
            width: size,
            height: size,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.8,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": true,
            focusable: false,
            style,
            className,
            ...defaults2
          }, nodes.map((n, i) => h(n[0], { key: i, ...n[1] })));
        };
      }
      const FILLED = { fill: "currentColor", stroke: "none" };
      const IconNote = makeIcon([
        ["path", { d: "M9 18V5l10-2v13" }],
        ["circle", { cx: 6.5, cy: 18, r: 2.5 }],
        ["circle", { cx: 16.5, cy: 16, r: 2.5 }]
      ]);
      const IconPlay = makeIcon([["path", { d: "M8 5.4v13.2L19 12z", ...FILLED }]]);
      const IconPause = makeIcon([
        ["rect", { x: 7, y: 5, width: 3.4, height: 14, rx: 1.1, ...FILLED }],
        ["rect", { x: 13.6, y: 5, width: 3.4, height: 14, rx: 1.1, ...FILLED }]
      ]);
      const IconPrev = makeIcon([
        ["path", { d: "M18.5 6v12L10 12z", ...FILLED }],
        ["path", { d: "M6.5 5.5v13", strokeWidth: 2.2 }]
      ]);
      const IconNext = makeIcon([
        ["path", { d: "M5.5 6v12L14 12z", ...FILLED }],
        ["path", { d: "M17.5 5.5v13", strokeWidth: 2.2 }]
      ]);
      const IconShuffle = makeIcon([
        ["path", { d: "M3 7h3.4c1.5 0 2.9.7 3.8 1.9l4.2 6.2c.9 1.2 2.3 1.9 3.8 1.9H21" }],
        ["path", { d: "M3 17h3.4c1.5 0 2.9-.7 3.8-1.9l.8-1.2" }],
        ["path", { d: "M14.1 8.8l.8-1.1C15.8 6.5 17.2 5.8 18.7 5.8H21" }],
        ["path", { d: "M18.5 3.3 21.5 5.8 18.5 8.3" }],
        ["path", { d: "M18.5 14.5 21.5 17 18.5 19.5" }]
      ]);
      const IconRepeat = makeIcon([
        ["path", { d: "M17 2.8 20.4 6.2 17 9.6" }],
        ["path", { d: "M3.6 11.2V9.6a3.4 3.4 0 0 1 3.4-3.4h13.4" }],
        ["path", { d: "M7 21.2 3.6 17.8 7 14.4" }],
        ["path", { d: "M20.4 12.8v1.6a3.4 3.4 0 0 1-3.4 3.4H3.6" }]
      ]);
      const IconRepeatOne = makeIcon([
        ["path", { d: "M17 2.8 20.4 6.2 17 9.6" }],
        ["path", { d: "M3.6 11.2V9.6a3.4 3.4 0 0 1 3.4-3.4h13.4" }],
        ["path", { d: "M7 21.2 3.6 17.8 7 14.4" }],
        ["path", { d: "M20.4 12.8v1.6a3.4 3.4 0 0 1-3.4 3.4H3.6" }],
        ["path", { d: "M11.2 10.4l1.4-.9V15", strokeWidth: 1.6 }]
      ]);
      const IconVolume = makeIcon([
        ["path", { d: "M4 9.5v5h3.5L12 18.6V5.4L7.5 9.5z", ...FILLED }],
        ["path", { d: "M15.5 9.2a4.1 4.1 0 0 1 0 5.6" }],
        ["path", { d: "M18.2 6.6a7.9 7.9 0 0 1 0 10.8" }]
      ]);
      const IconMute = makeIcon([
        ["path", { d: "M4 9.5v5h3.5L12 18.6V5.4L7.5 9.5z", ...FILLED }],
        ["path", { d: "M16 9.5l5 5M21 9.5l-5 5" }]
      ]);
      const IconSearch = makeIcon([
        ["circle", { cx: 11, cy: 11, r: 6.5 }],
        ["path", { d: "M15.8 15.8 20.5 20.5" }]
      ]);
      const IconRefresh = makeIcon([
        ["path", { d: "M20 12a8 8 0 1 1-2.34-5.66" }],
        ["path", { d: "M20.4 2.8v4h-4" }]
      ]);
      const IconClose = makeIcon([["path", { d: "M6 6l12 12M18 6 6 18" }]]);
      const IconChevronDown = makeIcon([["path", { d: "M6 9.5l6 6 6-6" }]]);
      const IconChevronUp = makeIcon([["path", { d: "M6 14.5l6-6 6 6" }]]);
      const IconGrip = makeIcon([
        ["path", { d: "M9 7.2h.1M15 7.2h.1M9 12h.1M15 12h.1M9 16.8h.1M15 16.8h.1", strokeWidth: 2.6 }]
      ]);
      const IconSparkles = makeIcon([
        ["path", { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" }],
        ["path", { d: "M18.6 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" }]
      ]);
      const IconCheck = makeIcon([["path", { d: "M5 12.5l4.4 4.4L19 7" }]]);
      const IconFolder = makeIcon([
        ["path", { d: "M4 6.8A1.8 1.8 0 0 1 5.8 5h3.1l1.8 2.1h7.5A1.8 1.8 0 0 1 20 8.9v8.3a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2z" }]
      ]);
      const IconDisc = makeIcon([
        ["circle", { cx: 12, cy: 12, r: 8.6 }],
        ["circle", { cx: 12, cy: 12, r: 2.4 }]
      ]);
      const IconAlert = makeIcon([
        ["circle", { cx: 12, cy: 12, r: 8.6 }],
        ["path", { d: "M12 7.6v5.2M12 16.4v.1" }]
      ]);
      const IconQueue = makeIcon([["path", { d: "M4 6.5h16M4 12h16M4 17.5h10" }]]);
      const IconDownload = makeIcon([
        ["path", { d: "M12 4v10" }],
        ["path", { d: "M8 10.5 12 14.5 16 10.5" }],
        ["path", { d: "M5 18.5h14" }]
      ]);
      const IconHeart = makeIcon([
        ["path", { d: "M12 20s-7.4-4.6-9.3-9C1.4 7.6 3.4 4.5 6.6 4.5c2 0 3.4 1.1 4.2 2.4l1.2 2 1.2-2c.8-1.3 2.2-2.4 4.2-2.4 3.2 0 5.2 3.1 3.9 6.5-1.9 4.4-9.3 9-9.3 9z" }]
      ], { "data-heart": 1 });
      const IconThumbDown = makeIcon([
        ["path", { d: "M10.5 14.5V4.2c0-.7.6-1.2 1.3-1.2h4.4c.6 0 1.1.4 1.3 1l2.4 6.6c.2.5.1 1.1-.2 1.5-.3.4-.8.7-1.3.7h-4.1l.8 3.9c.2.9-.3 1.8-1.1 2.2-.5.3-1.1.3-1.6 0-.3-.2-.6-.5-.8-.9l-1.1-2.9z" }],
        ["path", { d: "M6.8 14.5H4.9c-.7 0-1.2-.5-1.2-1.2V4.2c0-.7.5-1.2 1.2-1.2h1.9c.7 0 1.2.5 1.2 1.2v9.1c0 .7-.5 1.2-1.2 1.2z" }]
      ], { "data-thumbdown": 1 });
      const CSS = `
.dshm-panel{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;}
.dshm-welcome{position:relative;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;animation:dshm-fade-in .28s ease-out;}
.dshm-welcome-inner{position:relative;width:min(540px,calc(100% - 48px));padding:32px 0;text-align:center;}
.dshm-welcome-preview .dshm-wclose{position:absolute;right:0;top:6px;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;}
.dshm-welcome-preview .dshm-wclose:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-welcome-hero{position:relative;}
.dshm-welcome-glow{position:absolute;left:50%;top:0;width:330px;height:300px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,var(--dsw-alias-brand-primary),transparent 70%);opacity:.16;filter:blur(18px);pointer-events:none;}
.dshm-welcome-fish{position:relative;display:flex;justify-content:center;animation:dshm-float 4.5s ease-in-out infinite;}
.dshm-welcome-title{font-size:26px;font-weight:700;margin:12px 0 6px;letter-spacing:-.2px;}
.dshm-welcome-sub{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.65;max-width:430px;margin:0 auto;}
.dshm-welcome-actions{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap;}
.dshm-wbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:9px 18px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:background .15s,border-color .15s,transform .15s;}
.dshm-wbtn:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-wbtn:active{transform:translateY(1px);}
.dshm-wbtn:disabled{opacity:.55;cursor:not-allowed;}
.dshm-wbtn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:transparent;}
.dshm-wbtn-primary:hover{background:var(--dsw-alias-button-primary-hover);}
.dshm-welcome-points{display:flex;flex-direction:column;gap:7px;margin:26px auto 0;width:fit-content;text-align:left;}
.dshm-wpoint{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;}
.dshm-welcome-panel{width:100%;}
.dshm-wstep-title{font-size:18px;font-weight:650;margin:0 0 6px;}
.dshm-wstep-sub{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6;margin:0 auto 18px;max-width:440px;}
.dshm-wgroup{margin:0 0 16px;text-align:left;}
.dshm-wlabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px;}
.dshm-wchips{display:flex;flex-wrap:wrap;gap:7px;}
.dshm-wchip{appearance:none;font:inherit;font-size:12px;padding:6px 13px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;transition:background .15s,border-color .15s,color .15s;}
.dshm-wchip:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-wchip-on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);border-color:transparent;}
.dshm-wcards{display:flex;flex-direction:column;gap:10px;text-align:left;}
.dshm-wcard{appearance:none;font:inherit;display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;transition:background .15s,border-color .15s,box-shadow .15s;}
.dshm-wcard:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-wcard-on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset;}
.dshm-wcard-icon{flex:none;width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);}
.dshm-wcard-text{display:flex;flex-direction:column;gap:3px;}
.dshm-wcard-title{font-size:13px;font-weight:600;}
.dshm-wcard-body{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;}
.dshm-whint{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:12px 0 0;line-height:1.55;}
.dshm-wpath{text-align:left;margin-top:14px;}
.dshm-winput{width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .15s;}
.dshm-winput:focus{border-color:var(--dsw-alias-brand-primary);}
.dshm-winput::placeholder{color:var(--dsw-alias-label-tertiary);}
.dshm-whint-err{color:var(--dsw-alias-state-error-primary);}
.dshm-wdots{display:flex;gap:6px;justify-content:center;margin-top:22px;}
.dshm-wdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2);transition:all .2s;}
.dshm-wdot-on{background:var(--dsw-alias-brand-primary);width:18px;border-radius:3px;}
.dshm-wprogress{display:flex;align-items:center;gap:10px;margin:4px 0 14px;}
.dshm-wprogress-track{flex:1;height:6px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}
.dshm-wprogress-fill{height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);transition:width .3s;}
.dshm-wtracks{text-align:left;display:flex;flex-direction:column;gap:5px;margin-bottom:16px;}
.dshm-wtrack{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.dshm-wtrack-lic{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none;}
@keyframes dshm-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-7px);}}
@keyframes dshm-fade-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.dshm-panel *{box-sizing:border-box;}
.dshm-header{flex:none;padding:14px 20px 0;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dshm-title-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.dshm-title{font-size:17px;font-weight:650;margin:0;letter-spacing:.2px;}
.dshm-count{color:var(--dsw-alias-label-tertiary);font-size:12px;}
.dshm-header-actions{margin-left:auto;display:flex;gap:8px;align-items:center;}
.dshm-tabs{display:flex;gap:4px;}
.dshm-tab{position:relative;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:8px 12px 10px;cursor:pointer;border-radius:8px 8px 0 0;display:inline-flex;align-items:center;gap:6px;transition:color .15s;}
.dshm-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);}
.dshm-tab[aria-selected="true"]{color:var(--dsw-alias-brand-text);font-weight:600;}
.dshm-tab[aria-selected="true"]::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary);}
.dshm-tab-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:dshm-pulse 1.6s ease-in-out infinite;}
.dshm-body{flex:1;min-height:0;display:flex;flex-direction:column;container-type:inline-size;}
.dshm-toolbar{flex:none;display:flex;align-items:center;gap:8px;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;width:100%;max-width:1120px;margin:0 auto;}
.dshm-libtabs{display:flex;align-items:center;gap:4px;padding:8px 20px 0;width:100%;max-width:1120px;margin:0 auto;flex:none;}
.dshm-libtabs-btn{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;padding:5px 12px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .12s,color .12s,border-color .12s;white-space:nowrap;}
.dshm-libtabs-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dshm-libtabs-on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);font-weight:600;}
.dshm-libtabs-count{font-size:10.5px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 6px;line-height:16px;}
.dshm-favs{padding:10px 20px 2px;width:100%;max-width:1120px;margin:0 auto;flex:none;box-sizing:border-box;}
.dshm-favs-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.dshm-favs-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-favs-all{margin-left:auto;}
.dshm-favs-empty{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);padding:10px 12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;}
.dshm-favs-rail{display:flex;gap:10px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:thin;}
.dshm-favcard{appearance:none;border:0;background:transparent;padding:0;width:104px;flex:none;display:flex;flex-direction:column;gap:6px;cursor:pointer;text-align:left;color:inherit;font:inherit;}
.dshm-favcard-cover{position:relative;display:block;width:104px;height:104px;border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);}
.dshm-favcard-heart{position:absolute;top:6px;right:6px;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);}
.dshm-favcard-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-favcard-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-favcard:hover .dshm-favcard-cover{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-favcard-off{opacity:.5;cursor:not-allowed;}
.dshm-favcard-more{height:104px;justify-content:center;align-items:center;gap:6px;border-radius:12px;border:1px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);}
.dshm-favcard-more-label{font-size:11.5px;}
.dshm-toast{position:fixed;right:20px;bottom:96px;z-index:1000;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 6px 20px var(--dsw-alias-border-l2);font-size:12.5px;color:var(--dsw-alias-label-primary);animation:dshm-fade-in .18s ease-out;}
.dshm-toast-icon{display:inline-flex;color:var(--dsw-alias-state-success-primary);}
.dshm-toast-main{appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-text);font:inherit;cursor:pointer;padding:2px 4px;border-radius:6px;}
.dshm-toast-main:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-toast-x{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:4px;border-radius:6px;display:inline-flex;}
.dshm-search{display:flex;align-items:center;gap:8px;flex:1;min-width:180px;max-width:340px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;color:var(--dsw-alias-label-tertiary);transition:border-color .15s;}
.dshm-search:focus-within{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-secondary);}
.dshm-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;outline:none;}
.dshm-search input::placeholder{color:var(--dsw-alias-label-tertiary);}
.dshm-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;border-radius:9px;padding:6px 26px 6px 10px;cursor:pointer;outline:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 14px) 55%,calc(100% - 9px) 55%;background-size:5px 5px;background-repeat:no-repeat;}
.dshm-select:focus-visible{border-color:var(--dsw-alias-brand-primary);}
.dshm-chipbtn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;border-radius:9px;padding:6px 12px;cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .1s;}
.dshm-chipbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dshm-chipbtn:active:not(:disabled){transform:scale(.97);}
.dshm-chipbtn:disabled{opacity:.5;cursor:default;}
.dshm-chipbtn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted);}
.dshm-chipbtn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted);}
.dshm-list{flex:1;min-height:0;overflow-y:auto;padding:6px 16px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:1120px;margin:0 auto;}
.dshm-list::-webkit-scrollbar{width:10px;}
.dshm-list::-webkit-scrollbar-track{background:transparent;}
.dshm-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:6px;border:2px solid var(--dsw-alias-bg-base);}
.dshm-list::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2);}
.dshm-group-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;padding:10px 8px 6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;}
.dshm-group-head .dshm-group-count{color:var(--dsw-alias-label-tertiary);font-weight:400;}
.dshm-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto auto auto 26px;align-items:center;gap:12px;padding:7px 8px;border-radius:10px;cursor:pointer;transition:background .12s;outline:none;}
.dshm-row-actions{display:flex;gap:2px;opacity:0;}
.dshm-row:hover .dshm-row-actions,.dshm-row:focus-within .dshm-row-actions{opacity:1;}
.dshm-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-row:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}
.dshm-row-current{background:var(--dsw-alias-interactive-bg-active);}
.dshm-row-current .dshm-row-title{color:var(--dsw-alias-brand-text);}
.dshm-row-info{min-width:0;}
.dshm-row-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:520;color:var(--dsw-alias-label-primary);}
.dshm-row-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}
.dshm-row-dur{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}
.dshm-row-play{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);opacity:0;transition:opacity .12s;}
.dshm-row:hover .dshm-row-play,.dshm-row:focus-visible .dshm-row-play{opacity:1;}
.dshm-row-current .dshm-row-play{opacity:0;}
.dshm-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.dshm-cover{flex:none;position:relative;border-radius:8px;overflow:hidden;background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-3));display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);}
.dshm-cover img{width:100%;height:100%;object-fit:cover;display:block;}
.dshm-cover-fallback{color:var(--dsw-alias-label-tertiary);display:flex;}
.dshm-eq{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex:none;}
.dshm-eq i{width:3px;border-radius:1.5px;background:var(--dsw-alias-brand-primary);height:30%;}
.dshm-eq-on i{animation:dshm-eq 1s ease-in-out infinite;}
.dshm-eq-on i:nth-child(2){animation-delay:.25s;}
.dshm-eq-on i:nth-child(3){animation-delay:.5s;}
@keyframes dshm-eq{0%,100%{height:25%;}50%{height:100%;}}
@keyframes dshm-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.dshm-iconbtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .13s,color .13s,transform .1s;flex:none;padding:0;}
.dshm-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dshm-iconbtn:active:not(:disabled){transform:scale(.92);}
.dshm-iconbtn:disabled{opacity:.4;cursor:default;}
.dshm-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-iconbtn-active{color:var(--dsw-alias-brand-text);}
.dshm-iconbtn-active:hover:not(:disabled){color:var(--dsw-alias-brand-text);}
.dshm-spin{animation:dshm-spin 1s linear infinite;}
@keyframes dshm-spin{to{transform:rotate(360deg);}}
.dshm-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 24px;text-align:center;color:var(--dsw-alias-label-secondary);min-height:0;}
.dshm-state-icon{color:var(--dsw-alias-label-tertiary);width:64px;height:64px;border-radius:18px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;margin-bottom:4px;}
.dshm-state-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-empty-ctas{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px;}
.dshm-empty-dirs{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;max-width:440px;margin:14px auto 0;padding:12px 14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dshm-empty-dirs-head{line-height:1.5;}
.dshm-empty-dir{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;}
.dshm-chipbtn-off{opacity:.55;}
.dshm-state-body{font-size:12.5px;line-height:1.7;max-width:420px;color:var(--dsw-alias-label-tertiary);}
.dshm-state-error{color:var(--dsw-alias-state-error-primary);}
.dshm-skel{padding:8px 16px;}
.dshm-skel-row{display:flex;gap:12px;align-items:center;padding:8px;}
.dshm-skel-box{border-radius:8px;background:var(--dsw-alias-bg-skeleton);animation:dshm-pulse 1.4s ease-in-out infinite;}
.dshm-now{flex:1;min-height:0;overflow-y:auto;padding:18px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:980px;margin:0 auto;}
.dshm-now::-webkit-scrollbar{width:10px;}
.dshm-now::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:6px;border:2px solid var(--dsw-alias-bg-base);}
.dshm-now-hero{display:grid;grid-template-columns:240px minmax(0,1fr);gap:28px;align-items:center;max-width:860px;margin:0 auto;}
.dshm-now-cover{width:240px;height:240px;border-radius:16px;box-shadow:0 12px 32px var(--dsw-alias-bg-mask-2);}
.dshm-now-meta{min-width:0;display:flex;flex-direction:column;gap:10px;}
.dshm-now-title{font-size:20px;font-weight:680;margin:0;line-height:1.3;}
.dshm-now-sub{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0;}
.dshm-source-chip{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);padding:3px 9px;border-radius:99px;}
.dshm-seekrow{display:flex;align-items:center;gap:10px;margin-top:6px;}
.dshm-time{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;min-width:38px;}
.dshm-time-end{text-align:right;}
.dshm-slider{position:relative;flex:1;height:20px;display:flex;align-items:center;cursor:pointer;touch-action:none;outline:none;min-width:40px;}
.dshm-slider-track{position:relative;width:100%;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:visible;}
.dshm-slider-fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--dsw-alias-brand-primary);}
.dshm-slider-thumb{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-brand-primary);transform:translate(-50%,-50%) scale(0);transition:transform .12s;box-shadow:0 1px 4px var(--dsw-alias-bg-mask-2);}
.dshm-slider:hover .dshm-slider-thumb,.dshm-slider:focus-visible .dshm-slider-thumb,.dshm-slider-drag .dshm-slider-thumb{transform:translate(-50%,-50%) scale(1);}
.dshm-slider:focus-visible .dshm-slider-track{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}
.dshm-slider-disabled{opacity:.4;cursor:default;}
.dshm-transport{display:flex;align-items:center;gap:10px;margin-top:4px;}
.dshm-playbtn{width:48px;height:48px;border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,transform .12s;box-shadow:0 4px 14px var(--dsw-alias-bg-mask-2);flex:none;padding:0;}
.dshm-playbtn:hover{background:var(--dsw-alias-button-primary-hover);transform:scale(1.05);}
.dshm-playbtn:active{transform:scale(.96);}
.dshm-playbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.dshm-volumerow{display:flex;align-items:center;gap:8px;max-width:240px;}
.dshm-volumerow .dshm-slider{flex:1;}
.dshm-volume-pct{font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:32px;font-variant-numeric:tabular-nums;}
.dshm-errorline{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-state-error-primary);font-size:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 12px;}
.dshm-queue{max-width:860px;margin:28px auto 0;}
.dshm-queue-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 8px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:6px;}
.dshm-queue-head .dshm-count{font-weight:400;}
@container (max-width:680px){
  .dshm-now-hero{grid-template-columns:1fr;justify-items:center;text-align:center;gap:18px;}
  .dshm-now-cover{width:190px;height:190px;}
  .dshm-now-meta{align-items:center;width:100%;}
  .dshm-source-chip{align-self:center;}
  .dshm-transport{justify-content:center;}
  .dshm-volumerow{margin:0 auto;}
}
.dshm-mini{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:min(380px,calc(100% - 32px));background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 10px 30px var(--dsw-alias-bg-mask-2);overflow:hidden;animation:dshm-mini-in .22s ease-out;}
.dshm-mini-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:48px;height:48px;border-radius:50%;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 30px var(--dsw-alias-bg-mask-2);cursor:grab;touch-action:none;animation:dshm-mini-in .18s ease-out;}
.dshm-mini-fab:hover{box-shadow:0 12px 34px var(--dsw-alias-bg-mask-2);}
.dshm-mini-fab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.dshm-mini-fab-dragging{cursor:grabbing;animation:none;box-shadow:0 16px 40px var(--dsw-alias-bg-mask-2);}
.dshm-mini-fab-badge{position:absolute;right:1px;bottom:1px;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border:2px solid var(--dsw-alias-bg-layer-1);pointer-events:none;}
.dshm-mini-dragging{box-shadow:0 16px 40px var(--dsw-alias-bg-mask-2);transition:none;animation:none;}
@keyframes dshm-mini-in{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
.dshm-mini-inner{display:flex;align-items:center;gap:6px;padding:8px 10px 8px 20px;}
.dshm-mini-main{display:flex;align-items:center;gap:10px;flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:2px;border-radius:9px;text-align:left;}
.dshm-mini-main:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-mini-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-mini-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
.dshm-mini-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-mini-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-mini-sub-error{color:var(--dsw-alias-state-error-primary);}
.dshm-mini-grip{position:absolute;left:3px;top:50%;transform:translateY(-50%);width:14px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:grab;border-radius:6px;touch-action:none;opacity:.6;}
.dshm-mini-grip:hover,.dshm-mini-grip:focus-visible{opacity:1;background:var(--dsw-alias-interactive-bg-hover);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-mini-grip:active{cursor:grabbing;}
.dshm-mini-artist{display:inline-flex;align-items:center;gap:4px;max-width:100%;border:0;background:transparent;padding:0;margin:0;font:inherit;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);cursor:pointer;text-align:left;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshm-mini-artist:hover{color:var(--dsw-alias-brand-text);text-decoration:underline;}
.dshm-mini-artist:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-mini-seek{padding:0 12px 0 20px;}
.dshm-mini-seek .dshm-slider{height:16px;}
.dshm-mini-lyrics{display:flex;flex-direction:column;gap:1px;padding:2px 14px 8px 20px;overflow:hidden;}
.dshm-mini-lyric{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.5;transition:opacity .25s ease,color .25s ease;}
.dshm-mini-lyric-on{color:var(--dsw-alias-label-primary);opacity:1;font-weight:600;}
.dshm-mode-cycle{min-width:32px;}
.dshm-chipbtn.dshm-mode-cycle{padding:0 9px;}
.dshm-mini-controls{display:flex;align-items:center;gap:2px;flex:none;}
.dshm-mini-play{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-radius:50%;width:34px;height:34px;}
.dshm-mini-play:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted);}
.dshm-reco{max-width:560px;margin:0 auto;}
.dshm-reco-tags{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:6px;}
.dshm-reco-tag{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:99px;padding:4px 10px;}
.dshm-reco-page{flex:1;min-height:0;overflow-y:auto;padding:12px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:1280px;margin:0 auto;}
.dshm-reco-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:14px;}
.dshm-reco-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,box-shadow .15s;}
.dshm-reco-card:hover{border-color:var(--dsw-alias-border-l3);box-shadow:0 2px 10px var(--dsw-alias-bg-mask-2);}
.dshm-reco-card-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.dshm-cat-chip{font-size:11px;padding:2px 9px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}
.dshm-cat-explore{color:var(--dsw-alias-brand-text);border-color:var(--dsw-alias-brand-primary);}
.dshm-axis-chip{font-size:11px;padding:2px 9px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);}
.dshm-reco-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-reco-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);}
.dshm-reco-reason{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);}
.dshm-reco-foot{margin-top:auto;display:flex;align-items:center;gap:8px;padding-top:4px;}
.dshm-dl{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;}
.dshm-dl-row{display:flex;align-items:center;gap:8px;font-size:12.5px;min-width:0;}
.dshm-dl-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none;}
.dshm-dl-ok{background:var(--dsw-alias-state-success-primary);}
.dshm-dl-fail{background:var(--dsw-alias-state-error-primary);}
.dshm-dl-status{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;}
.dshm-dl-bar{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;margin:2px 0 4px;}
.dshm-dl-bar>div{height:100%;background:var(--dsw-alias-brand-primary);transition:width .4s ease;}
.dshm-sync{margin:12px 24px 0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:10px;}
.dshm-sync-chips{display:flex;gap:8px;flex-wrap:wrap;}
.dshm-sync-chip{font-size:11.5px;border:1px solid var(--dsw-alias-border-l1);border-radius:99px;padding:4px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);}
.dshm-sync-detail{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.7;}
.dshm-hrow{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto auto;gap:10px;align-items:center;padding:6px 8px;border-radius:10px;}
.dshm-hrow-click{cursor:pointer;}
.dshm-hrow-click:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-hrow-click:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-row-sub-btn{appearance:none;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left;font-family:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary);max-width:100%;overflow:hidden;display:inline-flex;align-items:center;gap:4px;vertical-align:middle;}
.dshm-row-sub-btn:hover{color:var(--dsw-alias-brand-text);text-decoration:underline;text-underline-offset:3px;}
.dshm-hrow:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-hbar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;}
.dshm-hbar>div{height:100%;background:var(--dsw-alias-brand-primary);}
.dshm-hskip{font-size:10.5px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:99px;padding:1px 8px;flex:none;}
.dshm-htime{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;}
.dshm-hlist{max-width:960px;margin:0 auto;padding:10px 8px 20px;}
.dshm-explore-chip{flex:none;font-size:11px;font-weight:600;padding:1px 6px;border-radius:99px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);}
.dshm-explore-note{display:flex;align-items:flex-start;gap:7px;margin:10px 18px 0;padding:8px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;}
.dshm-columns{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;}
.dshm-column{min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);}
.dshm-column:last-child{border-right:0;}
.dshm-col-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px 8px;}
.dshm-col-title{font-size:13.5px;font-weight:680;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;}
.dshm-col-count{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-col-play{margin-left:0;}
.dshm-col-actions{display:flex;align-items:center;gap:6px;margin-left:auto;}
.dshm-col-refresh{width:26px;height:26px;padding:0;justify-content:center;color:var(--dsw-alias-label-secondary);}
.dshm-col-refresh:hover{color:var(--dsw-alias-label-primary);}
.dshm-col-loading{display:flex;align-items:center;gap:6px;padding:0 14px 6px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dshm-refresh-note{color:var(--dsw-alias-label-secondary);}
.dshm-playround-busy{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);opacity:.7;}
.dshm-playround .dshm-spin,.dshm-col-refresh .dshm-spin,.dshm-col-loading .dshm-spin,.dshm-row-play .dshm-spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;box-sizing:border-box;}
.dshm-col-list{flex:1;min-height:0;overflow-y:auto;padding:2px 8px 16px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.dshm-srow{display:grid;grid-template-columns:38px minmax(0,1fr) auto auto auto;align-items:center;gap:10px;padding:6px;border-radius:10px;transition:background .12s;}
.dshm-srow:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-srow-main{min-width:0;display:flex;flex-direction:column;gap:1px;border:0;background:transparent;font:inherit;color:inherit;text-align:left;padding:0;cursor:pointer;}
.dshm-srow-title{font-size:12.5px;font-weight:560;color:var(--dsw-alias-label-primary);}
.dshm-srow-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-srow-artist{appearance:none;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;border-radius:4px;}
.dshm-srow-artist:hover{color:var(--dsw-alias-brand-text);text-decoration:underline;text-underline-offset:3px;}
.dshm-srow-artist:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-srow-reason{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.dshm-like-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none;transition:transform .12s,color .12s;}
.dshm-like-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);}
.dshm-like-btn:active{transform:scale(1.18);}
.dshm-like-btn-on{color:var(--dsw-alias-state-error-primary);}
.dshm-row-off{opacity:.55;cursor:not-allowed;}
.dshm-row-off:hover{background:transparent;}
.dshm-dislike-btn-on{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);}
.dshm-dislikes{margin-top:14px;}
.dshm-dislike-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:9px;font-size:12.5px;color:var(--dsw-alias-label-secondary);}
.dshm-dislike-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-dislike-undo{flex:none;}
.dshm-playround{appearance:none;border:0;width:30px;height:30px;border-radius:50%;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none;transition:background .13s,transform .1s;}
.dshm-playround:hover{background:var(--dsw-alias-button-primary-hover);transform:scale(1.06);}
.dshm-playround:disabled{opacity:.45;cursor:default;transform:none;}
.dshm-tile{border-radius:8px;overflow:hidden;background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-3));border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);flex:none;}
.dshm-tile img{width:100%;height:100%;object-fit:cover;display:block;}
.dshm-arow{display:grid;grid-template-columns:44px minmax(0,1fr) 18px;align-items:center;gap:10px;width:100%;padding:6px;border:0;background:transparent;font:inherit;color:inherit;text-align:left;border-radius:10px;cursor:pointer;transition:background .12s;}
.dshm-arow:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-arow-text{display:flex;flex-direction:column;gap:1px;min-width:0;}
.dshm-arow-arrow{color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;}
.dshm-apage-banner{position:relative;height:132px;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-module-platform));margin-bottom:-38px;display:flex;align-items:center;justify-content:flex-end;padding:0 14px;color:var(--dsw-alias-label-tertiary);}
.dshm-apage-banner img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.85;}
.dshm-apage-banner-mask{position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,var(--dsw-alias-bg-base));}
.dshm-apage-hero{position:relative;display:flex;align-items:flex-end;gap:16px;margin-bottom:16px;padding:0 8px;}
.dshm-apage-ava-wrap{width:96px;height:96px;border-radius:50%;border:2px solid var(--dsw-alias-bg-base);box-shadow:0 6px 18px var(--dsw-alias-bg-mask-2);overflow:hidden;flex:none;background:var(--dsw-alias-bg-module-platform);}
.dshm-apage-ava-wrap .dshm-tile{width:100%!important;height:100%!important;border:0;border-radius:0;}
.dshm-agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;padding:4px 6px;}
.dshm-artcard{appearance:none;border:0;background:transparent;font:inherit;color:inherit;display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 6px;border-radius:12px;cursor:pointer;transition:background .13s;}
.dshm-artcard:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-artcard:hover .dshm-artava{box-shadow:0 4px 14px var(--dsw-alias-bg-mask-2);}
.dshm-artava{width:62px;height:62px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:var(--dsw-alias-label-secondary);transition:box-shadow .15s;}
.dshm-artname{font-size:12px;font-weight:600;text-align:center;max-width:100%;}
.dshm-arthint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);text-align:center;line-height:1.45;}
.dshm-mode-group{display:inline-flex;align-items:center;gap:2px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:99px;padding:2px;}
.dshm-mode-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);width:30px;height:28px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}
.dshm-mode-btn:hover{color:var(--dsw-alias-label-primary);}
.dshm-mode-btn-on{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);}
.dshm-mode-btn-on:hover{color:var(--dsw-alias-label-primary-inverted);}
.dshm-mode-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:6px;}
.dshm-apage{flex:1;min-height:0;overflow-y:auto;padding:16px 20px 28px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:1120px;margin:0 auto;}
.dshm-apage-hero{display:flex;align-items:center;gap:16px;margin-bottom:16px;}
.dshm-apage-ava{width:76px;height:76px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--dsw-alias-label-secondary);flex:none;}
.dshm-apage-name{font-size:20px;font-weight:700;margin:0;}
@media (max-width:980px){
  .dshm-columns{grid-template-columns:1fr;}
  .dshm-toolbar{padding:10px 12px;}
  .dshm-header{padding:12px 12px 0;}
  .dshm-reco-page{padding:10px 12px;}
  .dshm-apage{padding:14px 12px 24px;}
  .dshm-now{padding:14px 12px;}
  .dshm-column{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:46vh;}
}
.dshm-history-page{width:100%;max-width:960px;margin:0 auto;padding:12px 8px 24px;}
.dshm-stats-wrap{display:flex;flex-direction:column;gap:12px;margin-bottom:8px;}
.dshm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;}
.dshm-stat{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;min-width:0;}
.dshm-stat-value{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary);}
.dshm-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}
.dshm-trend{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;}
.dshm-bars{display:flex;align-items:flex-end;gap:6px;height:88px;}
.dshm-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%;min-width:0;}
.dshm-bar{width:100%;max-width:34px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--dsw-alias-brand-primary),var(--dsw-alias-bg-layer-3));min-height:3px;}
.dshm-bar-label{font-size:10px;color:var(--dsw-alias-label-tertiary);}
.dshm-tops{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.dshm-top-col{display:flex;flex-direction:column;gap:2px;min-width:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;}
.dshm-top-row{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:8px;font-size:12px;min-width:0;}
.dshm-top-row-click{cursor:pointer;}
.dshm-top-row-click:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-top-row-click:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-top-row-artist{appearance:none;border:0;background:transparent;font:inherit;color:inherit;text-align:left;width:100%;cursor:pointer;}
.dshm-top-row-artist:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-top-row-off{opacity:.55;cursor:not-allowed;}
.dshm-top-row-off:hover{background:transparent;}
.dshm-top-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-top-rank{width:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;flex:none;}
.dshm-hgroup{margin-top:10px;}
.dshm-hgroup-label{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--dsw-alias-bg-base);font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}
.dshm-hbadge{font-size:10.5px;border-radius:99px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);flex:none;font-variant-numeric:tabular-nums;}
.dshm-hbadge-good{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.dshm-hbadge-mid{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}
.dshm-hbadge-low{color:var(--dsw-alias-label-tertiary);}
@media (max-width:680px){
  .dshm-tops{grid-template-columns:1fr;}
  .dshm-hrow{grid-template-columns:40px minmax(0,1fr) auto;}
  .dshm-hskip,.dshm-htime{display:none;}
}
.dshm-state-spin{animation:dshm-spin 1.4s linear infinite;}
.dshm-toolbar-flat{margin:0;padding:8px 0;border-bottom:0;}
@media (max-width:560px){
  .dshm-hrow{grid-template-columns:40px minmax(0,1fr) auto;}
  .dshm-hbar,.dshm-hskip,.dshm-htime{display:none;}
  .dshm-sync{margin:12px 12px 0;}
  .dshm-reco-page{padding:16px 12px;}
}
.dshm-lyrics{max-width:860px;margin:24px auto 0;display:flex;flex-direction:column;gap:8px;}
.dshm-lyrics-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 8px;}
.dshm-lyrics-scroll{position:relative;max-height:300px;overflow-y:auto;padding:4px 8px;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.dshm-lyric-line{padding:5px 10px;border-radius:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6;transition:color .2s,background .2s;}
.dshm-lyric-line-past{color:var(--dsw-alias-label-secondary);}
.dshm-lyric-line-active{color:var(--dsw-alias-label-primary);font-weight:600;background:var(--dsw-alias-interactive-bg-hover);}
.dshm-plain-lyrics{white-space:pre-wrap;color:var(--dsw-alias-label-secondary);line-height:1.8;padding:6px 10px;font-size:13px;}
.dshm-lyrics-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:6px 10px;}
.dshm-drawer-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);z-index:5;}
.dshm-drawer{position:absolute;top:0;right:0;bottom:0;width:min(430px,92%);background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-12px 0 32px var(--dsw-alias-bg-mask-2);z-index:6;display:flex;flex-direction:column;animation:dshm-drawer-in .2s ease-out;}
@keyframes dshm-drawer-in{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}
.dshm-drawer-head{flex:none;display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dshm-drawer-name{font-size:15px;font-weight:650;margin:0;min-width:0;}
.dshm-drawer-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.dshm-asec{display:flex;flex-direction:column;gap:8px;}
.dshm-asec-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;}
.dshm-acard{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;}
.dshm-acard-text{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);word-break:break-word;}
.dshm-acard-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dshm-acard-meta a{color:var(--dsw-alias-link);text-decoration:none;}
.dshm-acard-meta a:hover{text-decoration:underline;}
.dshm-kind-chip{font-size:10px;padding:1px 8px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}
.dshm-sim{display:flex;flex-direction:column;gap:6px;}
.dshm-sim-chip{display:inline-flex;align-items:center;gap:5px;display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:7px 12px;font-size:12.5px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;font:inherit;}
.dshm-sim-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-sim-chip-reason{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-artist-btn{appearance:none;background:none;border:0;color:inherit;font:inherit;padding:0;cursor:pointer;text-align:left;display:inline-flex;align-items:center;gap:5px;max-width:100%;vertical-align:middle;}
.dshm-artist-btn:hover{text-decoration:underline;text-underline-offset:3px;}
@media (prefers-reduced-motion:reduce){
  .dshm-eq-on i,.dshm-tab-dot,.dshm-skel-box,.dshm-spin,.dshm-state-spin,.dshm-mini,.dshm-mini-fab,.dshm-drawer,.dshm-welcome,.dshm-welcome-fish{animation:none;}
  .dshm-mini{animation:none;}
  .dshm-row,.dshm-iconbtn,.dshm-chipbtn,.dshm-playbtn,.dshm-slider-thumb,.dshm-mini-progress>div,.dshm-reco-card,.dshm-dl-bar>div,.dshm-like-btn,.dshm-playround,.dshm-artcard,.dshm-mode-btn{transition:none;}
}
/* Music Console. Tokens are scoped to the music surface; the host UI keeps its theme. */
.dshm-console,.dshm-console-welcome{
  color-scheme:dark;
  --dsw-alias-bg-base:#0e131a;--dsw-alias-bg-layer-1:#151c26;--dsw-alias-bg-layer-2:#1b2532;--dsw-alias-bg-layer-3:#223044;
  --dsw-alias-border-l1:#263241;--dsw-alias-border-l2:#334257;--dsw-alias-border-l3:#4a607b;
  --dsw-alias-label-primary:#f1f5fa;--dsw-alias-label-secondary:#b0becf;--dsw-alias-label-tertiary:#93a3b8;--dsw-alias-label-primary-inverted:#091522;
  --dsw-alias-brand-primary:#5daaff;--dsw-alias-brand-text:#83beff;--dsw-alias-button-primary-fill:#64acff;--dsw-alias-button-primary-hover:#86bfff;
  --dsw-alias-interactive-bg-hover:#202b3a;--dsw-alias-interactive-bg-active:#20344b;--dsw-alias-bg-mask-2:#070b1199;
  --dsw-alias-scrollbar-bg-l2:#34435a;--dsw-alias-scrollbar-hover-l2:#59718d;--dsw-alias-bg-skeleton:#1b2532;
  --dsw-alias-state-error-primary:#ff8d9a;--dsw-alias-state-success-primary:#62dfac;--dsw-alias-state-warn-primary:#f5bf6a;
  font-family:Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;
}
.dshm-console{container:dshm-shell / inline-size;}
.dshm-console .dshm-header{display:flex;align-items:stretch;gap:22px;padding:0 22px;background:#111821;min-height:58px;}
.dshm-console .dshm-title-row{margin:0;gap:8px;white-space:nowrap;}
.dshm-console .dshm-title{font-size:15px;letter-spacing:.05em;}
.dshm-console .dshm-tabs{gap:0;overflow:auto;scrollbar-width:none;}
.dshm-console .dshm-tab{white-space:nowrap;padding:0 12px;border-radius:0;}
.dshm-console .dshm-tab[aria-current="page"]{color:var(--dsw-alias-brand-text);font-weight:600;}
.dshm-console .dshm-tab[aria-current="page"]::after{content:"";position:absolute;bottom:0;background:var(--dsw-alias-brand-primary);border-radius:2px;height:3px;left:12px;right:12px;}
.dshm-console .dshm-header-actions{min-width:0;flex:none;}
.dshm-console .dshm-now,.dshm-console .dshm-reco-page,.dshm-console .dshm-history,.dshm-console .dshm-list{max-width:1360px;}
.dshm-console .dshm-now{padding-top:28px;}
.dshm-console :focus-visible{outline:2px solid #78b7ff;outline-offset:2px;}
.dshm-signal{display:inline-flex;align-items:center;gap:3px;color:var(--dsw-alias-brand-primary);flex:none;}
.dshm-signal i{display:block;width:2px;border-radius:4px;height:var(--bar);background:currentColor;}
.dshm-terminal,.dshm-kicker,.dshm-key,.dshm-text-code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;}
.dshm-terminal{height:31px;font-size:12px;white-space:nowrap;}
.dshm-key{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);padding:2px 4px;border-radius:4px;color:var(--dsw-alias-label-tertiary);font-size:10px;}
.dshm-workspace{flex:1;min-height:0;overflow:auto;padding:24px clamp(14px,3.1cqw,48px) 28px;width:100%;max-width:1540px;margin:auto;scrollbar-width:thin;}
.dshm-console-hero{position:relative;overflow:hidden;padding:30px clamp(18px,3.5cqw,48px);border:1px solid var(--dsw-alias-border-l2);border-radius:15px;background:radial-gradient(ellipse at 90% 50%,#1b3760 0%,transparent 63%),linear-gradient(125deg,#141d29,#0e1725);isolation:isolate;}
.dshm-console-hero::after{content:"";position:absolute;z-index:-1;inset:0;background-image:radial-gradient(#8baee3 1px,transparent 1px);background-size:13px 13px;mask-image:linear-gradient(90deg,transparent 45%,#000);opacity:.16;pointer-events:none;}
.dshm-console-hero .dshm-signal{position:absolute;right:5%;top:50%;transform:translateY(-50%);z-index:-1;gap:6px;opacity:.53;filter:drop-shadow(0 0 15px #438dff);}
.dshm-console-hero .dshm-signal i{width:3px;background:linear-gradient(#79bfff,#5183e5,#7956e4);}
.dshm-kicker{color:#86bcfb;font-size:11px;letter-spacing:.12em;text-transform:uppercase;}
.dshm-console-h1{font-size:clamp(25px,4.2cqw,52px);line-height:1.08;margin:13px 0 10px;letter-spacing:-.045em;}
.dshm-console-copy{margin:0 0 19px;color:var(--dsw-alias-label-secondary);line-height:1.6;font-size:14px;}
.dshm-console-title{font-size:24px;line-height:1.25;margin:8px 0 6px;}
.dshm-console-section-title{font-size:15px;margin:0;}
.dshm-console-btn{min-height:34px;justify-content:center;white-space:nowrap;}
.dshm-feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,142px),1fr));gap:10px;margin:14px 0 20px;}
.dshm-feature{appearance:none;width:100%;min-width:0;text-align:left;font:inherit;color:inherit;padding:13px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:linear-gradient(140deg,#19222e,#131a24);cursor:pointer;display:grid;gap:6px;align-content:start;}
.dshm-feature:hover,.dshm-feature[aria-pressed="true"]{border-color:#599cee;background:#1b2a3e;}
.dshm-feature svg,.dshm-command-form > svg{color:#83beff;}
.dshm-feature small,.dshm-console-muted{color:var(--dsw-alias-label-tertiary);line-height:1.45;}
.dshm-console-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(225px,285px);gap:18px;align-items:start;}
.dshm-console-grid > *{min-width:0;}
.dshm-console-grid .dshm-feature-grid{grid-template-columns:repeat(5,minmax(0,1fr));}
.dshm-console-grid .dshm-feature{padding:11px;overflow-wrap:anywhere;}
@container dshm-shell (max-width:1000px){
  .dshm-console-grid .dshm-feature-grid{grid-template-columns:repeat(3,minmax(0,1fr));}
}
@container dshm-shell (max-width:460px){
  .dshm-console-grid .dshm-feature-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
}
.dshm-console-card{background:linear-gradient(165deg,#171f2a,#131a23);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:15px;min-width:0;}
.dshm-console-card + .dshm-console-card{margin-top:12px;}
.dshm-console-card h3{font-size:14px;margin:0 0 11px;}
.dshm-command-form{display:flex;align-items:center;gap:9px;border:1px solid #426790;border-radius:10px;background:#1a2534;padding:7px 8px 7px 12px;min-height:48px;}
.dshm-command-form:focus-within{border-color:#65acff;}
.dshm-command-form input{font:inherit;color:inherit;border:0;background:transparent;flex:1;min-width:0;outline:none;}
.dshm-command-form input:focus-visible{outline:none;}
.dshm-command-form input::placeholder{color:var(--dsw-alias-label-tertiary);}
.dshm-console-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:11px 0;}
.dshm-prompt-chip{font-size:11px;padding:5px 8px;}
.dshm-console-result{margin-top:14px;}
.dshm-console-model{display:flex;gap:7px;align-items:center;margin-top:9px;color:var(--dsw-alias-label-secondary);}
.dshm-console-model input{accent-color:var(--dsw-alias-brand-primary);}
.dshm-feature:disabled{opacity:.6;cursor:default;}
.dshm-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.dshm-result-head h3{margin:0 0 4px;}
.dshm-result-head .dshm-console-actions{margin:0;}
.dshm-console-result p{margin:10px 0;color:var(--dsw-alias-label-secondary);line-height:1.55;}
.dshm-console-result p[role="alert"]{color:var(--dsw-alias-state-error-primary);}
.dshm-console-rows{display:grid;gap:3px;max-height:390px;overflow:auto;margin-top:10px;}
.dshm-console-track{appearance:none;background:transparent;color:inherit;font:inherit;text-align:left;display:grid;grid-template-columns:22px 32px minmax(0,1fr) auto;align-items:center;gap:8px;border:0;border-top:1px solid var(--dsw-alias-border-l1);padding:5px;border-radius:4px;cursor:pointer;width:100%;}
.dshm-console-track:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-console-track small{display:block;color:var(--dsw-alias-label-tertiary);margin-top:2px;}
.dshm-console-track span.dshm-text-code{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-console-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;}
.dshm-console-metric{padding:9px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;min-width:0;}
.dshm-console-metric strong{display:block;font-variant-numeric:tabular-nums;margin-bottom:4px;}
.dshm-console-metric small{font-size:10px;color:var(--dsw-alias-label-tertiary);}
.dshm-console-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.dshm-console-log{padding:0;margin:8px 0 0;list-style:none;display:grid;gap:7px;font-size:11px;overflow-wrap:anywhere;}
.dshm-console-log time{color:#86bcfb;margin-right:7px;}
.dshm-console-listline{display:flex;gap:5px;align-items:center;margin-top:4px;}
.dshm-console-listline > :first-child{flex:1;justify-content:flex-start;min-width:0;}
.dshm-console-dock{flex:none;display:grid;grid-template-columns:minmax(100px,1fr) auto minmax(120px,1.25fr) auto;align-items:center;gap:12px;padding:9px 12px;margin:0 12px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:linear-gradient(120deg,#19222e,#141c27);box-shadow:0 8px 26px #070b1144;min-height:66px;}
.dshm-dock-track{display:flex;align-items:center;gap:8px;min-width:0;}
.dshm-dock-track button{font:inherit;text-align:left;color:inherit;background:none;border:0;min-width:0;padding:4px;cursor:pointer;border-radius:6px;}
.dshm-dock-track small{display:block;color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:3px;}
.dshm-dock-controls,.dshm-dock-end,.dshm-dock-progress{display:flex;align-items:center;gap:5px;min-width:0;}
.dshm-dock-end .dshm-slider{width:58px;flex:none;}
.dshm-dock-progress .dshm-slider{flex:1;min-width:30px;}
.dshm-dock-progress span{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}
.dshm-command-layer{position:absolute;inset:0;z-index:25;background:#080d17bf;display:grid;align-content:start;justify-items:center;padding:clamp(18px,9vh,85px) 14px 14px;overflow:auto;}
.dshm-command-window{width:min(100%,580px);box-shadow:0 24px 90px #0009;}
.dshm-command-window > .dshm-result-head{align-items:center;margin-bottom:10px;}
.dshm-command-window .dshm-console-track{grid-template-columns:20px 1fr auto;}
@container dshm-shell (max-width:920px){
  .dshm-console .dshm-header{gap:10px;padding:0 12px;}
  .dshm-console .dshm-tab{padding:0 8px;}
  .dshm-console .dshm-count,.dshm-terminal .dshm-terminal-text{display:none;}
}
@container dshm-shell (max-width:700px){
  .dshm-console-grid{grid-template-columns:1fr;}
  .dshm-console .dshm-header{flex-wrap:wrap;gap:0;min-height:unset;}
  .dshm-console .dshm-title-row,.dshm-console .dshm-header-actions{min-height:44px;}
  .dshm-console .dshm-tabs{order:3;width:100%;height:37px;}
  .dshm-console-dock{grid-template-columns:minmax(80px,1fr) auto auto;gap:5px;}
  .dshm-dock-progress{grid-row:2;grid-column:1/-1;}
  .dshm-dock-end .dshm-slider,.dshm-dock-volume{display:none;}
}
@container dshm-shell (max-width:380px){
  .dshm-console .dshm-header .dshm-iconbtn{width:27px;}
  .dshm-console .dshm-tab{font-size:12px;}
  .dshm-console-dock{margin:0 6px 6px;padding:5px;}
  .dshm-console-dock .dshm-iconbtn{width:28px;}
}
`;
      function createHostApi(t) {
        function tasteQuery(taste) {
          if (!taste || typeof taste !== "object") return "";
          const genres = (taste.genres || []).filter(Boolean);
          const languages = (taste.languages || []).filter(Boolean);
          const parts = [];
          if (genres.length) parts.push("genres=" + encodeURIComponent(genres.join(",")));
          if (languages.length) parts.push("languages=" + encodeURIComponent(languages.join(",")));
          return parts.length ? "?" + parts.join("&") : "";
        }
        function tasteBody(taste) {
          if (!taste || typeof taste !== "object") return {};
          const genres = (taste.genres || []).filter(Boolean);
          const languages = (taste.languages || []).filter(Boolean);
          const body = {};
          if (genres.length) body.genres = genres;
          if (languages.length) body.languages = languages;
          return body;
        }
        async function request(path, options) {
          let res;
          try {
            res = await fetch(resolveUrl(path), options);
          } catch {
            throw new Error(t("networkError"));
          }
          if (!res.ok) {
            let message = "HTTP " + res.status;
            try {
              const body = await res.json();
              if (body && typeof body.error === "string") message = body.error;
            } catch {
            }
            throw new Error(message);
          }
          return res.json();
        }
        return {
          library: () => request("/dsh-music/api/library"),
          rescan: () => request("/dsh-music/api/rescan", { method: "POST" }),
          lyrics: (trackId) => request("/dsh-music/api/lyrics?track=" + encodeURIComponent(trackId)),
          artist: (name) => request("/dsh-music/api/artist?name=" + encodeURIComponent(name)),
          artistImage: (name) => request("/dsh-music/api/reco/artist-image?name=" + encodeURIComponent(name)),
          recoSections: (taste) => request("/dsh-music/api/reco/sections" + tasteQuery(taste)),
          recoSectionsRefresh: (axis, taste) => request("/dsh-music/api/reco/sections/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.assign({ axis }, tasteBody(taste)))
          }),
          deleteTrack: (trackId, confirm) => request("/dsh-music/api/library/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId, confirm: !!confirm })
          }),
          revealTrack: (trackId) => request("/dsh-music/api/library/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId })
          }),
          reco: (taste) => request("/dsh-music/api/reco" + tasteQuery(taste)),
          recoStatus: () => request("/dsh-music/api/reco/status"),
          download: (items) => request("/dsh-music/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items })
          }),
          downloadStatus: () => request("/dsh-music/api/download/status"),
          sync: () => request("/dsh-music/api/sync", { method: "POST" }),
          syncStatus: () => request("/dsh-music/api/sync/status"),
          syncAvailability: () => request("/dsh-music/api/sync/availability"),
          history: (limit) => request("/dsh-music/api/history?limit=" + (limit || 50)),
          historyStats: () => request("/dsh-music/api/history/stats"),
          curationAvailability: (signal) => request("/dsh-music/api/curation/interpret", { signal }),
          interpretCuration: (prompt, signal) => request("/dsh-music/api/curation/interpret", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
            signal
          }),
          onboardingState: () => request("/dsh-music/api/onboarding/state"),
          onboardingComplete: (payload) => request("/dsh-music/api/onboarding/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {})
          }),
          librarySearch: (q, type) => request("/dsh-music/api/library/search?q=" + encodeURIComponent(q) + "&type=" + (type || "song")),
          recoStyle: (q) => request("/dsh-music/api/reco/style?q=" + encodeURIComponent(q)),
          recoArtist: (name) => request("/dsh-music/api/reco/artist?name=" + encodeURIComponent(name)),
          playback: (patch) => request("/dsh-music/api/playback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch)
          }),
          playbackNext: (trackId) => request("/dsh-music/api/playback/next?trackId=" + encodeURIComponent(trackId || "")),
          like: (body) => request("/dsh-music/api/library/like", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }),
          likes: () => request("/dsh-music/api/library/likes"),
          dislike: (body) => request("/dsh-music/api/library/dislike", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }),
          dislikes: () => request("/dsh-music/api/library/dislikes"),
          taste: (trackId, artist, title) => request("/dsh-music/api/library/taste" + (trackId ? "?trackId=" + encodeURIComponent(trackId) : "?artist=" + encodeURIComponent(artist || "") + "&title=" + encodeURIComponent(title || ""))),
          preview: (body) => request("/dsh-music/api/library/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }),
          previewStatus: () => request("/dsh-music/api/library/preview/status")
        };
      }
      function createLibrary(api) {
        const store = createStore({ status: "idle", tracks: [], error: null, scannedAt: 0 });
        let inflight = false;
        async function load(rescan) {
          if (inflight) return;
          inflight = true;
          store.set({ status: "loading", error: null });
          try {
            const data = rescan ? await api.rescan() : await api.library();
            const tracks = Array.isArray(data && data.tracks) ? data.tracks : [];
            store.set({ status: "ready", tracks, error: null, scannedAt: data && data.scannedAt || Date.now() });
          } catch (err) {
            store.set({ status: "error", error: err && err.message || String(err) });
          } finally {
            inflight = false;
          }
        }
        async function remove(trackId, confirm) {
          await api.deleteTrack(trackId, confirm);
          await load(false);
        }
        return {
          source: store,
          load: () => load(false),
          rescan: () => load(true),
          remove,
          reveal: (trackId) => api.revealTrack(trackId),
          /* 统一搜索：song+artist 两个口径并行，合并去重并打类型标签。 */
          searchRemote: async (q) => {
            const [song, artist] = await Promise.all([
              api.librarySearch(q, "song").catch(() => ({ local: [], remote: [] })),
              api.librarySearch(q, "artist").catch(() => ({ local: [], remote: [] }))
            ]);
            const localMap = /* @__PURE__ */ new Map();
            for (const tr of [...song && song.local || [], ...artist && artist.local || []]) {
              if (tr && tr.id && !localMap.has(tr.id)) localMap.set(tr.id, tr);
            }
            const remoteMap = /* @__PURE__ */ new Map();
            for (const r of song && song.remote || []) {
              const k = "song::" + normalizeZh(r && r.artist) + "::" + normalizeZh(r && r.title);
              if (!remoteMap.has(k)) remoteMap.set(k, { ...r, kind: "song" });
            }
            for (const r of artist && artist.remote || []) {
              const k = "artist::" + normalizeZh(r && (r.name || r.artist));
              if (!remoteMap.has(k)) remoteMap.set(k, { ...r, kind: "artist" });
            }
            return { local: [...localMap.values()], remote: [...remoteMap.values()] };
          }
        };
      }
      function createLyricsService(api) {
        const store = createStore({ trackId: null, status: "idle", data: null, error: null });
        let inflightFor = null;
        let revision = 0;
        async function load(trackId) {
          if (!trackId || inflightFor === trackId) return;
          const cur = store.getSnapshot();
          if (cur.trackId === trackId && (cur.status === "ready" || cur.status === "loading")) return;
          const request = ++revision;
          if (!isLibraryTrackId(trackId)) {
            inflightFor = null;
            store.set({ trackId, status: "ready", error: null, data: {
              source: "none",
              synced: false,
              lines: [],
              plain: "",
              message: String(trackId).startsWith("preview:") ? "\u8BD5\u542C\u66F2\u76EE\u6682\u4E0D\u63D0\u4F9B\u540C\u6B65\u6B4C\u8BCD\u3002\u52A0\u5165\u66F2\u5E93\u540E\u53EF\u91CD\u65B0\u83B7\u53D6\u3002" : "\u8FD9\u9996\u6B4C\u66F2\u6682\u65E0\u53EF\u7528\u6B4C\u8BCD\u3002"
            } });
            return;
          }
          inflightFor = trackId;
          store.set({ trackId, status: "loading", data: null, error: null });
          try {
            const data = await api.lyrics(trackId);
            if (request !== revision) return;
            store.set({ status: "ready", data });
          } catch (err) {
            if (request !== revision) return;
            store.set({ status: "error", error: err && err.message || String(err) });
          } finally {
            if (request === revision) inflightFor = null;
          }
        }
        return { source: store, load };
      }
      function createArtistService(api) {
        const store = createStore({ name: null, status: "idle", data: null, error: null });
        let inflightFor = null;
        async function load(name) {
          if (!name || inflightFor === name) return;
          inflightFor = name;
          store.set({ name, status: "loading", data: null, error: null });
          try {
            const data = await api.artist(name);
            if (store.getSnapshot().name !== name) return;
            store.set({ status: "ready", data });
          } catch (err) {
            if (store.getSnapshot().name !== name) return;
            store.set({ status: "error", error: err && err.message || String(err) });
          } finally {
            if (inflightFor === name) inflightFor = null;
          }
        }
        return { source: store, load };
      }
      function createArtistPageService(api) {
        const store = createStore({ pages: {}, loading: {}, lastReady: null, error: null });
        const pending = /* @__PURE__ */ new Map();
        const keyOf = (name) => normalizeZh(name || "").trim();
        function load(name) {
          if (!name) return Promise.resolve(null);
          const key = keyOf(name);
          const snap = store.getSnapshot();
          if (snap.pages[key]) return Promise.resolve(snap.pages[key]);
          if (pending.has(key)) return pending.get(key);
          store.set({ loading: { ...store.getSnapshot().loading, [key]: true } });
          const p = api.recoArtist(name).then((data) => {
            const cur = store.getSnapshot();
            store.set({
              pages: { ...cur.pages, [key]: data },
              loading: { ...cur.loading, [key]: false },
              error: null,
              lastReady: { name, key, at: Date.now() }
            });
            return data;
          }).catch((err) => {
            const cur = store.getSnapshot();
            store.set({ loading: { ...cur.loading, [key]: false }, error: err && err.message || String(err) });
            throw err;
          }).finally(() => {
            pending.delete(key);
          });
          pending.set(key, p);
          return p;
        }
        return { source: store, load, keyOf };
      }
      function createArtistImageService(api) {
        const store = createStore({ images: {} });
        const inflight = /* @__PURE__ */ new Set();
        const queue = [];
        let timer = null;
        let active = 0;
        function keyOf(name) {
          return normalizeZh(name).trim();
        }
        function pump() {
          while (active < 3 && queue.length) {
            const name = queue.shift();
            const key = keyOf(name);
            if (!key || inflight.has(key) || Object.prototype.hasOwnProperty.call(store.getSnapshot().images, key)) continue;
            inflight.add(key);
            active += 1;
            api.artistImage(name).then((data) => {
              const url = data && (data.thumbnailUrl || data.imageUrl) || null;
              store.set({ images: { ...store.getSnapshot().images, [key]: url } });
            }).catch(() => {
              store.set({ images: { ...store.getSnapshot().images, [key]: null } });
            }).finally(() => {
              inflight.delete(key);
              active -= 1;
              pump();
            });
          }
        }
        function request(name) {
          const key = keyOf(name);
          if (!key || inflight.has(key) || Object.prototype.hasOwnProperty.call(store.getSnapshot().images, key)) return;
          queue.push(name);
          if (!timer) timer = setTimeout(() => {
            timer = null;
            pump();
          }, 150);
        }
        function reset() {
          queue.length = 0;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        return { source: store, request, reset };
      }
      function createOnboardingService(api) {
        const store = createStore({ status: "idle", completed: null, mode: null, libraryConfigured: false, libraryPath: null, starter: null, taste: null, error: null });
        let timer = null;
        async function load() {
          try {
            const data = await api.onboardingState();
            const starter = data && (data.starter || data.starterLibrary) || null;
            store.set({
              status: "ready",
              completed: !!(data && data.completed),
              mode: data && data.mode || null,
              libraryConfigured: !!(data && data.libraryConfigured),
              libraryPath: data && data.libraryPath || null,
              starter,
              taste: data && data.taste || null,
              error: null
            });
            return data;
          } catch (err) {
            store.set({ status: "error", error: err && err.message || String(err) });
            return null;
          }
        }
        async function complete(payload) {
          await api.onboardingComplete(payload);
          writePrefs({
            taste: payload && payload.taste || null,
            libraryMode: payload && payload.libraryMode || null
          });
          store.set({ completed: true, taste: payload && payload.taste || null });
          pollStarter();
        }
        function pollStarter() {
          if (timer) return;
          const tick = async () => {
            const data = await load();
            const st = data && (data.starter || data.starterLibrary || null);
            if (!st || st.status !== "downloading") {
              timer = null;
              return;
            }
            timer = setTimeout(tick, 1500);
          };
          timer = setTimeout(tick, 800);
        }
        function dispose() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        return { source: store, load, complete, pollStarter, dispose };
      }
      function createRecoService(api) {
        const store = createStore({
          status: "idle",
          items: [],
          sections: null,
          generatedAt: 0,
          stats: null,
          error: null,
          bootstrapNote: null,
          fromCache: { today: false, artist: false, new: false },
          refreshing: { today: false, artist: false, new: false },
          refreshError: null,
          refreshBusy: false
        });
        let inflight = false;
        async function pollUntilIdle() {
          for (; ; ) {
            try {
              const s = await api.recoStatus();
              if (!s || !s.running) return s || null;
            } catch {
              return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 2e3));
          }
        }
        async function generate() {
          if (inflight) return;
          inflight = true;
          store.set({ status: "generating", error: null });
          try {
            const data = await api.reco(readPrefs().taste || null);
            store.set({
              status: "ready",
              items: data && data.items || [],
              generatedAt: data && data.generatedAt || Date.now(),
              stats: data && data.stats || null,
              bootstrapNote: data && data.bootstrap ? data.note || null : null
            });
          } catch (err) {
            const msg = err && err.message || String(err);
            if (msg.indexOf("409") >= 0 || msg.indexOf("\u751F\u6210\u4E2D") >= 0 || msg.indexOf("\u6B63\u5728\u751F\u6210") >= 0) {
              const s = await pollUntilIdle();
              if (s && s.items && s.items.length) {
                store.set({ status: "ready", items: s.items, generatedAt: s.generatedAt || Date.now(), stats: s.stats || null });
              } else {
                store.set({ status: "error", error: msg });
              }
            } else {
              store.set({ status: "error", error: msg });
            }
          } finally {
            inflight = false;
          }
        }
        async function loadSections() {
          if (!api.recoSections) return false;
          try {
            const data = await api.recoSections(readPrefs().taste || null);
            if (!data) return false;
            const sections = {
              today: data.today || [],
              artist: data.artist || [],
              new: data.new || data["new"] || []
            };
            if (!sections.today.length && !sections.artist.length && !sections.new.length) return false;
            store.set({
              status: "ready",
              sections,
              items: sections.today,
              generatedAt: data.generatedAt || Date.now(),
              error: null,
              bootstrapNote: data.exploreOnly ? data.note || null : null,
              fromCache: data && data.fromCache || { today: false, artist: false, new: false },
              refreshError: null,
              refreshBusy: false
            });
            return true;
          } catch {
            return false;
          }
        }
        async function load() {
          if (inflight || store.getSnapshot().status === "generating") return;
          if (await loadSections()) return;
          try {
            const s = await api.recoStatus();
            if (s && s.running) {
              generate();
              return;
            }
            if (s && s.items && s.items.length) {
              store.set({ status: "ready", items: s.items, generatedAt: s.generatedAt || Date.now(), stats: s.stats || null });
            }
          } catch {
          }
        }
        const AXES = ["today", "artist", "new"];
        async function refresh(axis) {
          if (AXES.indexOf(axis) < 0 || !api.recoSectionsRefresh) return;
          const cur = store.getSnapshot();
          if (cur.refreshing[axis]) return;
          store.set({ refreshing: Object.assign({}, cur.refreshing, { [axis]: true }), refreshError: null, refreshBusy: false });
          try {
            const data = await api.recoSectionsRefresh(axis, readPrefs().taste || null);
            const prev = store.getSnapshot();
            const base = prev.sections || { today: [], artist: [], new: [] };
            const sections = {
              today: data && data.today || base.today || [],
              artist: data && data.artist || base.artist || [],
              new: data && (data["new"] || data.newColumn) || base["new"] || []
            };
            store.set({
              status: "ready",
              sections,
              items: sections.today,
              error: null,
              generatedAt: data && data.generatedAt || prev.generatedAt,
              fromCache: data && data.fromCache || prev.fromCache,
              refreshing: { today: false, artist: false, new: false },
              refreshError: null,
              refreshBusy: false
            });
          } catch (err) {
            const msg = err && err.message || String(err);
            const busy = /409|正在|生成中/.test(msg);
            store.set({
              refreshing: { today: false, artist: false, new: false },
              refreshError: busy ? "busy" : msg,
              refreshBusy: busy
            });
          }
        }
        return { source: store, generate, load, refresh, searchStyle: (q) => api.recoStyle(q), artistPage: (name) => api.recoArtist(name) };
      }
      function createDownloadService(api) {
        const store = createStore({ running: false, total: 0, done: 0, items: [], error: null, finishedAt: 0 });
        let timer = null;
        async function refresh() {
          try {
            const s = await api.downloadStatus();
            store.set({ running: !!s.running, total: s.total || 0, done: s.done || 0, items: s.items || [] });
            return s;
          } catch {
            return null;
          }
        }
        function poll() {
          if (timer) return;
          const tick = async () => {
            const s = await refresh();
            if (s && !s.running) {
              timer = null;
              if (s.total > 0) store.set({ finishedAt: Date.now() });
              return;
            }
            timer = setTimeout(tick, 1500);
          };
          tick();
        }
        async function start(items) {
          try {
            await api.download(items);
            store.set({ error: null, finishedAt: 0 });
          } catch (err) {
            store.set({ error: err && err.message || String(err) });
            return false;
          }
          poll();
          return true;
        }
        async function warm() {
          const s = await refresh();
          if (s && s.running) poll();
        }
        function dispose() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        return { source: store, start, warm, dispose };
      }
      function createSyncService(api) {
        const store = createStore({ phase: "idle", result: null, error: null, available: null, hint: null });
        let timer = null;
        async function probe() {
          try {
            const a = await api.syncAvailability();
            store.set({ available: !!(a && a.available), hint: a && a.hint || null });
          } catch {
            store.set({ available: false, hint: null });
          }
        }
        function noteAvailable(s) {
          if (s && typeof s.available === "boolean") store.set({ available: s.available, hint: s.hint || null });
        }
        async function refresh() {
          try {
            const s = await api.syncStatus();
            noteAvailable(s);
            if (s.running) {
              store.set({ phase: "running" });
              return true;
            }
            if (s.result || s.error) {
              store.set({ phase: "done", result: s.result || null, error: s.error || null });
              return false;
            }
            return false;
          } catch {
            return false;
          }
        }
        function poll() {
          if (timer) return;
          const tick = async () => {
            const running = await refresh();
            if (!running) {
              timer = null;
              return;
            }
            timer = setTimeout(tick, 1500);
          };
          tick();
        }
        async function start() {
          if (store.getSnapshot().phase === "running") return;
          store.set({ phase: "running", error: null, result: null });
          try {
            await api.sync();
          } catch (err) {
            store.set({ phase: "error", error: err && err.message || String(err) });
            timer = null;
            return;
          }
          poll();
        }
        async function warm() {
          await probe();
          const r = await refresh();
          if (r) poll();
        }
        function dispose() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        return { source: store, start, warm, dispose, probe };
      }
      function createHistoryService(api) {
        const store = createStore({ status: "idle", events: [], total: 0, stats: null, error: null });
        async function load(limit) {
          store.set({ status: store.getSnapshot().events.length ? "ready" : "loading", error: null });
          const statsPromise = api.historyStats ? api.historyStats().catch(() => null) : Promise.resolve(null);
          try {
            const data = await api.history(limit || 50);
            const stats = await statsPromise;
            store.set({
              status: "ready",
              events: data && data.events || [],
              total: data && data.total || 0,
              stats
            });
          } catch (err) {
            store.set({ status: "error", error: err && err.message || String(err) });
          }
        }
        return { source: store, load };
      }
      function likeKey(o = {}) {
        return normalizeZh(o.artist).trim() + "::" + normalizeZh(o.title).trim();
      }
      function previewTrack(item, audioUrl) {
        return {
          id: "preview:" + likeKey(item),
          preview: true,
          title: item.title,
          artist: item.artist,
          album: item.album,
          coverUrl: item.coverUrl || null,
          audioUrl,
          duration: null,
          durationMs: item.durationMs,
          verification: item.verification,
          source: item.source || "preview",
          sourceUrl: item.sourceUrl
        };
      }
      function createLikesService(api, onAutoDownload) {
        const store = createStore({ keys: {}, dislikes: {}, items: [], dislikeItems: [], loaded: false, error: null });
        let revision = 0;
        let refreshSequence = 0;
        async function load() {
          const atRevision = revision, sequence = ++refreshSequence;
          const current = () => revision === atRevision && sequence === refreshSequence;
          try {
            const data = await api.likes();
            const keys = {};
            for (const it of data && data.items || []) if (it.liked !== false) keys[likeKey(it)] = it;
            if (current()) store.set({ keys, items: data && data.items || [], loaded: true, error: null });
          } catch (err) {
            if (current()) store.set({ loaded: true, error: err && err.message || String(err) });
          }
          try {
            const d = await api.dislikes();
            const dislikes = {};
            for (const it of d && d.items || []) dislikes[likeKey(it)] = it;
            if (current()) store.set({ dislikes, dislikeItems: d && d.items || [] });
          } catch {
          }
        }
        async function toggle(item, liked) {
          revision++;
          const trackId = libraryTrackId(item);
          const body = trackId ? { trackId, liked } : { artist: item.artist, title: item.title, album: item.album, durationMs: item.durationMs, coverUrl: item.coverUrl, verification: item.verification, liked };
          let res = null;
          try {
            res = await api.like(body);
          } catch (err) {
            return { error: err && err.message || String(err) };
          }
          if (res?.error) return res;
          const key = res?.key || likeKey(item);
          const keys = { ...store.getSnapshot().keys };
          const dislikes = { ...store.getSnapshot().dislikes };
          if (liked) keys[key] = { artist: item.artist, title: item.title, trackId: res && res.trackId, inLibrary: res && res.inLibrary };
          else delete keys[key];
          if (liked && res && res.disliked === false) delete dislikes[key];
          store.set({ keys, dislikes });
          if (res && res.downloading && onAutoDownload) onAutoDownload();
          load();
          return res || {};
        }
        async function setDislike(item, disliked) {
          revision++;
          const trackId = libraryTrackId(item);
          const body = trackId ? { trackId, disliked } : { artist: item.artist, title: item.title, album: item.album, durationMs: item.durationMs, disliked };
          let res = null;
          try {
            res = await api.dislike(body);
          } catch (err) {
            return { error: err && err.message || String(err) };
          }
          if (res?.error) return res;
          const key = res && res.key ? res.key : likeKey(item);
          const keys = { ...store.getSnapshot().keys };
          const dislikes = { ...store.getSnapshot().dislikes };
          if (res && res.clearedLike) delete keys[key];
          if (res && res.disliked) dislikes[key] = { artist: item.artist, title: item.title, trackId: res.trackId, inLibrary: res.inLibrary, dislikedAt: Date.now() };
          else delete dislikes[key];
          store.set({ keys, dislikes });
          load();
          return res || {};
        }
        function isLiked(item) {
          return !!store.getSnapshot().keys[likeKey(item)];
        }
        function isDisliked(item) {
          return !!store.getSnapshot().dislikes[likeKey(item)];
        }
        load();
        return { source: store, toggle, setDislike, isLiked, isDisliked, load };
      }
      function createPreviewService(api) {
        const store = createStore({ status: "idle", item: null, error: null });
        let timer = null;
        function stopTimer() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        function poll(ready) {
          stopTimer();
          timer = setTimeout(async () => {
            try {
              const s = await api.previewStatus();
              if (s && s.status === "ready" && s.audioUrl) {
                store.set({ status: "idle", item: null });
                ready({ audioUrl: s.audioUrl });
                return;
              }
              if (s && s.status === "fail") {
                store.set({ status: "idle", item: null, error: s.error || null });
                ready({ error: s.error || "\u8BD5\u542C\u5931\u8D25" });
                return;
              }
              if (s && (s.status === "downloading" || s.running)) {
                poll(ready);
                return;
              }
            } catch {
            }
            poll(ready);
          }, 2e3);
        }
        async function start(item, ready) {
          const snap = store.getSnapshot();
          if (snap.item && snap.item.artist === item.artist && snap.item.title === item.title) return;
          store.set({ status: "downloading", item, error: null });
          try {
            const res = await api.preview({
              artist: item.artist,
              title: item.title,
              album: item.album,
              durationMs: item.durationMs,
              coverUrl: item.coverUrl,
              verification: item.verification
            });
            if (res && res.status === "ready" && res.audioUrl) {
              store.set({ status: "idle", item: null });
              ready({ audioUrl: res.audioUrl });
            } else {
              poll(ready);
            }
          } catch (err) {
            store.set({ status: "idle", item: null, error: err && err.message || String(err) });
            ready({ error: err && err.message || String(err) });
          }
        }
        function dispose() {
          stopTimer();
        }
        return { source: store, start, dispose };
      }
      function createWarmService(preview, player) {
        const store = createStore({ pending: {}, running: false });
        function isPending(item) {
          return !!store.getSnapshot().pending[likeKey(item)];
        }
        function mark(items, on) {
          const next = Object.assign({}, store.getSnapshot().pending);
          for (const it of items || []) {
            const key = likeKey(it);
            if (on) next[key] = true;
            else delete next[key];
          }
          store.set({ pending: next });
        }
        function warmOne(item) {
          return new Promise((resolve) => {
            preview.start(item, (res) => resolve(res || {}));
          });
        }
        function handle(item, res) {
          if (!res || !res.audioUrl) return;
          const tr = previewTrack(item, res.audioUrl);
          if (!player.source.getSnapshot().track) player.playTracks([tr], 0);
          else player.appendTrack(tr);
        }
        async function playList(items, findLocal) {
          if (store.getSnapshot().running) return;
          const list = items || [];
          const localTracks = [];
          const remote = [];
          for (const it of list) {
            if (!it) continue;
            const lc = findLocal ? findLocal(it) : null;
            if (lc) {
              if (!localTracks.some((tr) => tr.id === lc.id)) localTracks.push(lc);
            } else if (it.verification) {
              remote.push(it);
            }
          }
          if (localTracks.length) player.playTracks(localTracks, 0);
          if (!remote.length) return;
          mark(remote, true);
          store.set({ running: true });
          let firstError = null;
          try {
            for (const it of remote) {
              const res = await warmOne(it);
              mark([it], false);
              if (!res.audioUrl && res.error && !firstError) firstError = res.error;
              handle(it, res);
            }
          } finally {
            mark(remote, false);
            store.set({ running: false });
          }
          return { error: firstError };
        }
        async function playOne(item) {
          if (store.getSnapshot().running) return null;
          mark([item], true);
          store.set({ running: true });
          let err = null;
          try {
            const res = await warmOne(item);
            if (res && res.error) err = res.error;
            handle(item, res);
          } finally {
            mark([item], false);
            store.set({ running: false });
          }
          return err ? { error: err } : null;
        }
        return { source: store, isPending, playList, playOne };
      }
      function createPlayer(t, api, lifeService) {
        const prefs = readPrefs();
        const store = createStore({
          track: null,
          playing: false,
          loading: false,
          position: 0,
          duration: 0,
          volume: typeof prefs.volume === "number" ? Math.min(1, Math.max(0, prefs.volume)) : 0.9,
          muted: !!prefs.muted,
          queue: [],
          queueIndex: -1,
          shuffle: !!prefs.shuffle,
          repeat: prefs.repeat === "all" || prefs.repeat === "one" ? prefs.repeat : "off",
          error: null
        });
        const hasAudio = typeof Audio !== "undefined";
        const audio = hasAudio ? new Audio() : null;
        const cleanups = [];
        const observer = createPlaybackObserver({ audio, submit: (event) => lifeService.submit(event), onStatus: (status, features) => lifeService.setAudio(status, features) });
        function startPlayback() {
          void observer.activate();
          return audio.play();
        }
        if (audio) {
          audio.preload = "auto";
          audio.volume = store.getSnapshot().volume;
          audio.muted = store.getSnapshot().muted;
        }
        const set = (patch) => store.set(patch);
        const snap = () => store.getSnapshot();
        function report(track2, skipped) {
          if (!track2 || !isLibraryTrackId(track2.id)) return;
          const s = snap();
          const completion = s.duration > 0 ? Math.min(1, Math.max(0, s.position / s.duration)) : 0;
          try {
            void fetch(resolveUrl("/dsh-music/api/history"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trackId: track2.id, completion, skipped })
            }).catch(() => {
            });
          } catch {
          }
        }
        function listen(target, name, fn) {
          target.addEventListener(name, fn);
          cleanups.push(() => target.removeEventListener(name, fn));
        }
        function updateMediaSession(track2) {
          try {
            if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
            const ms = navigator.mediaSession;
            ms.metadata = new MediaMetadata({
              title: track2.title || "",
              artist: track2.artist || "",
              album: track2.album || "",
              artwork: track2.coverUrl ? [{ src: resolveUrl(track2.coverUrl) }] : []
            });
          } catch {
          }
        }
        function loadTrack(track2, autoplay) {
          if (!audio) return;
          observer.setTrack(track2);
          set({ track: track2, error: null, loading: true, position: 0, duration: track2.duration || 0 });
          updateMediaSession(track2);
          audio.src = resolveUrl(track2.audioUrl);
          audio.load();
          if (autoplay) play();
        }
        function hostMode() {
          const s = snap();
          return s.shuffle ? "shuffle" : s.repeat === "one" ? "single" : "sequential";
        }
        function syncHost(extra) {
          if (!api || !api.playback) return;
          const s = snap();
          const patch = {
            mode: hostMode(),
            trackId: s.track?.id || null,
            queue: (s.queue || []).map((tr) => tr && tr.id),
            ...extra
          };
          patch.trackId = isLibraryTrackId(patch.trackId) ? patch.trackId : null;
          patch.queue = (Array.isArray(patch.queue) ? patch.queue : []).filter(isLibraryTrackId);
          api.playback(patch).catch(() => {
          });
        }
        function playTracks(tracks, startIndex, opts) {
          const list = (tracks || []).filter((tr) => tr && tr.audioUrl);
          if (!list.length) return;
          if (snap().track) report(snap().track, true);
          const wantShuffle = opts?.ordered ? false : typeof opts?.shuffle === "boolean" ? opts.shuffle : snap().shuffle;
          let queue = list;
          let index = Math.min(Math.max(0, startIndex | 0), list.length - 1);
          if (wantShuffle && queue.length > 1) {
            queue = [...list];
            for (let i = queue.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              const tmp = queue[i];
              queue[i] = queue[j];
              queue[j] = tmp;
            }
            index = Math.floor(Math.random() * queue.length);
          }
          set({ queue, queueIndex: index, shuffle: wantShuffle, ...opts?.ordered ? { repeat: "off" } : {} });
          if (!opts?.ordered && typeof opts?.shuffle === "boolean") writePrefs({ shuffle: wantShuffle });
          loadTrack(queue[index], true);
          syncHost();
        }
        function appendTrack(tr) {
          if (!tr || !tr.audioUrl) return;
          const snapNow = snap();
          if (!snapNow.track) {
            playTracks([tr], 0);
            return;
          }
          const queue = [...snapNow.queue, tr];
          set({ queue });
          syncHost({ queue: queue.map((x) => x && x.id || null).filter(Boolean) });
        }
        function jumpTo(index) {
          const { queue } = snap();
          if (index < 0 || index >= queue.length) return;
          report(snap().track, true);
          set({ queueIndex: index });
          loadTrack(queue[index], true);
          syncHost({ trackId: queue[index].id });
        }
        function playById(id) {
          const { queue } = snap();
          const idx = queue.findIndex((tr) => tr && tr.id === id);
          if (idx < 0) return false;
          set({ queueIndex: idx });
          loadTrack(queue[idx], true);
          syncHost({ trackId: id });
          return true;
        }
        function advanceLocal(auto) {
          const { queue, queueIndex, shuffle, repeat } = snap();
          if (!queue.length) return;
          if (auto && repeat === "one") {
            if (audio) {
              audio.currentTime = 0;
              play();
            }
            return;
          }
          let next;
          if (shuffle && queue.length > 1) {
            do {
              next = Math.floor(Math.random() * queue.length);
            } while (next === queueIndex);
          } else {
            next = queueIndex + 1;
            if (next >= queue.length) {
              if (repeat === "all" || !auto) next = 0;
              else {
                set({ playing: false });
                return;
              }
            }
          }
          set({ queueIndex: next });
          loadTrack(queue[next], true);
          syncHost({ trackId: queue[next].id });
        }
        async function advance(auto) {
          const cur = snap().track;
          if (cur) report(cur, !auto);
          const libraryOnly = snap().queue.every((track2) => isLibraryTrackId(track2?.id));
          if (auto && cur && isLibraryTrackId(cur.id) && libraryOnly && api && api.playbackNext) {
            try {
              const data = await api.playbackNext(cur.id);
              if (!data || !data.trackId) {
                set({ playing: false });
                return;
              }
              if (data.reason === "replay" || data.trackId === cur.id) {
                if (audio) {
                  audio.currentTime = 0;
                  play();
                }
                return;
              }
              if (playById(data.trackId)) return;
            } catch {
            }
          }
          advanceLocal(auto);
        }
        function prev() {
          const { queue, queueIndex, shuffle, position } = snap();
          if (!queue.length) return;
          if (position > 3 && audio) {
            audio.currentTime = 0;
            set({ position: 0 });
            return;
          }
          report(snap().track, true);
          let index;
          if (shuffle && queue.length > 1) {
            do {
              index = Math.floor(Math.random() * queue.length);
            } while (index === queueIndex);
          } else {
            index = queueIndex - 1;
            if (index < 0) index = queue.length - 1;
          }
          set({ queueIndex: index });
          loadTrack(queue[index], true);
        }
        function play() {
          if (!audio || !snap().track || !audio.paused && !audio.ended) return;
          const track2 = snap().track;
          const failed = (err) => {
            if (err?.name === "AbortError" || snap().track !== track2) return;
            set({ error: t("audioError"), playing: false, loading: false });
          };
          try {
            const pending = startPlayback();
            if (pending?.catch) return pending.catch(failed);
          } catch (err) {
            failed(err);
          }
        }
        function pause() {
          if (audio && !audio.paused) audio.pause();
        }
        function toggle() {
          if (snap().playing) pause();
          else return play();
        }
        function seek(seconds) {
          if (!audio || !snap().track) return;
          const dur = snap().duration;
          const target = Math.min(Math.max(0, seconds), dur > 0 ? dur : seconds);
          try {
            audio.currentTime = target;
          } catch {
          }
          set({ position: target });
        }
        function setVolume(v) {
          const volume = Math.min(1, Math.max(0, v));
          if (audio) {
            audio.volume = volume;
            if (volume > 0 && audio.muted) {
              audio.muted = false;
              set({ muted: false });
            }
          }
          set({ volume });
          writePrefs({ volume });
        }
        function toggleMute() {
          const muted = !snap().muted;
          if (audio) audio.muted = muted;
          set({ muted });
          writePrefs({ muted });
        }
        function setMode(mode) {
          const next = mode === "one" ? { shuffle: false, repeat: "one" } : mode === "shuffle" ? { shuffle: true, repeat: "all" } : { shuffle: false, repeat: "all" };
          set(next);
          writePrefs(next);
          syncHost({ mode: mode === "one" ? "single" : mode === "shuffle" ? "shuffle" : "sequential" });
        }
        function cycleMode() {
          const s = snap();
          const cur = s.shuffle ? "shuffle" : s.repeat === "one" ? "one" : "order";
          setMode(cur === "order" ? "shuffle" : cur === "shuffle" ? "one" : "order");
        }
        function stop() {
          observer.setTrack(null);
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          }
          set({ track: null, playing: false, loading: false, position: 0, duration: 0, queue: [], queueIndex: -1, error: null });
          try {
            if (typeof navigator !== "undefined" && "mediaSession" in navigator) navigator.mediaSession.metadata = null;
          } catch {
          }
        }
        if (audio) {
          listen(audio, "timeupdate", () => {
            const patch = { position: audio.currentTime };
            if (isFinite(audio.duration) && audio.duration > 0 && audio.duration !== snap().duration) patch.duration = audio.duration;
            set(patch);
          });
          listen(audio, "loadedmetadata", () => {
            if (isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
          });
          listen(audio, "durationchange", () => {
            if (isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
          });
          listen(audio, "play", () => set({ playing: true, error: null }));
          listen(audio, "pause", () => set({ playing: false }));
          listen(audio, "playing", () => set({ playing: true, loading: false }));
          listen(audio, "waiting", () => set({ loading: true }));
          listen(audio, "canplay", () => set({ loading: false }));
          listen(audio, "ended", () => advance(true));
          listen(audio, "error", () => {
            if (!snap().track) return;
            set({ playing: false, loading: false, error: t("audioError") });
          });
        }
        try {
          if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
            const ms = navigator.mediaSession;
            const handlers = {
              play,
              pause,
              previoustrack: () => prev(),
              nexttrack: () => advance(false),
              seekto: (d) => {
                if (d && typeof d.seekTime === "number") seek(d.seekTime);
              }
            };
            for (const [name, fn] of Object.entries(handlers)) {
              try {
                ms.setActionHandler(name, fn);
              } catch {
              }
              cleanups.push(() => {
                try {
                  ms.setActionHandler(name, null);
                } catch {
                }
              });
            }
          }
        } catch {
        }
        function dispose() {
          if (audio) audio.pause();
          observer.dispose();
          for (const fn of cleanups.splice(0)) {
            try {
              fn();
            } catch {
            }
          }
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          }
        }
        return {
          source: store,
          playTracks,
          appendTrack,
          playAll: (tracks, opts) => playTracks(tracks, 0, opts),
          jumpTo,
          play,
          pause,
          toggle,
          next: () => advance(false),
          prev,
          seek,
          setVolume,
          toggleMute,
          setMode,
          cycleMode,
          stop,
          dispose
        };
      }
      function IconButton({ label, onClick, active, disabled, className, children }) {
        return h("button", {
          type: "button",
          className: cx("dshm-iconbtn", active && "dshm-iconbtn-active", className),
          "aria-label": label,
          title: label,
          onClick,
          disabled,
          "aria-pressed": active === void 0 ? void 0 : !!active
        }, children);
      }
      function Cover({ track: track2, size, className }) {
        const [failed, setFailed] = useState(false);
        const id = track2 && track2.id;
        useEffect(() => {
          setFailed(false);
        }, [id]);
        const url = track2 && track2.coverUrl && !failed ? resolveUrl(track2.coverUrl) : null;
        const style = size ? { width: size, height: size } : void 0;
        const glyph = size ? Math.max(14, Math.round(size * 0.4)) : 64;
        return h(
          "div",
          { className: cx("dshm-cover", className), style },
          url ? h("img", { src: url, alt: "", loading: "lazy", draggable: false, onError: () => setFailed(true) }) : h("span", { className: "dshm-cover-fallback" }, h(IconNote, { size: glyph }))
        );
      }
      function EqBars({ playing }) {
        return h(
          "span",
          { className: cx("dshm-eq", playing && "dshm-eq-on"), "aria-hidden": true },
          h("i"),
          h("i"),
          h("i")
        );
      }
      function modeMeta(t, shuffle, repeat) {
        if (shuffle) return { icon: IconShuffle, label: t("modeShuffle"), hint: t("modeHintShuffle") };
        if (repeat === "one") return { icon: IconRepeatOne, label: t("modeOne"), hint: t("modeHintOne") };
        return { icon: IconRepeat, label: t("modeOrder"), hint: t("modeHintOrder") };
      }
      function FishLogo({ size }) {
        return h(
          "svg",
          {
            viewBox: "0 0 200 200",
            width: size || 168,
            height: size || 168,
            className: "dshm-fish",
            "aria-hidden": "true",
            focusable: "false"
          },
          h(
            "defs",
            null,
            h(
              "linearGradient",
              { id: "dshmFishBody", x1: "0.1", y1: "0", x2: "0.9", y2: "1" },
              h("stop", { offset: "0%", style: { stopColor: "var(--dsw-alias-brand-primary)" } }),
              h("stop", { offset: "100%", style: { stopColor: "var(--dsw-alias-brand-primary)", stopOpacity: "0.72" } })
            )
          ),
          /* tail fin */
          h("path", {
            d: "M44 104 C24 88 18 72 24 60 C42 72 52 83 60 96 L60 112 C52 125 42 136 24 148 C18 136 24 120 44 104 Z",
            fill: "url(#dshmFishBody)"
          }),
          /* dorsal fin */
          h("path", {
            d: "M92 58 C100 40 122 36 134 50 C126 60 110 66 98 68 Z",
            fill: "url(#dshmFishBody)",
            opacity: "0.9"
          }),
          /* body */
          h("ellipse", { cx: 104, cy: 104, rx: 60, ry: 46, fill: "url(#dshmFishBody)" }),
          /* belly highlight */
          h("ellipse", { cx: 110, cy: 122, rx: 38, ry: 20, fill: "var(--dsw-alias-label-primary-inverted)", opacity: "0.18" }),
          /* headphone band */
          h("path", {
            d: "M62 92 C62 44 144 44 144 92",
            fill: "none",
            stroke: "var(--dsw-alias-label-primary)",
            strokeWidth: 9,
            strokeLinecap: "round"
          }),
          /* ear cups */
          h("rect", { x: 52, y: 84, width: 22, height: 38, rx: 10, fill: "var(--dsw-alias-label-primary)" }),
          h("rect", { x: 132, y: 84, width: 22, height: 38, rx: 10, fill: "var(--dsw-alias-label-primary)" }),
          h("rect", { x: 58, y: 91, width: 10, height: 24, rx: 5, fill: "var(--dsw-alias-bg-layer-1)", opacity: "0.35" }),
          h("rect", { x: 138, y: 91, width: 10, height: 24, rx: 5, fill: "var(--dsw-alias-bg-layer-1)", opacity: "0.35" }),
          /* eye + pupil */
          h("circle", { cx: 140, cy: 104, r: 10, fill: "var(--dsw-alias-label-primary-inverted)" }),
          h("circle", { cx: 143, cy: 104, r: 4.6, fill: "var(--dsw-alias-label-primary)" }),
          /* mouth */
          h("path", {
            d: "M148 122 q9 7 17 1",
            fill: "none",
            stroke: "var(--dsw-alias-label-primary)",
            strokeWidth: 3,
            strokeLinecap: "round",
            opacity: "0.7"
          }),
          /* musical note */
          h(
            "g",
            { transform: "translate(158 52) rotate(12)", fill: "var(--dsw-alias-label-primary)", opacity: "0.85" },
            h("rect", { x: 2, y: 0, width: 3, height: 22, rx: 1.5 }),
            h("path", { d: "M5 0 q9 3 9 10 q-4 -4 -9 -3 Z" }),
            h("circle", { cx: 1, cy: 23, r: 4.4 })
          )
        );
      }
      function WelcomeView({ t, onboarding, useOnboarding, preview, onExitPreview, onRoute }) {
        const snap = useOnboarding((st) => st);
        const [step, setStep] = useState(0);
        const [genres, setGenres] = useState([]);
        const [langs, setLangs] = useState([]);
        const [mode, setMode] = useState("starter");
        const [dirPath, setDirPath] = useState("");
        const [busy, setBusy] = useState(false);
        const [failed, setFailed] = useState(false);
        const genreOptions = ["pop", "rock", "electronic", "hip hop", "jazz", "classical", "folk", "blues", "soul", "funk", "reggae", "metal", "punk", "country", "ambient"];
        const genreLabel = (g) => "genre_" + g.replace(/[^a-z]/g, "");
        const langOptions = [
          { value: "\u4E2D\u6587", key: "lang_zh" },
          { value: "\u82F1\u8BED", key: "lang_en" },
          { value: "\u7CA4\u8BED", key: "lang_yue" },
          { value: "\u65E5\u8BED", key: "lang_ja" },
          { value: "\u97E9\u8BED", key: "lang_ko" },
          { value: "\u6CD5\u8BED", key: "lang_fr" },
          { value: "\u897F\u73ED\u7259\u8BED", key: "lang_es" },
          { value: "\u8461\u8404\u7259\u8BED", key: "lang_pt" },
          { value: "\u610F\u5927\u5229\u8BED", key: "lang_it" }
        ];
        const toggle = (list, setList, value) => setList(list.indexOf(value) >= 0 ? list.filter((x) => x !== value) : list.concat([value]));
        const starter = snap.starter;
        const starterTracks = starter && starter.tracks || [];
        const starterTotal = starter && starter.total || starterTracks.length;
        const starterDone = starter && starter.done || 0;
        const starterStatus = starter ? starter.status : "idle";
        const starterPct = starterTotal > 0 ? Math.min(100, Math.round(starterDone / starterTotal * 100)) : starterStatus === "ready" ? 100 : 0;
        async function finish() {
          if (preview) {
            onExitPreview();
            return;
          }
          if (busy) return;
          setBusy(true);
          setFailed(false);
          try {
            const payload = { taste: { genres, languages: langs }, libraryMode: mode };
            if (mode === "starter") payload.useStarter = true;
            else if (dirPath.trim()) payload.libraryPath = dirPath.trim();
            await onboarding.complete(payload);
          } catch (err) {
            setFailed(true);
            setBusy(false);
            return;
          }
          setBusy(false);
          if (mode === "starter") setStep(3);
          else onRoute("library");
        }
        function skipAll() {
          if (preview) {
            onExitPreview();
            return;
          }
          onRoute("reco");
        }
        const tasteChip = (value, label, list, setList) => h("button", {
          key: value,
          type: "button",
          className: cx("dshm-wchip", list.indexOf(value) >= 0 && "dshm-wchip-on"),
          "aria-pressed": list.indexOf(value) >= 0,
          onClick: () => toggle(list, setList, value)
        }, label);
        const dots = h(
          "div",
          { className: "dshm-wdots", "aria-hidden": true },
          [0, 1, 2, 3].map((i) => h("span", { key: i, className: cx("dshm-wdot", i === step && "dshm-wdot-on") }))
        );
        const hero = h(
          "div",
          { className: "dshm-welcome-hero" },
          h("div", { className: "dshm-welcome-glow", "aria-hidden": true }),
          h("div", { className: "dshm-welcome-fish" }, h(FishLogo, { size: 176 })),
          h("h1", { className: "dshm-welcome-title" }, t("welcomeTitle")),
          h("p", { className: "dshm-welcome-sub" }, t("welcomeSub")),
          h(
            "div",
            { className: "dshm-welcome-actions" },
            h("button", {
              type: "button",
              className: "dshm-wbtn dshm-wbtn-primary",
              onClick: () => setStep(1)
            }, h(IconSparkles, { size: 16 }), t("welcomeStart")),
            preview ? h("button", { type: "button", className: "dshm-wbtn", onClick: onExitPreview }, t("welcomeBack")) : h("button", { type: "button", className: "dshm-wbtn", onClick: skipAll }, t("welcomeSkip"))
          ),
          h(
            "div",
            { className: "dshm-welcome-points" },
            [t("welcomePoint1"), t("welcomePoint2"), t("welcomePoint3")].map((text2, i) => h("div", { className: "dshm-wpoint", key: i }, h(IconCheck, { size: 13 }), h("span", null, text2)))
          )
        );
        const taste = h(
          "div",
          { className: "dshm-welcome-panel" },
          h("h2", { className: "dshm-wstep-title" }, t("welcomeTasteTitle")),
          h("p", { className: "dshm-wstep-sub" }, t("welcomeTasteSub")),
          h(
            "div",
            { className: "dshm-wgroup" },
            h("div", { className: "dshm-wlabel" }, t("welcomeGenres")),
            h("div", { className: "dshm-wchips" }, genreOptions.map((g) => tasteChip(g, t(genreLabel(g)), genres, setGenres)))
          ),
          h(
            "div",
            { className: "dshm-wgroup" },
            h("div", { className: "dshm-wlabel" }, t("welcomeLanguages")),
            h("div", { className: "dshm-wchips" }, langOptions.map((o) => tasteChip(o.value, t(o.key), langs, setLangs)))
          ),
          h("p", { className: "dshm-whint" }, t("welcomeTasteNote")),
          h(
            "div",
            { className: "dshm-welcome-actions" },
            h("button", { type: "button", className: "dshm-wbtn", onClick: () => setStep(0) }, t("welcomePrev")),
            h("button", { type: "button", className: "dshm-wbtn dshm-wbtn-primary", onClick: () => setStep(2) }, t("welcomeNext"))
          )
        );
        const pickCard = (value, icon, title, body) => h(
          "button",
          {
            key: value,
            type: "button",
            className: cx("dshm-wcard", mode === value && "dshm-wcard-on"),
            "aria-pressed": mode === value,
            onClick: () => setMode(value)
          },
          h("span", { className: "dshm-wcard-icon" }, h(icon, { size: 20 })),
          h(
            "span",
            { className: "dshm-wcard-text" },
            h("span", { className: "dshm-wcard-title" }, title),
            h("span", { className: "dshm-wcard-body" }, body)
          )
        );
        const library = h(
          "div",
          { className: "dshm-welcome-panel" },
          h("h2", { className: "dshm-wstep-title" }, t("welcomeLibTitle")),
          h("p", { className: "dshm-wstep-sub" }, t("welcomeLibSub")),
          h(
            "div",
            { className: "dshm-wcards" },
            pickCard("local", IconFolder, t("welcomeLocalTitle"), t("welcomeLocalBody")),
            pickCard("starter", IconSparkles, t("welcomeStarterTitle"), t("welcomeStarterBody"))
          ),
          mode === "starter" ? h("p", { className: "dshm-whint" }, t("welcomeStarterHint")) : h(
            "div",
            { className: "dshm-wpath" },
            h("label", { className: "dshm-wlabel", htmlFor: "dshm-wpath" }, t("welcomePathLabel")),
            h("input", {
              id: "dshm-wpath",
              type: "text",
              className: "dshm-winput",
              placeholder: t("welcomePathPlaceholder"),
              value: dirPath,
              onChange: (e) => setDirPath(e.target.value)
            }),
            h("p", { className: "dshm-whint" }, t("welcomePathHint"))
          ),
          failed ? h("p", { className: "dshm-whint dshm-whint-err" }, t("welcomeSaveFail")) : null,
          h(
            "div",
            { className: "dshm-welcome-actions" },
            h("button", { type: "button", className: "dshm-wbtn", onClick: () => setStep(1) }, t("welcomePrev")),
            h("button", {
              type: "button",
              className: "dshm-wbtn dshm-wbtn-primary",
              disabled: busy,
              onClick: finish
            }, h(IconCheck, { size: 15 }), t("welcomeFinish"))
          )
        );
        const starterPanel = h(
          "div",
          { className: "dshm-welcome-panel" },
          h("h2", { className: "dshm-wstep-title" }, t("welcomeStarterTitle")),
          h(
            "p",
            { className: "dshm-wstep-sub" },
            starterStatus === "ready" ? t("welcomeStarterReady") : starterStatus === "failed" || starterStatus === "skipped" ? t("welcomeStarterSkipped") : t("welcomeStarterDownloading")
          ),
          h(
            "div",
            { className: "dshm-wprogress" },
            h(
              "div",
              { className: "dshm-wprogress-track" },
              h("div", { className: "dshm-wprogress-fill", style: { width: starterPct + "%" } })
            ),
            h("span", { className: "dshm-count" }, starterDone + " / " + starterTotal)
          ),
          starterTracks.length ? h(
            "div",
            { className: "dshm-wtracks" },
            h("div", { className: "dshm-wlabel" }, t("welcomeCredits")),
            starterTracks.slice(0, 6).map((tr, i) => h(
              "div",
              { className: "dshm-wtrack", key: i },
              h("span", { className: "dshm-ellipsis" }, (tr.title || "") + (tr.artist ? " \xB7 " + tr.artist : "")),
              h("span", { className: "dshm-wtrack-lic" }, tr.license || tr.source || "")
            ))
          ) : null,
          h(
            "div",
            { className: "dshm-welcome-actions" },
            h("button", {
              type: "button",
              className: "dshm-wbtn dshm-wbtn-primary",
              onClick: () => preview ? onExitPreview() : onRoute("reco")
            }, h(IconSparkles, { size: 15 }), t("welcomeEnter"))
          )
        );
        const panels = [hero, taste, library, starterPanel];
        return h(
          "div",
          { className: cx("dshm-welcome", preview && "dshm-welcome-preview") },
          h(
            "div",
            { className: "dshm-welcome-inner" },
            panels[step] || hero,
            step > 0 && step < 3 ? dots : null,
            preview ? h("button", { type: "button", className: "dshm-wclose", title: t("welcomeBack"), onClick: onExitPreview }, h(IconClose, { size: 14 })) : null
          )
        );
      }
      function Slider({ value, onChange, label, disabled, className }) {
        const ref = useRef(null);
        const [drag, setDrag] = useState(null);
        const v = Math.min(1, Math.max(0, drag == null ? value || 0 : drag));
        const fromEvent = (e) => {
          const el = ref.current;
          if (!el) return 0;
          const r = el.getBoundingClientRect();
          return r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
        };
        return h("div", {
          ref,
          className: cx("dshm-slider", drag != null && "dshm-slider-drag", disabled && "dshm-slider-disabled", className),
          role: "slider",
          tabIndex: disabled ? -1 : 0,
          "aria-label": label,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(v * 100),
          "aria-disabled": disabled || void 0,
          onPointerDown: (e) => {
            if (disabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const f = fromEvent(e);
            setDrag(f);
            onChange(f);
          },
          onPointerMove: (e) => {
            if (disabled || drag == null) return;
            const f = fromEvent(e);
            setDrag(f);
            onChange(f);
          },
          onPointerUp: () => {
            if (drag != null) setDrag(null);
          },
          onPointerCancel: () => {
            if (drag != null) setDrag(null);
          },
          onKeyDown: (e) => {
            if (disabled) return;
            const step = 0.05;
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              onChange(Math.min(1, (value || 0) + step));
              e.preventDefault();
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              onChange(Math.max(0, (value || 0) - step));
              e.preventDefault();
            } else if (e.key === "Home") {
              onChange(0);
              e.preventDefault();
            } else if (e.key === "End") {
              onChange(1);
              e.preventDefault();
            }
          }
        }, h(
          "div",
          { className: "dshm-slider-track" },
          h("div", { className: "dshm-slider-fill", style: { width: v * 100 + "%" } }),
          h("div", { className: "dshm-slider-thumb", style: { left: v * 100 + "%" } })
        ));
      }
      function EmptyState({ icon, title, body, tone, children }) {
        return h(
          "div",
          { className: "dshm-state" },
          h("div", { className: cx("dshm-state-icon", tone === "error" && "dshm-state-error") }, icon),
          h("div", { className: cx("dshm-state-title", tone === "error" && "dshm-state-error") }, title),
          body ? h("div", { className: "dshm-state-body" }, body) : null,
          children
        );
      }
      function SkeletonRows() {
        const rows = [];
        for (let i = 0; i < 9; i++) {
          rows.push(h(
            "div",
            { key: i, className: "dshm-skel-row" },
            h("div", { className: "dshm-skel-box", style: { width: 40, height: 40 } }),
            h(
              "div",
              { style: { flex: 1, display: "flex", flexDirection: "column", gap: 6 } },
              h("div", { className: "dshm-skel-box", style: { height: 12, width: 38 + i * 17 % 40 + "%" } }),
              h("div", { className: "dshm-skel-box", style: { height: 9, width: 22 + i * 11 % 26 + "%" } })
            )
          ));
        }
        return h("div", { className: "dshm-skel", "aria-hidden": true }, rows);
      }
      function sourceLabel(source, t) {
        if (source === "spotify-liked") return t("sourceSpotify");
        if (source === "dsh-music") return t("sourceDsh");
        if (source === "apple-music") return t("sourceApple");
        return source || "";
      }
      function LikeButton({ t, item, likes, useLikes }) {
        const liked = useLikes((st) => !!st.keys[likeKey(item)]);
        return h("button", {
          type: "button",
          className: cx("dshm-like-btn", liked && "dshm-like-btn-on"),
          "aria-label": liked ? t("unlikeBtn") : t("likeBtn"),
          "aria-pressed": !!liked,
          title: liked ? t("likedBtn") : t("likeBtn"),
          onClick: (e) => {
            e.stopPropagation();
            likes.toggle(item, !liked);
          }
        }, h(IconHeart, { size: 15, style: liked ? { fill: "currentColor" } : void 0 }));
      }
      function DislikeButton({ t, item, likes, useLikes }) {
        const disliked = useLikes((st) => !!(st.dislikes || {})[likeKey(item)]);
        return h("button", {
          type: "button",
          className: cx("dshm-like-btn", "dshm-dislike-btn", disliked && "dshm-dislike-btn-on"),
          "aria-label": disliked ? t("undislikeBtn") : t("dislikeBtn"),
          "aria-pressed": !!disliked,
          title: disliked ? t("undislikedBtn") : t("dislikeBtn"),
          onClick: (e) => {
            e.stopPropagation();
            likes.setDislike(item, !disliked);
          }
        }, h(IconThumbDown, { size: 15, style: disliked ? { fill: "currentColor" } : void 0 }));
      }
      function TrackRow({ track: track2, index, isCurrent, playing, onPlay, onDelete, onReveal, onOpenArtist, likes, useLikes, t, muted, pending }) {
        return h(
          "div",
          {
            className: cx("dshm-row", isCurrent && "dshm-row-current", muted && "dshm-row-off"),
            role: "button",
            tabIndex: 0,
            "aria-label": t("playTrack") + ": " + track2.title,
            onClick: () => onPlay(track2, index),
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPlay(track2, index);
              }
            }
          },
          h(Cover, { track: track2, size: 40 }),
          h(
            "div",
            { className: "dshm-row-info" },
            h(
              "div",
              { className: "dshm-row-title" },
              isCurrent ? h(EqBars, { playing }) : null,
              h("span", { className: "dshm-ellipsis" }, track2.title || t("untitled"))
            ),
            h(
              "div",
              { className: "dshm-row-sub dshm-ellipsis" },
              onOpenArtist && track2.artist ? h("button", {
                type: "button",
                className: "dshm-row-sub-btn",
                title: t("artistOpen"),
                "aria-label": t("artistOpen"),
                onClick: (e) => {
                  e.stopPropagation();
                  onOpenArtist(track2.artist);
                }
              }, track2.artist) : track2.artist || t("unknownArtist"),
              track2.album ? " \xB7 " + track2.album : ""
            )
          ),
          h("span", { className: "dshm-row-dur" }, formatTime2(track2.duration)),
          likes ? h(LikeButton, { t, item: track2, likes, useLikes }) : null,
          likes ? h(DislikeButton, { t, item: track2, likes, useLikes }) : null,
          onDelete ? h(
            "span",
            { className: "dshm-row-actions", onClick: (e) => e.stopPropagation() },
            h(IconButton, { label: t("revealTrack"), onClick: (e) => {
              e.stopPropagation();
              onReveal(track2);
            } }, h(IconDisc, { size: 14 })),
            h(IconButton, { label: t("deleteTrack"), onClick: (e) => {
              e.stopPropagation();
              onDelete(track2);
            } }, h(IconClose, { size: 14 }))
          ) : null,
          h(
            "span",
            { className: cx("dshm-row-play", pending && "dshm-playround-busy"), "aria-hidden": true },
            pending ? h("span", { className: "dshm-spin" }) : h(IconPlay, { size: 15 })
          )
        );
      }
      function LibraryView({ t, player, library, sync, download, preview, likes, openArtistPage, artistImages, useSync, useDownload, useLibrary, usePlayer, useLikes, useArtistImages }) {
        const status = useLibrary((s) => s.status);
        const tracks = useLibrary((s) => s.tracks);
        const error = useLibrary((s) => s.error);
        const currentId = usePlayer((s) => s.track ? s.track.id : null);
        const playing = usePlayer((s) => s.playing);
        const [query, setQuery] = useState("");
        const [searchState, setSearchState] = useState({ status: "idle", local: [], remote: [] });
        const [groupBy, setGroupBy] = useState("none");
        const [libTab, setLibTab] = useState("library");
        const [rowError, setRowError] = useState("");
        const [playNotice, setPlayNotice] = useState("");
        const searchRef = useRef(null);
        const shuffle = usePlayer((s) => s.shuffle);
        const repeat = usePlayer((s) => s.repeat);
        const mode = modeMeta(t, shuffle, repeat);
        const syncAvail = useSync ? useSync((st) => st.available) : null;
        const syncHint = useSync ? useSync((st) => st.hint) : null;
        const syncUsable = syncAvail !== false;
        const syncState = useSync ? useSync((st) => st.phase) : "idle";
        const likeItems = useLikes((st) => st.items || []);
        const likedTracks = useMemo(() => likeItems.map((it) => ({
          id: it.trackId || "liked::" + it.key,
          title: it.title,
          artist: it.artist,
          album: it.album,
          duration: it.durationMs ? Math.round(it.durationMs / 1e3) : it.duration || 0,
          audioUrl: it.audioUrl || null,
          coverUrl: it.coverUrl || null,
          muted: !it.audioUrl
        })), [likeItems]);
        const likedPlayable = useMemo(() => likedTracks.filter((tr) => !!tr.audioUrl), [likedTracks]);
        useEffect(() => {
          const q = query.trim();
          if (!q) {
            setSearchState({ status: "idle", local: [], remote: [] });
            return;
          }
          setSearchState((s0) => ({ ...s0, status: "loading" }));
          const timer = setTimeout(() => {
            let dead = false;
            library.searchRemote ? library.searchRemote(q).then((data) => {
              if (!dead) setSearchState({ status: "ready", local: data && data.local || [], remote: data && data.remote || [] });
            }).catch((err) => {
              if (!dead) setSearchState({ status: "error", local: [], remote: [], error: err && err.message || String(err) });
            }) : null;
            return () => {
              dead = true;
            };
          }, 350);
          return () => clearTimeout(timer);
        }, [query]);
        function playRemote(item) {
          setPlayNotice("");
          playSong(item, player, tracks, preview, setPlayNotice, t);
        }
        const filtered = useMemo(() => {
          const q = normalizeZh(query.trim());
          if (!q) return tracks;
          return tracks.filter((tr) => normalizeZh(tr.title).includes(q) || normalizeZh(tr.artist).includes(q) || normalizeZh(tr.album).includes(q));
        }, [tracks, query]);
        const likedFiltered = useMemo(() => {
          const q = normalizeZh(query.trim());
          if (!q) return likedTracks;
          return likedTracks.filter((tr) => normalizeZh(tr.title).includes(q) || normalizeZh(tr.artist).includes(q) || normalizeZh(tr.album).includes(q));
        }, [likedTracks, query]);
        const searching = !!query.trim();
        const shownList = searching && searchState.status === "ready" ? searchState.local : filtered;
        const groups = useMemo(() => {
          if (groupBy === "none" || searching) return null;
          const map = /* @__PURE__ */ new Map();
          for (const tr of shownList) {
            const key = (groupBy === "artist" ? tr.artist : tr.album) || (groupBy === "artist" ? t("unknownArtist") : t("unknownAlbum"));
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(tr);
          }
          return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
        }, [shownList, groupBy, searching, t]);
        const playFromFiltered = useCallback((track2) => {
          const index = shownList.indexOf(track2);
          player.playTracks(shownList, index >= 0 ? index : 0);
        }, [shownList, player]);
        async function onDelete(track2) {
          const liked = track2.source === "spotify-liked";
          if (liked) {
            if (!window.confirm(t("deleteLikedConfirm"))) return;
            if (!window.confirm(t("deleteLikedConfirm2"))) return;
          } else if (!window.confirm(t("deleteConfirm"))) return;
          try {
            setRowError("");
            await library.remove(track2.id, true);
          } catch (err) {
            setRowError(err && err.message || t("deleteFailed"));
          }
        }
        async function onReveal(track2) {
          try {
            setRowError("");
            await library.reveal(track2.id);
          } catch (err) {
            setRowError(err && err.message || t("deleteFailed"));
          }
        }
        function playLiked(track2) {
          if (!track2.audioUrl) {
            setPlayNotice(t("topUnplayable"));
            return;
          }
          setPlayNotice("");
          const idx = likedPlayable.indexOf(track2);
          player.playTracks(likedPlayable, idx >= 0 ? idx : 0);
        }
        const renderRow = (tr, i) => h(TrackRow, {
          key: tr.id || i,
          track: tr,
          index: i,
          isCurrent: currentId === tr.id,
          playing,
          onPlay: playFromFiltered,
          onDelete,
          onReveal,
          onOpenArtist: openArtistPage,
          likes,
          useLikes,
          t
        });
        function RemoteRow(item, i) {
          const isArtist = item.kind === "artist";
          const name = isArtist ? item.name || item.artist || "" : item.title || "";
          const sub = isArtist ? t("searchTypeArtist") : (item.artist || "") + (item.album ? " \xB7 " + item.album : "");
          return h(
            "div",
            { className: "dshm-row", key: "r" + i, role: "listitem" },
            isArtist ? h(ArtistAvatar, { name, size: 40, service: artistImages, useArtistImages }) : h("div", { className: "dshm-tile", style: { width: 40, height: 40 } }, h(IconNote, { size: 15 })),
            h(
              "div",
              { className: "dshm-row-info" },
              h(
                "div",
                { className: "dshm-row-title" },
                isArtist ? h("span", { className: "dshm-cat-chip" }, t("searchTypeArtist")) : null,
                h("span", { className: "dshm-ellipsis" }, name)
              ),
              h(
                "div",
                { className: "dshm-row-sub dshm-ellipsis" },
                isArtist || !item.artist ? sub : h(
                  React.Fragment,
                  null,
                  h("button", {
                    type: "button",
                    className: "dshm-row-sub-btn",
                    title: t("artistOpen"),
                    "aria-label": t("artistOpen"),
                    onClick: () => openArtistPage(item.artist)
                  }, item.artist),
                  item.album ? " \xB7 " + item.album : ""
                )
              )
            ),
            isArtist ? h("button", {
              type: "button",
              className: "dshm-chipbtn",
              onClick: () => openArtistPage(name)
            }, h(IconNote, { size: 13 }), t("artistOpen")) : h("button", {
              type: "button",
              className: "dshm-chipbtn",
              onClick: () => playRemote(item),
              title: t("previewLabel")
            }, h(IconPlay, { size: 13 }), t("previewLabel"))
          );
        }
        let content;
        const remoteList = searching && searchState.status === "ready" ? searchState.remote : [];
        if (libTab === "likes") {
          content = likeItems.length === 0 ? h(EmptyState, {
            icon: h(IconHeart, { size: 28 }),
            title: t("likesEmptyTitle"),
            body: t("likesEmptyBody")
          }, h("button", {
            type: "button",
            className: "dshm-chipbtn dshm-chipbtn-primary",
            onClick: () => setLibTab("library")
          }, h(IconNote, { size: 14 }), t("goLibrary"))) : likedFiltered.length === 0 ? h(EmptyState, {
            icon: h(IconSearch, { size: 28 }),
            title: "\u201C" + query.trim() + "\u201D",
            body: t("searchNoLocal")
          }) : h(
            "div",
            { className: "dshm-list" },
            likedFiltered.map((tr, i) => h(TrackRow, {
              key: tr.id || "liked" + i,
              track: tr,
              index: i,
              isCurrent: currentId === tr.id,
              playing,
              muted: tr.muted,
              onPlay: playLiked,
              onOpenArtist: openArtistPage,
              likes,
              useLikes,
              t
            }))
          );
        } else if (status === "loading" && tracks.length === 0) {
          content = h("div", { className: "dshm-list" }, h(SkeletonRows));
        } else if (status === "error" && tracks.length === 0) {
          content = h(EmptyState, {
            icon: h(IconAlert, { size: 30 }),
            tone: "error",
            title: t("loadError"),
            body: (error || "") + " " + t("scanFailedHint")
          }, h("button", { type: "button", className: "dshm-chipbtn", onClick: () => library.load() }, t("retry")));
        } else if (status === "ready" && tracks.length === 0) {
          content = h(
            EmptyState,
            {
              icon: h(IconNote, { size: 30 }),
              title: t("emptyLibraryTitle"),
              body: t("emptyLibraryBody")
            },
            h(
              "div",
              { className: "dshm-empty-ctas" },
              h("button", {
                type: "button",
                className: "dshm-chipbtn dshm-chipbtn-primary",
                onClick: () => {
                  if (searchRef.current) searchRef.current.focus();
                }
              }, h(IconSearch, { size: 14 }), t("emptySearchCta")),
              h("button", {
                type: "button",
                className: "dshm-chipbtn",
                onClick: () => library.rescan()
              }, h(IconRefresh, { size: 14 }), t("emptyRescanCta")),
              sync ? h("button", {
                type: "button",
                className: cx("dshm-chipbtn", !syncUsable && "dshm-chipbtn-off"),
                disabled: !syncUsable || syncState === "running",
                title: syncUsable ? syncHint || t("syncOptionalHint") : syncHint || t("syncUnavailableHint"),
                onClick: () => sync.start()
              }, h(IconRefresh, { size: 14, className: syncState === "running" ? "dshm-spin" : void 0 }), t("syncOptional")) : null
            ),
            h(
              "div",
              { className: "dshm-empty-dirs" },
              h("div", { className: "dshm-empty-dirs-head" }, t("emptyAddDirHint")),
              ["~/Music/dsh-music", "~/Music/spotify-liked", "~/Music/Music/Media.localized"].map((d) => h("code", { key: d, className: "dshm-empty-dir" }, d)),
              h("div", { className: "dshm-count" }, t("emptyDirNote"))
            )
          );
        } else if (searching && searchState.status === "loading") {
          content = h("div", { className: "dshm-list" }, h(SkeletonRows));
        } else if (shownList.length === 0 && remoteList.length === 0) {
          content = h(EmptyState, {
            icon: h(IconSearch, { size: 28 }),
            title: query.trim() ? "\u201C" + query.trim() + "\u201D" : t("searchEmpty"),
            body: query.trim() ? t("searchNoLocal") : t("searchEmpty")
          });
        } else {
          content = h(
            "div",
            { className: "dshm-list" },
            groups ? groups.map(([name, list]) => h(
              "section",
              { key: name },
              h(
                "div",
                { className: "dshm-group-head" },
                groupBy === "artist" && name !== t("unknownArtist") ? h(ArtistAvatar, { name, size: 20, service: artistImages, useArtistImages }) : h(groupBy === "artist" ? IconNote : IconDisc, { size: 14 }),
                h("span", { className: "dshm-ellipsis" }, name),
                h("span", { className: "dshm-group-count" }, list.length + " " + t("tracksUnit"))
              ),
              list.map((tr, i) => renderRow(tr, i))
            )) : shownList.map((tr, i) => renderRow(tr, i)),
            remoteList.length > 0 ? h(
              "section",
              null,
              h(
                "div",
                { className: "dshm-group-head" },
                h(IconSearch, { size: 14 }),
                h("span", { className: "dshm-ellipsis" }, t("searchWebTitle")),
                h("span", { className: "dshm-group-count" }, remoteList.length + " " + t("tracksUnit"))
              ),
              remoteList.map((item, i) => RemoteRow(item, i))
            ) : null,
            shownList.length === 0 && remoteList.length > 0 && searching ? h("div", { className: "dshm-lyrics-hint", style: { padding: "4px 8px" } }, t("searchNoLocal")) : null
          );
        }
        const busy = status === "loading";
        return h(
          React.Fragment,
          null,
          sync ? h(SyncPanel, { t, sync, useSync }) : null,
          rowError ? h("div", { className: "dshm-errorline", role: "alert", style: { margin: "8px 24px 0" } }, rowError) : null,
          libTab === "likes" ? h(
            "div",
            { className: "dshm-libtabs" },
            h("button", {
              type: "button",
              className: "dshm-chipbtn",
              onClick: () => setLibTab("library")
            }, "\u2190 " + t("favsBack")),
            h("span", { className: "dshm-favs-title", style: { marginLeft: "4px" } }, t("libTabLikes")),
            h("span", { className: "dshm-count" }, likeItems.length + " " + t("tracksUnit"))
          ) : h(
            "div",
            { className: "dshm-favs" },
            h(
              "div",
              { className: "dshm-favs-head" },
              h(IconHeart, { size: 14, style: { color: "var(--dsw-alias-state-error-primary)" } }),
              h("span", { className: "dshm-favs-title" }, t("favsTitle")),
              likeItems.length ? h("span", { className: "dshm-count" }, likeItems.length + " " + t("tracksUnit")) : null,
              likeItems.length ? h("button", {
                type: "button",
                className: "dshm-chipbtn dshm-favs-all",
                onClick: () => setLibTab("likes")
              }, t("favsViewAll"), " \u203A") : null
            ),
            likeItems.length === 0 ? h("div", { className: "dshm-favs-empty" }, h(IconHeart, { size: 16 }), t("favsEmpty")) : h(
              "div",
              { className: "dshm-favs-rail" },
              likedTracks.slice(0, 12).map((tr, i) => h(
                "button",
                {
                  key: tr.id || "fav" + i,
                  type: "button",
                  className: cx("dshm-favcard", tr.muted && "dshm-favcard-off"),
                  title: tr.muted ? t("topUnplayable") : (tr.title || "") + (tr.artist ? " \xB7 " + tr.artist : ""),
                  onClick: () => playLiked(tr)
                },
                h(
                  "span",
                  { className: "dshm-favcard-cover" },
                  h(Thumb, { src: tr.coverUrl, size: 96 }),
                  h("span", { className: "dshm-favcard-heart" }, h(IconHeart, { size: 11, style: { fill: "currentColor" } }))
                ),
                h("span", { className: "dshm-favcard-title dshm-ellipsis" }, tr.title || t("untitled")),
                h("span", { className: "dshm-favcard-sub dshm-ellipsis" }, tr.artist || t("unknownArtist"))
              )),
              h(
                "button",
                {
                  type: "button",
                  className: "dshm-favcard dshm-favcard-more",
                  onClick: () => setLibTab("likes")
                },
                h(IconQueue, { size: 18 }),
                h("span", { className: "dshm-favcard-more-label" }, t("favsViewAll")),
                h("span", { className: "dshm-count" }, likeItems.length)
              )
            )
          ),
          h(
            "div",
            { className: "dshm-toolbar" },
            h(
              "label",
              { className: "dshm-search" },
              h(IconSearch, { size: 15 }),
              h("input", {
                type: "search",
                value: query,
                placeholder: t("searchPlaceholder"),
                ref: searchRef,
                "aria-label": t("searchPlaceholder"),
                onChange: (e) => setQuery(e.target.value)
              })
            ),
            h(
              "select",
              {
                className: "dshm-select",
                value: groupBy,
                "aria-label": t("groupLabel"),
                onChange: (e) => setGroupBy(e.target.value)
              },
              libTab === "library" ? h(
                React.Fragment,
                null,
                h("option", { value: "none" }, t("groupNone")),
                h("option", { value: "artist" }, t("groupArtist")),
                h("option", { value: "album" }, t("groupAlbum"))
              ) : null
            ),
            h("button", {
              type: "button",
              className: "dshm-chipbtn dshm-chipbtn-primary",
              disabled: busy || (libTab === "likes" ? likedPlayable.length === 0 : shownList.length === 0),
              onClick: () => player.playAll(libTab === "likes" ? likedPlayable : shownList)
            }, h(IconPlay, { size: 13 }), libTab === "likes" ? t("playLikes") : t("playAll")),
            h("button", {
              type: "button",
              className: cx("dshm-chipbtn", "dshm-mode-cycle"),
              "aria-label": mode.label,
              title: mode.hint + " \xB7 " + t("modeCycleHint"),
              onClick: () => player.cycleMode()
            }, h(mode.icon, { size: 14 })),
            sync ? h(
              "button",
              {
                type: "button",
                className: cx("dshm-chipbtn", !syncUsable && "dshm-chipbtn-off"),
                disabled: syncState === "running" || busy || !syncUsable,
                title: syncUsable ? syncHint || t("syncOptionalHint") : syncHint || t("syncUnavailableHint"),
                onClick: () => sync.start()
              },
              h(IconRefresh, { size: 13, className: syncState === "running" ? "dshm-spin" : void 0 }),
              syncState === "running" ? t("syncing") : t("syncBtn")
            ) : null,
            h(
              "span",
              { className: "dshm-count", style: { marginLeft: "auto" } },
              busy && tracks.length === 0 ? t("rescanning") : (libTab === "likes" ? likedFiltered.length : shownList.length) + " " + t("tracksUnit")
            )
          ),
          playNotice ? h("div", { className: "dshm-mode-hint", style: { margin: "0 20px 6px", textAlign: "right" }, role: "status" }, playNotice) : null,
          content
        );
      }
      function NowPlayingView({ t, player, lyrics, usePlayer, useLyrics, openView, openArtistPage, artistImages, useArtistImages }) {
        const track2 = usePlayer((s) => s.track);
        const playing = usePlayer((s) => s.playing);
        const position = usePlayer((s) => s.position);
        const duration = usePlayer((s) => s.duration);
        const volume = usePlayer((s) => s.volume);
        const muted = usePlayer((s) => s.muted);
        const shuffle = usePlayer((s) => s.shuffle);
        const repeat = usePlayer((s) => s.repeat);
        const mode = modeMeta(t, shuffle, repeat);
        const error = usePlayer((s) => s.error);
        const queue = usePlayer((s) => s.queue);
        const queueIndex = usePlayer((s) => s.queueIndex);
        if (!track2) {
          return h(EmptyState, {
            icon: h(IconDisc, { size: 30 }),
            title: t("noTrackTitle"),
            body: t("noTrackBody")
          }, h("button", { type: "button", className: "dshm-chipbtn dshm-chipbtn-primary", onClick: () => openView("library") }, h(IconNote, { size: 14 }), t("goLibrary")));
        }
        const frac = duration > 0 ? position / duration : 0;
        const RepeatIcon = repeat === "one" ? IconRepeatOne : IconRepeat;
        const repeatLabel = repeat === "one" ? t("repeatOne") : repeat === "all" ? t("repeatAll") : t("repeatOff");
        return h(
          "div",
          { className: "dshm-now" },
          h(
            "div",
            { className: "dshm-now-hero" },
            h(Cover, { track: track2, className: "dshm-now-cover" }),
            h(
              "div",
              { className: "dshm-now-meta" },
              h("span", { className: "dshm-source-chip" }, h(IconDisc, { size: 12 }), sourceLabel(track2.source, t)),
              h("h2", { className: "dshm-now-title dshm-ellipsis" }, track2.title),
              h(
                "p",
                { className: "dshm-now-sub dshm-ellipsis" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dshm-artist-btn",
                    title: t("artistOpen"),
                    "aria-label": t("artistOpen"),
                    onClick: () => openArtistPage(track2.artist || "")
                  },
                  h(ArtistAvatar, { name: track2.artist || "", size: 18, service: artistImages, useArtistImages }),
                  h("span", null, track2.artist || t("unknownArtist"))
                ),
                track2.album ? " \xB7 " + track2.album : ""
              ),
              error ? h("div", { className: "dshm-errorline", role: "alert" }, h(IconAlert, { size: 15 }), error) : null,
              h(
                "div",
                { className: "dshm-seekrow" },
                h("span", { className: "dshm-time" }, formatTime2(position)),
                h(Slider, {
                  value: frac,
                  label: t("seekLabel"),
                  disabled: !(duration > 0),
                  onChange: (f) => player.seek(f * duration)
                }),
                h("span", { className: "dshm-time dshm-time-end" }, formatTime2(duration))
              ),
              h(
                "div",
                { className: "dshm-transport" },
                h(IconButton, {
                  label: mode.label,
                  title: mode.hint + " \xB7 " + t("modeCycleHint"),
                  className: cx((shuffle || repeat === "one") && "dshm-iconbtn-active"),
                  onClick: () => player.cycleMode()
                }, h(mode.icon, { size: 17 })),
                h(IconButton, { label: t("prev"), onClick: () => player.prev() }, h(IconPrev, { size: 20 })),
                h("button", {
                  type: "button",
                  className: "dshm-playbtn",
                  "aria-label": playing ? t("pause") : t("play"),
                  onClick: () => player.toggle()
                }, h(playing ? IconPause : IconPlay, { size: 22 })),
                h(IconButton, { label: t("next"), onClick: () => player.next() }, h(IconNext, { size: 20 }))
              ),
              h(
                "div",
                { className: "dshm-volumerow" },
                h(
                  IconButton,
                  { label: muted ? t("unmute") : t("mute"), onClick: () => player.toggleMute() },
                  h(muted || volume === 0 ? IconMute : IconVolume, { size: 17 })
                ),
                h(Slider, { value: muted ? 0 : volume, label: t("volume"), onChange: (f) => player.setVolume(f) }),
                h("span", { className: "dshm-volume-pct" }, Math.round((muted ? 0 : volume) * 100) + "%")
              )
            )
          ),
          h(LyricsPanel, { t, lyrics, useLyrics, usePlayer }),
          h(
            "div",
            { className: "dshm-queue" },
            h(
              "div",
              { className: "dshm-queue-head" },
              h(IconQueue, { size: 15 }),
              t("queue"),
              h("span", { className: "dshm-count" }, queue.length + " " + t("tracksUnit"))
            ),
            queue.length === 0 ? h("div", { className: "dshm-state-body", style: { padding: "12px 8px" } }, t("queueEmpty")) : queue.map((tr, i) => h(TrackRow, {
              key: (tr.id || "") + ":" + i,
              track: tr,
              index: i,
              isCurrent: i === queueIndex,
              playing: playing && i === queueIndex,
              onPlay: (_tr, idx) => player.jumpTo(idx),
              onOpenArtist: openArtistPage,
              t
            }))
          )
        );
      }
      function DownloadPanel({ t, download, useDownload }) {
        const s = useDownload((st) => st);
        if (!s.running && s.items.length === 0 && !s.error) return null;
        const anyOk = s.items.some((it) => it.status === "ok");
        return h(
          "div",
          { className: "dshm-dl" },
          h(
            "div",
            { className: "dshm-asec-title" },
            h(IconDownload, { size: 13 }),
            t("downloadTitle"),
            s.running ? h("span", { className: "dshm-count" }, s.done + " / " + s.total) : null
          ),
          s.total > 0 ? h(
            "div",
            { className: "dshm-dl-bar", "aria-hidden": true },
            h("div", { style: { width: Math.round(s.done / s.total * 100) + "%" } })
          ) : null,
          s.error ? h("div", { className: "dshm-errorline", role: "alert" }, h(IconAlert, { size: 14 }), t("downloadError") + "\uFF1A" + s.error) : null,
          s.items.map((it, i) => h(
            "div",
            { className: "dshm-dl-row", key: i },
            h("span", { className: cx("dshm-dl-dot", it.status === "ok" && "dshm-dl-ok", it.status === "fail" && "dshm-dl-fail") }),
            h(
              "span",
              { className: "dshm-ellipsis", style: { flex: 1 } },
              (it.artist || "") + " - " + (it.title || "")
            ),
            h(
              "span",
              { className: "dshm-dl-status" },
              it.status === "ok" ? t("downloadDone") : it.status === "fail" ? t("downloadFail") : t("downloading")
            ),
            it.status === "fail" && it.note ? h("span", { className: "dshm-sim-chip-reason" }, it.note) : null
          )),
          !s.running && anyOk ? h("div", { className: "dshm-lyrics-hint" }, t("downloadPlay")) : null
        );
      }
      function playSong(item, player, tracks, preview, setNotice, t, warm) {
        const local = item.trackId && tracks.find((tr) => tr.id === item.trackId) || tracks.find((tr) => normalizeZh(tr.artist) === normalizeZh(item.artist) && normalizeZh(tr.title) === normalizeZh(item.title));
        if (local) {
          setNotice("");
          player.playTracks([local], 0);
          return;
        }
        if (!item.verification) {
          setNotice(t("previewNoVerify"));
          return;
        }
        setNotice("");
        if (warm) {
          warm.playOne(item).then((res) => {
            if (res && res.error) setNotice(t("previewFail") + "\uFF1A" + res.error);
          });
          return;
        }
        setNotice(t("previewLoading"));
        preview.start(item, (res) => {
          if (res.error) {
            setNotice(t("previewFail") + "\uFF1A" + res.error);
            return;
          }
          setNotice("");
          player.playTracks([previewTrack(item, res.audioUrl)], 0);
        });
      }
      function imgUrl(url) {
        return /^https?:\/\//i.test(String(url || "")) ? url : resolveUrl(url);
      }
      function Thumb({ src, size, round: round2, glyph, style, className }) {
        const [failed, setFailed] = useState(false);
        const s = size || 38;
        const box = {
          width: s,
          height: s,
          borderRadius: round2 ? "50%" : 8,
          flex: "none",
          ...style
        };
        if (src && !failed) {
          return h(
            "div",
            { className: cx("dshm-tile", className), style: box },
            h("img", {
              src: imgUrl(src),
              alt: "",
              loading: "lazy",
              draggable: false,
              onError: () => setFailed(true)
            })
          );
        }
        return h(
          "div",
          { className: cx("dshm-tile", className), style: box },
          h(glyph || IconNote, { size: Math.max(12, Math.round(s * 0.4)) })
        );
      }
      function ArtistAvatar({ name, size, service, useArtistImages }) {
        const key = normalizeZh(name).trim();
        const url = useArtistImages((s) => key ? s.images[key] : null);
        useEffect(() => {
          if (name) service.request(name);
        }, [name]);
        return h(Thumb, { src: url || null, size: size || 20, round: true, glyph: IconNote });
      }
      function SongRow({ t, item, likes, useLikes, onPlay, onOpenArtist, isCurrent, playing, showReason, warm, useWarm }) {
        const liked = useLikes((st) => !!st.keys[likeKey(item)]);
        const pending = warm && useWarm ? !!useWarm((st) => !!(st.pending && st.pending[likeKey(item)])) : false;
        return h(
          "div",
          { className: cx("dshm-srow", isCurrent && "dshm-row-current") },
          h(Thumb, { src: item.coverUrl, size: 38 }),
          h(
            "div",
            {
              className: "dshm-srow-main",
              role: "button",
              tabIndex: 0,
              "aria-label": t("playTrack") + ": " + (item.title || ""),
              onClick: () => onPlay(item),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPlay(item);
                }
              }
            },
            h("span", { className: "dshm-srow-title dshm-ellipsis" }, item.title || t("untitled")),
            h(
              "span",
              { className: "dshm-srow-sub dshm-ellipsis" },
              onOpenArtist && item.artist ? h("button", {
                type: "button",
                className: "dshm-srow-artist",
                title: t("artistOpen"),
                "aria-label": t("artistOpen"),
                onClick: (e) => {
                  e.stopPropagation();
                  onOpenArtist(item.artist);
                }
              }, item.artist) : item.artist || t("unknownArtist"),
              item.album ? " \xB7 " + item.album : ""
            ),
            showReason && item.reason ? h("span", { className: "dshm-srow-reason" }, item.reason) : null
          ),
          h("button", {
            type: "button",
            className: cx("dshm-like-btn", liked && "dshm-like-btn-on"),
            "aria-label": liked ? t("unlikeBtn") : t("likeBtn"),
            "aria-pressed": !!liked,
            title: liked ? t("likedBtn") : t("likeBtn"),
            onClick: () => likes.toggle(item, !liked)
          }, h(IconHeart, { size: 15, style: liked ? { fill: "currentColor" } : void 0 })),
          likes ? h(DislikeButton, { t, item, likes, useLikes }) : null,
          h("button", {
            type: "button",
            className: cx("dshm-playround", pending && "dshm-playround-busy"),
            "aria-label": pending ? t("previewLoading") : isCurrent && playing ? t("pause") : t("play"),
            "aria-busy": pending ? "true" : void 0,
            disabled: !!pending,
            title: pending ? t("previewLoading") : isCurrent && playing ? t("pause") : t("previewLabel"),
            onClick: () => onPlay(item)
          }, pending ? h("span", { className: "dshm-spin", "aria-hidden": true }) : h(isCurrent && playing ? IconPause : IconPlay, { size: 13 }))
        );
      }
      function ArtistTile({ t, a, onOpen }) {
        return h(
          "button",
          {
            type: "button",
            className: "dshm-arow",
            onClick: () => onOpen(a.name),
            title: a.reason || t("artistOpen") + ": " + (a.name || "")
          },
          h(Thumb, { src: a.imageUrl, size: 44, round: true, glyph: IconNote }),
          h(
            "span",
            { className: "dshm-arow-text" },
            h("span", { className: "dshm-srow-title dshm-ellipsis" }, a.name || ""),
            a.genreHint ? h("span", { className: "dshm-srow-sub dshm-ellipsis" }, a.genreHint) : null
          ),
          h("span", { className: "dshm-arow-arrow", "aria-hidden": true }, "\u203A")
        );
      }
      function RecoView({ t, reco, download, player, library, likes, preview, history, openArtistPage, warm, useReco, useDownload, useLibrary, useLikes, usePlayer, useHistory, useWarm }) {
        const s = useReco((st) => st);
        const histStats = useHistory ? useHistory((st) => st.stats) : null;
        const coldStart = !(histStats && histStats.totalPlays > 0);
        const finishedAt = useDownload((st) => st.finishedAt);
        const tracks = useLibrary((st) => st.tracks);
        const currentId = usePlayer((st) => st.track ? st.track.id : null);
        const playing = usePlayer((st) => st.playing);
        const [notice, setNotice] = useState("");
        const [styleQ, setStyleQ] = useState("");
        const [styleState, setStyleState] = useState({ status: "idle", q: "", items: [], interpretedTags: [], fallback: false, message: null, error: null });
        function runStyle() {
          const q = styleQ.trim();
          if (!q || styleState.status === "loading") return;
          setStyleState({ status: "loading", q, items: [], interpretedTags: [], fallback: false, message: null, error: null });
          reco.searchStyle(q).then((data) => setStyleState({
            status: "ready",
            q,
            items: data && data.items || [],
            interpretedTags: data && data.interpretedTags || [],
            matchedTerms: data && data.matchedTerms || [],
            fallback: !!(data && data.fallback),
            message: data && data.message || null,
            error: null
          })).catch((err) => setStyleState({ status: "error", q, items: [], interpretedTags: [], fallback: false, message: null, error: err && err.message || String(err) }));
        }
        useEffect(() => {
          if (finishedAt) library.load();
        }, [finishedAt]);
        useEffect(() => {
          reco.load();
        }, []);
        function findLocal(item) {
          return item.trackId && tracks.find((tr) => tr.id === item.trackId) || tracks.find((tr) => normalizeZh(tr.artist) === normalizeZh(item.artist) && normalizeZh(tr.title) === normalizeZh(item.title));
        }
        function onPlay(item) {
          playSong(item, player, tracks, preview, setNotice, t, warm);
        }
        function playListFrom(list, item) {
          const localTracks = [];
          let at = 0;
          for (const it of list) {
            const lc = findLocal(it);
            if (!lc || localTracks.some((tr) => tr.id === lc.id)) continue;
            if (it === item) at = localTracks.length;
            localTracks.push(lc);
          }
          if (localTracks.length) player.playTracks(localTracks, at);
          else if (list.length) onPlay(item || list[0]);
        }
        function playColumn(list) {
          if (!warm) {
            playListFrom(list, null);
            return;
          }
          warm.playList(list, findLocal).then((res) => {
            if (res && res.error) setNotice(t("previewFail") + "\uFF1A" + res.error);
          });
        }
        const sections = s.sections || { today: s.items, artist: [], new: [] };
        const styleActive = styleState.status !== "idle";
        function isCur(item) {
          const lc = findLocal(item);
          return lc ? currentId === lc.id : currentId === "preview:" + likeKey(item);
        }
        function songRows(list, showReason) {
          if (!list.length) return h("div", { className: "dshm-lyrics-hint" }, t("recoSectionEmpty"));
          return list.map((item, i) => h(SongRow, {
            key: i,
            t,
            item,
            likes,
            useLikes,
            onPlay: (it) => playListFrom(list, it),
            onOpenArtist: openArtistPage,
            showReason,
            isCurrent: isCur(item),
            playing,
            warm,
            useWarm
          }));
        }
        function colRefresh(axis) {
          const refreshing = s.refreshing || {};
          const busy = !!refreshing[axis];
          return h("button", {
            type: "button",
            className: cx("dshm-chipbtn dshm-col-refresh", busy && "dshm-chipbtn-busy"),
            disabled: busy,
            title: t("recoRefreshHint"),
            "aria-label": t("recoRefresh"),
            "aria-busy": busy ? "true" : void 0,
            onClick: () => reco.refresh(axis)
          }, busy ? h("span", { className: "dshm-spin", "aria-hidden": true }) : h(IconRefresh, { size: 12 }));
        }
        function colRefreshBanner(axis) {
          const refreshing = s.refreshing || {};
          if (!refreshing[axis]) return null;
          return h(
            "div",
            { className: "dshm-col-loading", role: "status" },
            h("span", { className: "dshm-spin", "aria-hidden": true }),
            t("recoRefreshing")
          );
        }
        function column(headKey, icon, list, extraHead, axis) {
          return h(
            "section",
            { className: "dshm-column", key: headKey },
            h(
              "div",
              { className: "dshm-col-head" },
              h("div", { className: "dshm-col-title" }, h(icon, { size: 14 }), t(headKey)),
              h("span", { className: "dshm-col-count" }, list.length + " " + t("tracksUnit")),
              h("div", { className: "dshm-col-actions" }, axis ? colRefresh(axis) : null, extraHead)
            ),
            colRefreshBanner(axis),
            h("div", { className: "dshm-col-list" }, songRows(list, true))
          );
        }
        const toolbar = h(
          "div",
          { className: "dshm-toolbar dshm-toolbar-flat" },
          h(
            "label",
            { className: "dshm-search", style: { maxWidth: "280px" } },
            h(IconSearch, { size: 15 }),
            h("input", {
              type: "search",
              value: styleQ,
              placeholder: t("stylePlaceholder"),
              "aria-label": t("styleBtn"),
              onChange: (e) => setStyleQ(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") runStyle();
              }
            })
          ),
          h("button", { type: "button", className: "dshm-chipbtn", disabled: !styleQ.trim(), onClick: runStyle }, t("styleBtn")),
          notice ? h("span", { className: "dshm-mode-hint", style: { margin: "0 0 0 8px", flex: "1", minWidth: "120px" } }, notice) : null,
          h("button", {
            type: "button",
            className: "dshm-chipbtn",
            style: { marginLeft: "auto" },
            disabled: s.status === "generating",
            onClick: () => reco.generate()
          }, h(IconSparkles, { size: 13 }), t("recoRegenerate"))
        );
        if (s.status === "generating") {
          return h(
            "div",
            { className: "dshm-reco-page" },
            toolbar,
            h(
              "div",
              { className: "dshm-columns" },
              [0, 1, 2].map((i) => h(
                "section",
                { className: "dshm-column", key: i },
                h(
                  "div",
                  { className: "dshm-col-head" },
                  h("div", { className: "dshm-col-title" }, h(IconSparkles, { size: 14, className: "dshm-state-spin" }), t("recoGenerating"))
                ),
                h("div", { className: "dshm-col-list" }, h(SkeletonRows))
              ))
            )
          );
        }
        if (s.status === "error") {
          return h(
            "div",
            { className: "dshm-reco-page" },
            toolbar,
            h(EmptyState, {
              icon: h(IconAlert, { size: 30 }),
              tone: "error",
              title: t("recoError"),
              body: s.error || ""
            }, h("button", { type: "button", className: "dshm-chipbtn", onClick: () => reco.generate() }, t("lyricsRetry")))
          );
        }
        if (!styleActive && s.status !== "ready" && !s.sections) {
          return h(
            "div",
            { className: "dshm-reco-page" },
            toolbar,
            h(EmptyState, {
              icon: h(IconSparkles, { size: 30 }),
              title: coldStart ? t("recoColdTitle") : t("recoEmptyTitle"),
              body: coldStart ? t("recoColdBody") : t("recoEmptyBody")
            }, h(
              "button",
              { type: "button", className: "dshm-chipbtn dshm-chipbtn-primary", onClick: () => reco.generate() },
              h(IconSparkles, { size: 14 }),
              t("recoGenerate")
            ))
          );
        }
        if (styleActive) {
          return h(
            "div",
            { className: "dshm-reco-page" },
            toolbar,
            styleState.status === "loading" ? h(
              "div",
              { className: "dshm-state" },
              h("div", { className: "dshm-state-icon" }, h(IconSparkles, { size: 30, className: "dshm-state-spin" })),
              h("div", { className: "dshm-state-title" }, t("styleLoading"))
            ) : styleState.status === "error" ? h(
              EmptyState,
              { icon: h(IconAlert, { size: 30 }), tone: "error", title: t("styleError"), body: styleState.error || "" },
              h("button", { type: "button", className: "dshm-chipbtn", onClick: runStyle }, t("lyricsRetry"))
            ) : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "dshm-acard-meta", style: { padding: "10px 4px 0" } },
                h("button", { type: "button", className: "dshm-chipbtn", onClick: () => setStyleState({ status: "idle", q: "", items: [], interpretedTags: [], fallback: false, message: null, error: null }) }, t("backToReco")),
                h("button", {
                  type: "button",
                  className: "dshm-chipbtn dshm-chipbtn-primary",
                  disabled: styleState.items.length === 0,
                  title: t("playList"),
                  onClick: () => playListFrom(styleState.items, null)
                }, h(IconPlay, { size: 12 }), t("playList")),
                styleState.interpretedTags.length ? h("span", null, t("interpretedAs") + "\uFF1A" + (styleState.matchedTerms && styleState.matchedTerms.length ? styleState.matchedTerms.join("\u3001") + " \u2192 " : "") + styleState.interpretedTags.join(" / ")) : null,
                styleState.message ? h("span", { className: "dshm-sim-chip-reason" }, styleState.message) : null
              ),
              h("div", { className: "dshm-col-list", style: { maxHeight: "none" } }, songRows(styleState.items, true))
            )
          );
        }
        return h(
          "div",
          { className: "dshm-reco-page", style: { padding: "12px 16px 0", display: "flex", flexDirection: "column" } },
          toolbar,
          h(DownloadPanel, { t, download, useDownload }),
          s.bootstrapNote ? h(
            "div",
            { className: "dshm-explore-note", role: "note" },
            h(IconSparkles, { size: 13 }),
            h("span", { className: "dshm-explore-chip" }, t("exploreChip")),
            h("span", null, s.bootstrapNote)
          ) : null,
          s.refreshError ? h(
            "div",
            { className: "dshm-explore-note dshm-refresh-note", role: "alert" },
            h(IconAlert, { size: 13 }),
            h("span", null, s.refreshBusy ? t("recoRefreshBusy") : s.refreshError)
          ) : null,
          h(
            "div",
            { className: "dshm-columns" },
            column(
              "colToday",
              IconSparkles,
              sections.today || [],
              h("button", {
                type: "button",
                className: "dshm-chipbtn dshm-col-play",
                disabled: !(sections.today || []).length,
                onClick: () => playColumn(sections.today || [])
              }, h(IconPlay, { size: 12 }), t("playColumn")),
              "today"
            ),
            h(
              "section",
              { className: "dshm-column", key: "colArtist" },
              h(
                "div",
                { className: "dshm-col-head" },
                h("div", { className: "dshm-col-title" }, h(IconNote, { size: 14 }), t("colArtist")),
                h("span", { className: "dshm-col-count" }, (sections.artist || []).length + " " + t("tracksUnit")),
                h("div", { className: "dshm-col-actions" }, colRefresh("artist"))
              ),
              colRefreshBanner("artist"),
              h(
                "div",
                { className: "dshm-col-list" },
                (sections.artist || []).length === 0 ? h("div", { className: "dshm-lyrics-hint" }, t("recoSectionEmpty")) : (sections.artist || []).map((a, i) => h(ArtistTile, { key: i, t, a, onOpen: openArtistPage }))
              )
            ),
            column(
              "colNew",
              IconDisc,
              sections.new || [],
              h("button", {
                type: "button",
                className: "dshm-chipbtn dshm-col-play",
                disabled: !(sections.new || []).length,
                onClick: () => playColumn(sections.new || [])
              }, h(IconPlay, { size: 12 }), t("playColumn")),
              "new"
            )
          )
        );
      }
      function ArtistProfileSections({ t, data, onOpenArtist, artistImages, useArtistImages }) {
        if (!data) return null;
        const items = (list) => list && list.length ? list : null;
        return h(
          React.Fragment,
          null,
          data.intro && data.intro.text ? h(
            "section",
            { className: "dshm-asec" },
            h("div", { className: "dshm-asec-title" }, h(IconNote, { size: 13 }), t("artistIntro")),
            h(
              "div",
              { className: "dshm-acard" },
              h("div", { className: "dshm-acard-text" }, data.intro.text),
              h(CiteMeta, { item: data.intro, t })
            )
          ) : null,
          h(
            "section",
            { className: "dshm-asec" },
            h("div", { className: "dshm-asec-title" }, h(IconSparkles, { size: 13 }), t("artistNews")),
            items(data.news) ? data.news.map((n, i) => h(
              "div",
              { className: "dshm-acard", key: i },
              h("div", { className: "dshm-acard-text" }, n.text),
              h(CiteMeta, { item: n, t })
            )) : h("div", { className: "dshm-lyrics-hint" }, data && data.message || t("noSection"))
          ),
          h(
            "section",
            { className: "dshm-asec" },
            h("div", { className: "dshm-asec-title" }, h(IconQueue, { size: 13 }), t("artistTrivia")),
            items(data.trivia) ? data.trivia.map((n, i) => h(
              "div",
              { className: "dshm-acard", key: i },
              h("div", { className: "dshm-acard-text" }, n.text),
              h(
                "div",
                { className: "dshm-acard-meta" },
                n.kind ? h("span", { className: "dshm-kind-chip" }, n.kind === "rumor" ? t("kindRumor") : t("kindFact")) : null,
                h("span", null, (n.source || "") + (n.date ? " \xB7 " + n.date : "")),
                n.url ? h("a", { href: n.url, target: "_blank", rel: "noreferrer noopener" }, t("citeLink")) : null
              )
            )) : h("div", { className: "dshm-lyrics-hint" }, t("noSection"))
          ),
          h(
            "section",
            { className: "dshm-asec" },
            h("div", { className: "dshm-asec-title" }, h(IconDisc, { size: 13 }), t("artistSimilarArtists")),
            items(data.similarArtists) ? data.similarArtists.map((s, i) => h(
              "button",
              {
                key: i,
                type: "button",
                className: "dshm-sim-chip",
                title: s.reason || "",
                onClick: () => onOpenArtist(s.name)
              },
              h(ArtistAvatar, { name: s.name, size: 18, service: artistImages, useArtistImages }),
              h("span", null, s.name),
              s.reason ? h("span", { className: "dshm-sim-chip-reason" }, s.reason) : null
            )) : h("div", { className: "dshm-lyrics-hint" }, t("noSection"))
          ),
          items(data.similarSongs) ? h(
            "section",
            { className: "dshm-asec" },
            h("div", { className: "dshm-asec-title" }, h(IconPlay, { size: 13 }), t("artistSimilarSongs")),
            data.similarSongs.map((s, i) => h(
              "div",
              { className: "dshm-acard", key: i },
              h("div", { className: "dshm-acard-text" }, (s.title || "") + (s.artist ? " \xB7 " + s.artist : "")),
              s.reason ? h("div", { className: "dshm-sim-chip-reason" }, s.reason) : null,
              h(CiteMeta, { item: s, t })
            ))
          ) : null
        );
      }
      function ArtistPageView({ t, reco, player, likes, preview, library, openView, openArtistPage, artistImages, artistPage, useUi, useLikes, useLibrary, usePlayer, useArtistImages, useArtistPage }) {
        const name = useUi((s) => s.artistName);
        const tracks = useLibrary((st2) => st2.tracks);
        const currentId = usePlayer((st2) => st2.track ? st2.track.id : null);
        const playing = usePlayer((st2) => st2.playing);
        const pageKey = name ? normalizeZh(name).trim() : "";
        const cachedPage = useArtistPage ? useArtistPage((snap) => snap.pages[pageKey] || null) : null;
        const pageBusy = useArtistPage ? useArtistPage((snap) => !!snap.loading[pageKey]) : false;
        const [pageError, setPageError] = useState("");
        const [notice, setNotice] = useState("");
        useEffect(() => {
          if (!name || cachedPage || !artistPage) return void 0;
          let dead = false;
          setPageError("");
          artistPage.load(name).catch((err) => {
            if (!dead) setPageError(err && err.message || String(err));
          });
          return () => {
            dead = true;
          };
        }, [name, cachedPage]);
        const st = { status: cachedPage ? "ready" : pageError ? "error" : "loading", data: cachedPage, error: pageError };
        function onPlaySong(item) {
          playSong(item, player, tracks, preview, setNotice, t);
        }
        function isCur(item) {
          const lc = item.trackId && tracks.find((tr) => tr.id === item.trackId) || tracks.find((tr) => normalizeZh(tr.artist) === normalizeZh(item.artist) && normalizeZh(tr.title) === normalizeZh(item.title));
          return lc ? currentId === lc.id : currentId === "preview:" + likeKey(item);
        }
        const data = st.data || {};
        const profile = data.profile || null;
        const heroImg = data.bannerUrl || data.imageUrl || profile && profile.imageUrl || null;
        const thumbImg = data.thumbnailUrl || profile && (profile.imageUrl || profile.thumbnailUrl) || heroImg;
        const songs = data.songs || [];
        const ready = st.status === "ready";
        function playListFrom(list, item) {
          const localTracks = [];
          let at = 0;
          for (const it of list) {
            const lc = it.trackId && tracks.find((tr) => tr.id === it.trackId) || tracks.find((tr) => normalizeZh(tr.artist) === normalizeZh(it.artist) && normalizeZh(tr.title) === normalizeZh(it.title));
            if (!lc || localTracks.some((tr) => tr.id === lc.id)) continue;
            if (it === item) at = localTracks.length;
            localTracks.push(lc);
          }
          if (localTracks.length) player.playTracks(localTracks, at);
          else if (list.length) onPlaySong(item || list[0]);
        }
        return h(
          "div",
          { className: "dshm-apage" },
          h(
            "div",
            { className: "dshm-toolbar dshm-toolbar-flat" },
            h("button", { type: "button", className: "dshm-chipbtn", onClick: () => openView("reco") }, "\u2190 " + t("artistPageBack")),
            notice ? h("span", { className: "dshm-mode-hint", style: { marginLeft: "8px" } }, notice) : null,
            library && ready ? h("button", {
              type: "button",
              className: "dshm-chipbtn",
              disabled: !songs.length,
              style: { marginLeft: "auto" },
              title: t("playList"),
              onClick: () => playListFrom(songs, null)
            }, h(IconPlay, { size: 12 }), t("playList")) : null
          ),
          st.status === "loading" ? h(
            "div",
            { className: "dshm-state" },
            h("div", { className: "dshm-state-icon" }, h(IconNote, { size: 30 })),
            h("div", { className: "dshm-state-title" }, t("artistLoading"))
          ) : st.status === "error" ? h(EmptyState, { icon: h(IconAlert, { size: 30 }), tone: "error", title: t("artistError"), body: st.error || "" }) : h(
            React.Fragment,
            null,
            h(
              "div",
              { className: "dshm-apage-banner", "aria-hidden": true },
              heroImg ? h("img", {
                src: imgUrl(heroImg),
                alt: "",
                loading: "lazy",
                draggable: false,
                onError: (e) => {
                  e.currentTarget.style.display = "none";
                }
              }) : null,
              h("div", { className: "dshm-apage-banner-mask" }),
              h(IconNote, { size: 28 })
            ),
            h(
              "div",
              { className: "dshm-apage-hero" },
              h(
                "div",
                { className: "dshm-apage-ava-wrap", "aria-hidden": true },
                h(Thumb, { src: thumbImg, size: 96, round: true, glyph: IconNote })
              ),
              h(
                "div",
                { style: { minWidth: 0 } },
                h("h2", { className: "dshm-apage-name dshm-ellipsis" }, name || ""),
                h("div", { className: "dshm-count" }, songs.length + " " + t("artistSongs"))
              )
            ),
            profile ? h(ArtistProfileSections, { t, data: profile, onOpenArtist: openArtistPage, artistImages, useArtistImages }) : null,
            h(
              "section",
              { className: "dshm-asec", style: { marginTop: "18px" } },
              h("div", { className: "dshm-asec-title" }, h(IconPlay, { size: 13 }), t("artistSongs")),
              songs.length === 0 ? h("div", { className: "dshm-lyrics-hint" }, t("artistNoSongs")) : h(
                "div",
                { className: "dshm-col-list", style: { maxHeight: "none" } },
                songs.map((item, i) => h(SongRow, {
                  key: i,
                  t,
                  item,
                  likes,
                  useLikes,
                  onPlay: (it) => playListFrom(songs, it),
                  onOpenArtist: openArtistPage,
                  showReason: false,
                  isCurrent: isCur(item),
                  playing
                }))
              )
            )
          )
        );
      }
      function SyncPanel({ t, sync, useSync }) {
        const s = useSync((st) => st);
        if (s.phase === "idle" && !s.result && !s.error) return null;
        const r = s.result || {};
        const chips = [
          ["syncCloud", r.cloud],
          ["syncAdded", r.added],
          ["syncRemoved", r.removed],
          ["syncOk", r.ok],
          ["syncFail", r.fail],
          ["syncMissing", r.missing]
        ];
        const problems = (s.tracks || []).filter((tr) => tr && (tr.status === "fail" || tr.status === "missing"));
        return h(
          "div",
          { className: "dshm-sync", role: "status" },
          h(
            "div",
            { className: "dshm-asec-title" },
            h(IconRefresh, { size: 13, className: s.phase === "running" ? "dshm-spin" : void 0 }),
            s.phase === "running" ? t("syncing") : s.phase === "error" ? t("syncError") : t("syncBtn")
          ),
          s.error ? h("div", { className: "dshm-errorline", role: "alert" }, h(IconAlert, { size: 14 }), s.error) : null,
          s.phase !== "running" && s.result ? h(
            "div",
            { className: "dshm-sync-chips" },
            chips.map(([key, value]) => h(
              "span",
              { className: "dshm-sync-chip", key },
              t(key) + " " + (value == null ? "\u2014" : value)
            ))
          ) : null,
          problems.length ? h(
            "div",
            { className: "dshm-sync-detail" },
            problems.slice(0, 8).map((tr, i) => h(
              "div",
              { key: i },
              (tr.status === "fail" ? "\u2715 " : "\u26A0 ") + (tr.artist || "") + " - " + (tr.title || "") + (tr.note ? "\uFF08" + tr.note + "\uFF09" : "")
            )),
            problems.length > 8 ? h("div", null, "\u2026 +" + (problems.length - 8)) : null
          ) : null
        );
      }
      function fmtDuration(sec) {
        const v = Math.max(0, Math.round(sec || 0));
        const hh = Math.floor(v / 3600), mm = Math.floor(v % 3600 / 60);
        return hh > 0 ? hh + " \u5C0F\u65F6 " + mm + " \u5206" : mm + " \u5206 " + v % 60 + " \u79D2";
      }
      function dayKeyOf(ts) {
        const d = new Date(ts || Date.now());
        return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
      }
      function HistoryView({ t, history, player, openArtistPage, artistImages, likes, useHistory, useLibrary, useArtistImages, useLikes }) {
        const s = useHistory((st) => st);
        const [notice, setNotice] = useState("");
        const tracks = useLibrary ? useLibrary((st) => st.tracks) : [];
        useEffect(() => {
          history.load(50);
        }, []);
        const stats = s.stats;
        const coverOf = (ev) => {
          const tr = ev.trackId && tracks.find((x) => x.id === ev.trackId);
          return tr && tr.coverUrl ? tr.coverUrl : null;
        };
        const statCard = (label, value) => h(
          "div",
          { className: "dshm-stat", key: label },
          h("div", { className: "dshm-stat-value dshm-ellipsis" }, value),
          h("div", { className: "dshm-stat-label" }, label)
        );
        const trackForTop = (it) => it && (it.trackId && tracks.find((x) => x.id === it.trackId) || it.id && tracks.find((x) => x.id === it.id)) || null;
        const topTracks = [];
        for (const it of stats && stats.topSongs || []) {
          const tr = trackForTop(it);
          if (tr && !topTracks.some((x) => x.id === tr.id)) topTracks.push(tr);
        }
        const playTopSong = (it) => {
          const tr = trackForTop(it);
          if (!tr) return;
          const idx = topTracks.findIndex((x) => x.id === tr.id);
          player.playTracks(topTracks, idx >= 0 ? idx : 0);
        };
        const daily = stats && stats.daily || [];
        const maxPlays = Math.max(1, ...daily.map((d) => d.plays || 0));
        const statsBlock = stats ? h(
          "div",
          { className: "dshm-stats-wrap" },
          h(
            "div",
            { className: "dshm-stats" },
            statCard(t("statPlays"), String(stats.totalPlays || 0)),
            statCard(t("statSeconds"), fmtDuration(stats.totalSeconds)),
            statCard(t("statSongs"), String(stats.uniqueSongs || 0)),
            statCard(t("statArtists"), String(stats.uniqueArtists || 0)),
            statCard(t("statSkipped"), String(stats.skippedCount || 0)),
            statCard(t("statCompletion"), Math.round((stats.avgCompletion || 0) * 100) + "%"),
            statCard(t("statDislikes"), String(stats.dislikes && stats.dislikes.count || 0))
          ),
          h(
            "div",
            { className: "dshm-trend" },
            h("div", { className: "dshm-asec-title" }, h(IconQueue, { size: 13 }), t("trendTitle")),
            h("div", { className: "dshm-bars" }, daily.map((d, i) => h(
              "div",
              { className: "dshm-bar-col", key: i },
              h("div", { className: "dshm-bar", title: (d.date || "") + " \xB7 " + (d.plays || 0) + " " + t("playsUnit"), style: { height: Math.max(3, Math.round((d.plays || 0) / maxPlays * 100)) + "%" } }),
              h("div", { className: "dshm-bar-label" }, String(d.date || "").slice(5))
            )))
          ),
          h(
            "div",
            { className: "dshm-tops" },
            h(
              "div",
              { className: "dshm-top-col" },
              h(
                "div",
                { className: "dshm-asec-title" },
                h(IconNote, { size: 13 }),
                t("topSongs"),
                h("button", {
                  type: "button",
                  className: "dshm-chipbtn dshm-col-play",
                  style: { marginLeft: "auto" },
                  disabled: topTracks.length === 0,
                  title: t("playList"),
                  onClick: () => player.playTracks(topTracks, 0)
                }, h(IconPlay, { size: 12 }), t("playList"))
              ),
              (stats.topSongs || []).length ? stats.topSongs.map((it, i) => {
                const tr = trackForTop(it);
                const play = () => {
                  setNotice("");
                  playTopSong(it);
                };
                const explain = () => setNotice(t("topUnplayable"));
                return h(
                  "div",
                  {
                    className: cx("dshm-top-row", tr ? "dshm-top-row-click" : "dshm-top-row-off"),
                    key: i,
                    role: "button",
                    tabIndex: 0,
                    "aria-disabled": tr ? void 0 : true,
                    title: tr ? t("playTrack") : t("topUnplayable"),
                    onClick: tr ? play : explain,
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (tr) play();
                        else explain();
                      }
                    }
                  },
                  h("span", { className: "dshm-top-rank" }, String(i + 1)),
                  h("span", { className: "dshm-ellipsis", style: { flex: 1 } }, (it.title || "") + (it.artist ? " \xB7 " + it.artist : "")),
                  h("span", { className: "dshm-count" }, (it.plays || 0) + " " + t("playsUnit"))
                );
              }) : h("div", { className: "dshm-lyrics-hint" }, t("noSection"))
            ),
            h(
              "div",
              { className: "dshm-top-col" },
              h("div", { className: "dshm-asec-title" }, h(IconDisc, { size: 13 }), t("topArtists")),
              (stats.topArtists || []).length ? stats.topArtists.map((it, i) => h(
                "button",
                {
                  key: i,
                  type: "button",
                  className: "dshm-top-row dshm-top-row-artist",
                  title: t("artistOpen"),
                  onClick: () => openArtistPage(it.name || "")
                },
                h("span", { className: "dshm-top-rank" }, String(i + 1)),
                h("span", { className: "dshm-ellipsis", style: { flex: 1 } }, it.name || ""),
                h("span", { className: "dshm-count" }, (it.plays || 0) + " " + t("playsUnit"))
              )) : h("div", { className: "dshm-lyrics-hint" }, t("noSection"))
            ),
            h(
              "div",
              { className: "dshm-dislikes" },
              h("div", { className: "dshm-asec-title" }, h(IconThumbDown, { size: 13 }), t("dislikesTitle")),
              (stats.dislikes && stats.dislikes.songs || []).length ? stats.dislikes.songs.map((it, i) => h(
                "div",
                { className: "dshm-dislike-row", key: i },
                h(
                  "span",
                  { className: "dshm-ellipsis", style: { flex: 1 } },
                  (it.title || "") + (it.artist ? " \xB7 " + it.artist : "")
                ),
                h("span", { className: "dshm-count" }, it.dislikedAt ? new Date(it.dislikedAt).toISOString().slice(0, 10) : ""),
                likes ? h("button", {
                  type: "button",
                  className: "dshm-chipbtn dshm-dislike-undo",
                  title: t("undislikeBtn"),
                  onClick: () => likes.setDislike({ artist: it.artist, title: it.title }, false)
                }, t("undislikeBtn")) : null
              )) : h("div", { className: "dshm-lyrics-hint" }, t("dislikesEmpty"))
            )
          )
        ) : null;
        let list;
        if (s.status === "loading" && s.events.length === 0) {
          list = h(
            React.Fragment,
            null,
            h("div", { className: "dshm-lyrics-hint" }, t("historyLoading")),
            h(SkeletonRows)
          );
        } else if (s.status === "error" && s.events.length === 0) {
          list = h(EmptyState, {
            icon: h(IconAlert, { size: 30 }),
            tone: "error",
            title: t("historyError"),
            body: s.error || ""
          }, h("button", { type: "button", className: "dshm-chipbtn", onClick: () => history.load(50) }, t("lyricsRetry")));
        } else if (s.events.length === 0) {
          list = h(EmptyState, { icon: h(IconQueue, { size: 30 }), title: t("historyEmpty") });
        } else {
          const groups = [];
          let last = null;
          for (const ev of s.events) {
            const k = dayKeyOf(ev.timestamp || Date.now());
            if (k !== last) {
              groups.push({ key: k, label: k, items: [] });
              last = k;
            }
            groups[groups.length - 1].items.push(ev);
          }
          const trackById = (ev) => ev && ev.trackId ? tracks.find((x) => x.id === ev.trackId) : null;
          const queue = [];
          for (const ev of s.events) {
            const tr = trackById(ev);
            if (tr && !queue.some((x) => x.id === tr.id)) queue.push(tr);
          }
          const playHistory = (ev) => {
            const tr = trackById(ev);
            if (!tr) return;
            const idx = queue.findIndex((x) => x.id === tr.id);
            player.playTracks(queue, idx >= 0 ? idx : 0);
          };
          list = h(
            "div",
            { className: "dshm-hlist" },
            h(
              "div",
              { className: "dshm-queue-head" },
              h(IconQueue, { size: 14 }),
              t("historyTitle"),
              h("span", { className: "dshm-count" }, s.total + " " + t("tracksUnit")),
              h("button", {
                type: "button",
                className: "dshm-chipbtn dshm-col-play",
                style: { marginLeft: "auto" },
                disabled: queue.length === 0,
                title: t("playList"),
                onClick: () => player.playTracks(queue, 0)
              }, h(IconPlay, { size: 12 }), t("playList"))
            ),
            groups.map((g) => h(
              "section",
              { className: "dshm-hgroup", key: g.key },
              h(
                "div",
                { className: "dshm-hgroup-label" },
                g.label,
                h("span", { className: "dshm-count" }, g.items.length + " " + t("playsUnit"))
              ),
              g.items.map((ev, i) => {
                const pct = Math.round((ev.completion || 0) * 100);
                const tone = pct >= 80 ? "good" : pct >= 40 ? "mid" : "low";
                const tr = trackById(ev);
                return h(
                  "div",
                  {
                    className: cx("dshm-hrow", tr && "dshm-hrow-click"),
                    key: i,
                    role: tr ? "button" : void 0,
                    tabIndex: tr ? 0 : void 0,
                    title: tr ? t("playTrack") : void 0,
                    onClick: tr ? () => playHistory(ev) : void 0,
                    onKeyDown: tr ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        playHistory(ev);
                      }
                    } : void 0
                  },
                  h(Thumb, { src: coverOf(ev), size: 40 }),
                  h(
                    "div",
                    { className: "dshm-row-info" },
                    h("div", { className: "dshm-row-title dshm-ellipsis" }, ev.title || ev.trackId || ""),
                    ev.artist ? h(
                      "button",
                      {
                        type: "button",
                        className: "dshm-row-sub dshm-ellipsis dshm-row-sub-btn",
                        title: t("artistOpen"),
                        onClick: (e) => {
                          e.stopPropagation();
                          openArtistPage(ev.artist);
                        }
                      },
                      h(ArtistAvatar, { name: ev.artist, size: 16, service: artistImages, useArtistImages }),
                      h("span", { className: "dshm-ellipsis" }, ev.artist)
                    ) : h("div", { className: "dshm-row-sub dshm-ellipsis" }, "")
                  ),
                  h("span", { className: "dshm-hbadge dshm-hbadge-" + tone, title: t("historyComplete") }, pct + "%"),
                  ev.skipped ? h("span", { className: "dshm-hskip" }, t("historySkipped")) : h("span", null),
                  h(
                    "span",
                    { className: "dshm-htime" },
                    ev.timestamp ? new Date(ev.timestamp).toLocaleString(void 0, { hour: "2-digit", minute: "2-digit" }) : ""
                  )
                );
              })
            ))
          );
        }
        return h(
          "div",
          { className: "dshm-history-page" },
          notice ? h("div", { className: "dshm-mode-hint", role: "status", style: { margin: "6px 8px 0" } }, notice) : null,
          statsBlock,
          list
        );
      }
      function lyricsSourceLabel(source, t) {
        if (source === "embedded") return t("lyricsSourceEmbedded");
        if (source === "lrclib") return t("lyricsSourceLrclib");
        if (source === "web") return t("lyricsSourceWeb");
        return source || "";
      }
      function LyricsPanel({ t, lyrics, useLyrics, usePlayer }) {
        const track2 = usePlayer((s) => s.track);
        const position = usePlayer((s) => s.position);
        const trackId = track2 ? track2.id : null;
        const snap = useLyrics((s) => s.trackId === trackId ? s : null);
        useEffect(() => {
          if (trackId) lyrics.load(trackId);
        }, [trackId]);
        const scrollRef = useRef(null);
        const activeRef = useRef(null);
        const lines = snap && snap.data && snap.data.synced ? snap.data.lines : null;
        let activeIdx = -1;
        if (lines && lines.length) {
          for (let i = 0; i < lines.length; i++) {
            const tm = lines[i].time;
            if (tm == null) continue;
            if (position + 0.2 >= tm) activeIdx = i;
            else break;
          }
        }
        useEffect(() => {
          const el = activeRef.current, box = scrollRef.current;
          if (el && box) {
            box.scrollTo({
              top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
              behavior: "smooth"
            });
          }
        }, [activeIdx]);
        if (!track2 || !snap) return null;
        let body;
        if (snap.status === "loading") {
          body = h("div", { className: "dshm-lyrics-hint" }, t("lyricsLoading"));
        } else if (snap.status === "error") {
          body = h(
            React.Fragment,
            null,
            h("div", { className: "dshm-errorline", role: "alert" }, h(IconAlert, { size: 14 }), t("lyricsError") + "\uFF1A" + snap.error),
            h("button", { type: "button", className: "dshm-chipbtn", style: { alignSelf: "flex-start", margin: "6px 10px 0" }, onClick: () => lyrics.load(trackId) }, t("lyricsRetry"))
          );
        } else if (snap.data && snap.data.source === "none") {
          body = h("div", { className: "dshm-lyrics-hint" }, snap.data.message || t("lyricsNone"));
        } else if (lines && lines.length) {
          body = h(
            "div",
            { className: "dshm-lyrics-scroll", ref: scrollRef },
            lines.map((line, i) => h("div", {
              key: i,
              ref: i === activeIdx ? activeRef : null,
              className: cx(
                "dshm-lyric-line",
                i === activeIdx && "dshm-lyric-line-active",
                i < activeIdx && "dshm-lyric-line-past"
              )
            }, line.text || "\u266A"))
          );
        } else if (snap.data && snap.data.plain) {
          body = h("div", { className: "dshm-plain-lyrics" }, snap.data.plain);
        } else {
          body = h("div", { className: "dshm-lyrics-hint" }, t("lyricsNone"));
        }
        return h(
          "section",
          { className: "dshm-lyrics", "aria-label": t("lyricsTitle") },
          h(
            "div",
            { className: "dshm-lyrics-head" },
            h(IconNote, { size: 14 }),
            t("lyricsTitle"),
            snap.data && snap.data.source && snap.data.source !== "none" ? h("span", { className: "dshm-source-chip" }, t("lyricsSource") + " \xB7 " + lyricsSourceLabel(snap.data.source, t)) : null
          ),
          body
        );
      }
      function CiteMeta({ item, t }) {
        if (!item || !item.source && !item.date && !item.url) return null;
        return h(
          "div",
          { className: "dshm-acard-meta" },
          h("span", null, (item.source || t("citeSource")) + (item.date ? " \xB7 " + item.date : "")),
          item.url ? h("a", { href: item.url, target: "_blank", rel: "noreferrer noopener" }, t("citeLink")) : null
        );
      }
      const consoleLanguages = [
        { query: /中文|华语|mandarin|chinese/i, tag: /^(zh|zho|chi|cmn)([-_]|$)|中文|mandarin|chinese/i },
        { query: /粤语|cantonese/i, tag: /^(yue)([-_]|$)|粤语|cantonese/i },
        { query: /英语|英文|english/i, tag: /^(en|eng)([-_]|$)|英语|english/i },
        { query: /日语|日文|japanese/i, tag: /^(ja|jpn)([-_]|$)|日语|japanese/i },
        { query: /韩语|韩文|korean/i, tag: /^(ko|kor)([-_]|$)|韩语|korean/i }
      ];
      const consoleGenres = [
        /摇滚|\brock\b/i,
        /爵士|\bjazz\b/i,
        /古典|\bclassical\b/i,
        /氛围|\bambient\b/i,
        /金属|\bmetal\b/i,
        /电子|\belectronic\b/i,
        /朋克|\bpunk\b/i,
        /民谣|\bfolk\b/i,
        /纯音乐|器乐|instrumental/i,
        /说唱|\brap\b|hip[ -]?hop/i,
        /流行|\bpop\b/i
      ];
      const scenes = {
        focus: /专注|编程|深度工作|低干扰|\bfocus\b|\bcoding\b/i,
        relax: /放松|深夜|舒缓|\brelax\b|\bchill\b/i,
        energy: /运动|跑步|健身|激昂|\bworkout\b|\benergy\b/i
      };
      const sceneGenres = {
        focus: /ambient|instrumental|classical|lo-fi|氛围|器乐|古典/i,
        relax: /jazz|ambient|acoustic|folk|爵士|氛围|民谣/i,
        energy: /rock|metal|punk|electronic|摇滚|金属|朋克|电子/i
      };
      function consoleHash(value) {
        let hash2 = 2166136261;
        for (const char of value) hash2 = Math.imul(hash2 ^ char.codePointAt(0), 16777619);
        return hash2 >>> 0;
      }
      function curateTracks({ mode, prompt, tracks, history, liked, disliked, seed }) {
        const playable = tracks.filter((track2) => track2.audioUrl && !disliked[likeKey(track2)]);
        const text2 = normalizeZh(prompt).trim();
        const minutes = text2.match(/(\d{1,3})\s*(?:分钟|分(?:钟)?\b|min(?:ute)?s?\b)/i);
        const target = mode === "playlist" ? Math.min(180, Math.max(1, minutes ? Number(minutes[1]) : 40)) * 60 : 0;
        const now = Date.now();
        const plays = /* @__PURE__ */ new Map();
        for (const event of history) {
          if (!event.trackId || !Number.isFinite(event.timestamp) || event.timestamp < now - 30 * 864e5) continue;
          const play = plays.get(event.trackId) || { count: 0, latest: 0 };
          play.count += event.skipped ? 0.2 : 1;
          play.latest = Math.max(play.latest, event.timestamp);
          plays.set(event.trackId, play);
        }
        const genres = consoleGenres.filter((genre) => genre.test(text2));
        const languages = consoleLanguages.filter(({ query: query2 }) => query2.test(text2));
        const scene = Object.keys(scenes).find((key) => scenes[key].test(text2));
        const artistNames = new Set(playable.map((track2) => normalizeZh(track2.artist).trim()).filter((name) => name.length > 1 && text2.includes(name)));
        const query = text2.replace(/^\/find\s*/, "");
        const today = /* @__PURE__ */ new Date();
        const dayKey = [today.getFullYear(), today.getMonth() + 1, today.getDate()].join("-");
        const matchesGenre = (track2) => genres.some((genre) => genre.test(normalizeZh(track2.genre)));
        const matchesLanguage = (track2) => languages.some(({ tag }) => tag.test(track2.language || ""));
        const artistKey = (track2) => normalizeZh(track2.artist).trim();
        const sameArtist = (track2) => !!seed?.artist && artistKey(track2) === artistKey(seed);
        const sameAlbum = (track2) => !!seed?.album && sameArtist(track2) && normalizeZh(track2.album) === normalizeZh(seed.album);
        const sameGenre = (track2) => !!seed?.genre && normalizeZh(track2.genre) === normalizeZh(seed.genre);
        const score = (track2) => {
          if (mode === "daily") return consoleHash(dayKey + track2.id) / 4294967296;
          if (mode === "history") return plays.get(track2.id).latest / 1e3;
          if (mode === "find") return Number(sameAlbum(track2)) * 4 + Number(sameArtist(track2)) * 3 + Number(sameGenre(track2)) * 2;
          return Number(artistNames.has(artistKey(track2))) * 9 + Number(matchesGenre(track2)) * 7 + Number(matchesLanguage(track2)) * 5 + Number(!!scene && sceneGenres[scene].test(normalizeZh(track2.genre))) * 3 + Number(!!liked[likeKey(track2)]) * 2 + Math.min(1.5, (plays.get(track2.id)?.count || 0) / 4) + consoleHash((text2 || mode) + track2.id) / 4294967296;
        };
        let candidates = playable;
        if (mode === "history") candidates = candidates.filter((track2) => plays.has(track2.id));
        if (mode === "find") candidates = seed ? candidates.filter((track2) => track2.id !== seed.id && (sameArtist(track2) || sameGenre(track2))) : query ? candidates.filter((track2) => normalizeZh([track2.title, track2.artist, track2.album, track2.genre].join(" ")).includes(query)) : [];
        if (mode === "playlist" || mode === "radio") {
          candidates = candidates.filter((track2) => (!genres.length || matchesGenre(track2)) && (!languages.length || matchesLanguage(track2)) && (!artistNames.size || artistNames.has(artistKey(track2))));
        }
        const ranked = candidates.map((track2) => ({ track: track2, rank: score(track2) })).sort((a, b) => b.rank - a.rank);
        let seconds = 0;
        const selected = [];
        const cap = { daily: 5, history: 30, find: 20, radio: 60, playlist: 100 }[mode];
        for (const { track: track2 } of ranked) {
          if (selected.length >= cap) break;
          const duration = Number(track2.duration) || 0;
          if (target && (!duration || Math.abs(target - seconds - duration) >= Math.abs(target - seconds))) continue;
          selected.push(track2);
          seconds += duration;
          if (target && seconds >= target) break;
        }
        if (target && !selected.length) {
          const track2 = ranked.map((entry) => entry.track).filter((item) => item.duration > 0).reduce((best, item) => !best || Math.abs(item.duration - target) < Math.abs(best.duration - target) ? item : best, null);
          if (track2) {
            selected.push(track2);
            seconds = Number(track2.duration);
          }
        }
        return { ids: selected.map((track2) => track2.id), seconds, target, mode, prompt };
      }
      function savedConsoleLists() {
        const rows = readPrefs().consoleLists;
        if (!Array.isArray(rows)) return [];
        return rows.filter((row) => row && typeof row.key === "string" && typeof row.title === "string" && Array.isArray(row.ids)).slice(0, 30);
      }
      function updateConsoleLists(ui, lists) {
        try {
          localStorage.setItem("dsh-music.prefs", JSON.stringify({ ...readPrefs(), consoleLists: lists }));
          ui.set({ consoleLists: lists, saveError: false });
        } catch {
          ui.set({ saveError: true });
        }
      }
      function addConsoleLog(ui, key, detail = "") {
        const previous = ui.getSnapshot().consoleLog || [];
        ui.set({ consoleLog: [{ key, detail, time: Date.now() }, ...previous].slice(0, 15) });
      }
      function ConsoleSignal({ large = false }) {
        const bars = large ? Array.from({ length: 34 }, (_, i) => 12 + (1 - Math.abs(16 - i) / 18) * (42 + Math.sin(i * 2.3) * 36)) : [8, 15, 24, 13, 8];
        return h(
          "span",
          { className: "dshm-signal", "aria-hidden": true },
          bars.map((bar, index) => h("i", { key: index, style: { "--bar": Math.round(bar) + "px" } }))
        );
      }
      const consoleModes = [
        { id: "playlist", icon: IconSparkles },
        { id: "radio", icon: IconVolume },
        { id: "history", icon: IconRepeat },
        { id: "find", icon: IconSearch },
        { id: "daily", icon: IconDisc }
      ];
      const modeKey = (mode) => "consoleMode_" + mode;
      const modeHint = (mode) => "consoleHint_" + mode;
      function ConsoleFeatures({ t, onSelect, active, disabled }) {
        return h(
          "div",
          { className: "dshm-feature-grid" },
          consoleModes.map(({ id, icon }) => h("button", {
            key: id,
            type: "button",
            className: "dshm-feature",
            disabled,
            "aria-pressed": active ? active === id : void 0,
            onClick: () => onSelect(id)
          }, h(icon, { size: 19 }), h("strong", null, t(modeKey(id))), h("small", null, t(modeHint(id)))))
        );
      }
      function ConsoleHome({ t, onSelect, openView, count }) {
        return h(
          "div",
          { className: "dshm-workspace" },
          h(
            "section",
            { className: "dshm-console-hero" },
            h(ConsoleSignal, { large: true }),
            h("div", { className: "dshm-kicker" }, "DEEPSEEK HARNESS / MUSIC"),
            h("h2", { className: "dshm-console-h1" }, t("consoleHomeTitle")),
            h("p", { className: "dshm-console-copy" }, t("consoleHomeCopy")),
            h(
              "div",
              { className: "dshm-console-actions" },
              h(
                "button",
                { type: "button", className: "dshm-chipbtn dshm-chipbtn-primary dshm-console-btn", onClick: () => onSelect("playlist") },
                h(IconSparkles, { size: 16 }),
                t("consoleStart")
              ),
              h(
                "button",
                { type: "button", className: "dshm-chipbtn dshm-console-btn", onClick: () => openView("library") },
                h(IconFolder, { size: 16 }),
                t("tabLibrary"),
                " \xB7 ",
                count
              )
            )
          ),
          h(ConsoleFeatures, { t, onSelect })
        );
      }
      function ConsoleStudio({ t, api, ui, useUi, useLibrary, useHistory, useLikes, usePlayer, history, player, openView, openArtistPage, onSelect }) {
        const selection = useUi((state) => state.consoleMode) || "playlist";
        const prompt = useUi((state) => state.consolePrompt) || "";
        const result = useUi((state) => state.consoleResult);
        const logs = useUi((state) => state.consoleLog);
        const saved = useUi((state) => state.consoleLists);
        const saveError = useUi((state) => state.saveError);
        const tracks = useLibrary((state) => state.tracks);
        const libraryStatus = useLibrary((state) => state.status);
        const timeline = useHistory((state) => state);
        const liked = useLikes((state) => state.keys);
        const disliked = useLikes((state) => state.dislikes);
        const seed = usePlayer((state) => state.track);
        const candidates = useMemo(() => new Map(tracks.map((track2) => [track2.id, track2])), [tracks]);
        const resultTracks = (result?.ids || []).map((id) => candidates.get(id)).filter((track2) => track2?.audioUrl);
        const resultSeconds = resultTracks.reduce((total, track2) => total + (Number(track2.duration) || 0), 0);
        const stats = timeline.stats;
        const seedArtist = seed?.artist;
        const [modelAvailable, setModelAvailable] = useState(false);
        const [useModel, setUseModel] = useState(false);
        const [generating, setGenerating] = useState(false);
        const pendingModel = useRef(null);
        useEffect(() => {
          history.load(500);
        }, [history]);
        useEffect(() => {
          if (!api) return void 0;
          const controller = new AbortController();
          api.curationAvailability(controller.signal).then((data) => {
            if (!controller.signal.aborted) setModelAvailable(data?.available === true);
          }).catch(() => {
          });
          return () => {
            controller.abort();
            pendingModel.current?.abort();
          };
        }, [api]);
        async function generate(event) {
          event.preventDefault();
          if (pendingModel.current || libraryStatus !== "ready") return;
          const command = prompt.trim().match(/^\/(playlist|radio|history|find|daily)(?:\s+|$)/i);
          const mode = command ? command[1].toLowerCase() : selection;
          const input = command ? prompt.trim().slice(command[0].length) : prompt;
          if (mode === "history" && timeline.status !== "ready") return;
          const anchor = mode === "find" && !input.trim() ? seed : null;
          let interpreted = "";
          let modelFailed = false;
          if (modelAvailable && useModel && input.trim() && (mode === "playlist" || mode === "radio")) {
            const controller = new AbortController();
            pendingModel.current = controller;
            setGenerating(true);
            try {
              const response = await api.interpretCuration(input, controller.signal);
              interpreted = typeof response?.interpreted === "string" ? response.interpreted : "";
              modelFailed = !interpreted;
            } catch {
              modelFailed = true;
            } finally {
              pendingModel.current = null;
            }
            if (controller.signal.aborted) return;
            setGenerating(false);
            const current = ui.getSnapshot();
            if (current.consoleMode !== selection || current.consolePrompt !== prompt) return;
          }
          const next = curateTracks({ mode, prompt: interpreted || input, tracks, history: timeline.events, liked: liked || {}, disliked: disliked || {}, seed: anchor });
          ui.set({ consoleResult: { ...next, prompt: input, interpreted, modelFailed }, consoleMode: mode, consolePrompt: input, saveError: false });
          addConsoleLog(ui, "consoleLogGenerated", t(modeKey(mode)) + " \xB7 " + next.ids.length);
        }
        function play(queue, index = 0) {
          player.playTracks(queue, index, { shuffle: false, ordered: true });
          addConsoleLog(ui, "consoleLogPlayed", queue.length + " " + t("tracksUnit"));
        }
        function save() {
          if (!resultTracks.length || result.saved) return;
          const now = Date.now();
          const title = result.prompt.trim().slice(0, 80) || t(modeKey(result.mode));
          const entry = { key: now + "-" + Math.random().toString(36).slice(2, 9), title, ids: resultTracks.map((track2) => track2.id) };
          updateConsoleLists(ui, [entry, ...saved || []].slice(0, 30));
          if (!ui.getSnapshot().saveError) {
            ui.set({ consoleResult: { ...result, saved: true, savedKey: entry.key } });
            addConsoleLog(ui, "consoleLogSaved", title);
          }
        }
        function openSaved(entry) {
          ui.set({ consoleResult: { ids: entry.ids, mode: "playlist", title: entry.title, saved: true, savedKey: entry.key }, saveError: false });
          addConsoleLog(ui, "consoleLogOpened", entry.title);
        }
        return h(
          "div",
          { className: "dshm-workspace" },
          h(
            "div",
            { className: "dshm-console-grid" },
            h(
              "main",
              null,
              h("div", { className: "dshm-kicker" }, "> CURATION"),
              h("h2", { className: "dshm-console-title" }, t("consoleStudio")),
              h("p", { className: "dshm-console-copy" }, t("consoleStudioCopy")),
              h(
                "form",
                { className: "dshm-command-form", onSubmit: generate },
                h(IconSparkles, { size: 19 }),
                h("input", {
                  "aria-label": t("consolePrompt"),
                  maxLength: 220,
                  value: prompt,
                  disabled: generating,
                  placeholder: t(modeHint(selection)),
                  onChange: (event) => ui.set({ consolePrompt: event.target.value })
                }),
                h(
                  "button",
                  {
                    className: "dshm-chipbtn dshm-chipbtn-primary dshm-console-btn",
                    type: "submit",
                    disabled: generating || libraryStatus !== "ready" || selection === "history" && timeline.status !== "ready"
                  },
                  h(IconPlay, { size: 14 }),
                  t(generating ? "consoleModelBusy" : "consoleGenerate")
                )
              ),
              modelAvailable && (selection === "playlist" || selection === "radio") ? h(
                "label",
                { className: "dshm-console-model", title: t("consoleModelHint") },
                h("input", { type: "checkbox", checked: useModel, disabled: generating, onChange: (event) => setUseModel(event.target.checked) }),
                t("consoleUseModel")
              ) : null,
              h(
                "div",
                { className: "dshm-console-actions" },
                ["consolePresetFocus", "consolePresetRelax", "consolePresetEnergy"].map((key) => h("button", {
                  key,
                  type: "button",
                  className: "dshm-chipbtn dshm-prompt-chip",
                  disabled: generating,
                  onClick: () => ui.set({ consoleMode: "playlist", consolePrompt: t(key), consoleResult: null, saveError: false })
                }, t(key)))
              ),
              h(ConsoleFeatures, { t, active: selection, onSelect, disabled: generating }),
              selection === "history" && timeline.status === "error" ? h("p", { role: "alert" }, t("consoleHistoryError")) : null,
              selection === "find" && seedArtist ? h("button", {
                type: "button",
                className: "dshm-chipbtn",
                onClick: () => openArtistPage(seedArtist)
              }, t("consoleExploreArtist"), " \xB7 ", seedArtist) : null,
              result && !generating ? h(
                "section",
                { className: "dshm-console-card dshm-console-result", "aria-live": "polite" },
                h(
                  "div",
                  { className: "dshm-result-head" },
                  h(
                    "div",
                    null,
                    h("h3", null, result.title || t(modeKey(result.mode))),
                    h("div", { className: "dshm-console-muted" }, resultTracks.length + " " + t("tracksUnit") + " \xB7 " + formatTime2(resultSeconds) + (result.target ? " / " + t("consoleTarget") + " " + formatTime2(result.target) : ""))
                  ),
                  resultTracks.length ? h(
                    "div",
                    { className: "dshm-console-actions" },
                    h("button", {
                      type: "button",
                      className: "dshm-chipbtn dshm-chipbtn-primary",
                      onClick: () => play(resultTracks)
                    }, h(IconPlay, { size: 14 }), t("playAll")),
                    h(
                      "button",
                      { type: "button", className: "dshm-chipbtn", disabled: result.saved, onClick: save },
                      h(result.saved ? IconCheck : IconDownload, { size: 14 }),
                      t(result.saved ? "consoleSaved" : "consoleSave")
                    )
                  ) : null
                ),
                saveError ? h("p", { role: "alert" }, t("consoleSaveError")) : null,
                result.interpreted ? h("p", null, t("consoleModelApplied") + " \xB7 " + result.interpreted) : null,
                result.modelFailed ? h("p", { role: "status" }, t("consoleModelFallback")) : null,
                resultTracks.length ? h("div", { className: "dshm-console-rows" }, resultTracks.map((track2, index) => h(
                  "button",
                  { type: "button", className: "dshm-console-track", key: track2.id, onClick: () => play(resultTracks, index) },
                  h("span", { className: "dshm-text-code" }, String(index + 1).padStart(2, "0")),
                  h(Cover, { track: track2, size: 32 }),
                  h("div", { className: "dshm-ellipsis" }, track2.title, h("small", { className: "dshm-ellipsis" }, track2.artist || t("unknownArtist"))),
                  h("span", { className: "dshm-text-code" }, formatTime2(track2.duration))
                ))) : h("p", null, t(result.saved ? "consoleMissing" : "consoleNoMatches"))
              ) : null
            ),
            h(
              "aside",
              null,
              h(
                "section",
                { className: "dshm-console-card" },
                h("h3", null, t("consoleProfile")),
                h(
                  "div",
                  { className: "dshm-console-metrics" },
                  [[tracks.length, t("tabLibrary")], [stats?.totalPlays ?? "\u2014", t("statPlays")], [stats?.uniqueArtists ?? "\u2014", t("statArtists")]].map(([value, label]) => h("div", { key: label, className: "dshm-console-metric" }, h("strong", null, value), h("small", null, label)))
                ),
                (stats?.topArtists || []).length ? h(
                  "div",
                  { className: "dshm-console-tags" },
                  stats.topArtists.slice(0, 4).map((artist) => h("button", {
                    key: artist.name,
                    type: "button",
                    className: "dshm-chipbtn dshm-prompt-chip",
                    onClick: () => openArtistPage(artist.name)
                  }, artist.name))
                ) : null,
                h("div", { className: "dshm-console-actions" }, h("button", {
                  type: "button",
                  className: "dshm-chipbtn",
                  onClick: () => openView("history")
                }, t("tabHistory")))
              ),
              h(
                "section",
                { className: "dshm-console-card" },
                h("h3", null, t("consolePlaylists")),
                saved?.length ? saved.map((entry) => h(
                  "div",
                  { className: "dshm-console-listline", key: entry.key },
                  h(
                    "button",
                    { type: "button", className: "dshm-chipbtn", disabled: generating, onClick: () => openSaved(entry) },
                    h("span", { className: "dshm-ellipsis" }, entry.title),
                    " \xB7 " + entry.ids.length
                  ),
                  h(IconButton, { label: t("consoleRemove"), onClick: () => {
                    updateConsoleLists(ui, saved.filter((item) => item.key !== entry.key));
                    if (!ui.getSnapshot().saveError) {
                      if (result?.savedKey === entry.key) ui.set({ consoleResult: null });
                      addConsoleLog(ui, "consoleLogRemoved", entry.title);
                    }
                  } }, h(IconClose, { size: 14 }))
                )) : h("small", { className: "dshm-console-muted" }, t("consoleNoSaved")),
                saveError && !result ? h("p", { role: "alert" }, t("consoleSaveError")) : null
              ),
              h(
                "details",
                { className: "dshm-console-card" },
                h("summary", null, t("consoleLog")),
                logs?.length ? h("ol", { className: "dshm-console-log" }, logs.map(({ key, detail, time }, index) => h(
                  "li",
                  { key: time + "-" + index },
                  h("time", { dateTime: new Date(time).toISOString() }, new Date(time).toLocaleTimeString()),
                  t(key),
                  " \xB7 ",
                  detail
                ))) : h("p", { className: "dshm-console-muted" }, t("consoleNoLogs"))
              )
            )
          )
        );
      }
      function ConsoleDock({ t, player, usePlayer, openView, openCommand }) {
        const track2 = usePlayer((state) => state.track);
        const playing = usePlayer((state) => state.playing);
        const position = usePlayer((state) => state.position);
        const duration = usePlayer((state) => state.duration);
        const muted = usePlayer((state) => state.muted);
        const volume = usePlayer((state) => state.volume);
        const shuffle = usePlayer((state) => state.shuffle);
        const repeat = usePlayer((state) => state.repeat);
        const error = usePlayer((state) => state.error);
        const mode = modeMeta(t, shuffle, repeat);
        return h(
          "footer",
          { className: "dshm-console-dock", "aria-label": t("miniLabel") },
          h(
            "div",
            { className: "dshm-dock-track" },
            h(Cover, { track: track2, size: 42 }),
            h(
              "button",
              { type: "button", onClick: () => openView(track2 ? "now" : "library") },
              h("strong", { className: "dshm-ellipsis", style: { display: "block" } }, track2?.title || t("noTrackTitle")),
              h(
                "small",
                { className: "dshm-ellipsis", role: error ? "status" : void 0 },
                error || (track2 ? [track2.artist, track2.album].filter(Boolean).join(" \xB7 ") : t("goLibrary"))
              )
            )
          ),
          h(
            "div",
            { className: "dshm-dock-controls" },
            h(IconButton, { label: t("prev"), onClick: player.prev, disabled: !track2 }, h(IconPrev)),
            h(
              IconButton,
              { label: t(playing ? "pause" : "play"), onClick: player.toggle, disabled: !track2, className: "dshm-mini-play" },
              h(playing ? IconPause : IconPlay, { size: 20 })
            ),
            h(IconButton, { label: t("next"), onClick: player.next, disabled: !track2 }, h(IconNext))
          ),
          h(
            "div",
            { className: "dshm-dock-progress" },
            h("span", null, formatTime2(position)),
            h(Slider, {
              label: t("seekLabel"),
              value: duration ? position / duration : 0,
              onChange: (fraction) => player.seek(fraction * duration),
              disabled: !duration
            }),
            h("span", null, formatTime2(duration))
          ),
          h(
            "div",
            { className: "dshm-dock-end" },
            h(IconButton, {
              label: t(muted ? "unmute" : "mute"),
              onClick: player.toggleMute,
              disabled: !track2,
              className: "dshm-dock-volume"
            }, h(muted ? IconMute : IconVolume, { size: 16 })),
            h(Slider, { label: t("volume"), value: muted ? 0 : volume, onChange: player.setVolume, disabled: !track2 }),
            h(IconButton, { label: mode.hint, onClick: player.cycleMode }, h(mode.icon, { size: 16 })),
            h(IconButton, { label: t("queue"), onClick: () => openView("now") }, h(IconQueue, { size: 16 })),
            h(IconButton, { label: t("consoleCommand"), onClick: openCommand }, h("span", { "aria-hidden": true, className: "dshm-text-code" }, ">_"))
          )
        );
      }
      function ConsoleCommand({ t, close, useLibrary, player, openView, onSelect }) {
        const [input, setInput] = useState("");
        const dialog = useRef(null);
        const search = useRef(null);
        const tracks = useLibrary((state) => state.tracks);
        const query = normalizeZh(input.trim());
        const commands = [
          ...consoleModes.map(({ id }) => ({ key: id, text: "/" + id + " \xB7 " + t(modeKey(id)), run: (tail) => onSelect(id, tail) })),
          { key: "library", text: "/library \xB7 " + t("tabLibrary"), run: () => openView("library") },
          { key: "now", text: "/now \xB7 " + t("tabNow"), run: () => openView("now") }
        ];
        const shown = commands.filter(({ text: text2, key }) => !query || normalizeZh(text2).includes(query) || query.startsWith("/" + key + " "));
        const matches = query && !query.startsWith("/") ? tracks.filter((track2) => track2.audioUrl && normalizeZh([track2.title, track2.artist, track2.album].join(" ")).includes(query)).slice(0, 8) : [];
        useEffect(() => {
          const prior = document.activeElement;
          search.current?.focus();
          return () => {
            if (prior?.isConnected) prior.focus();
          };
        }, []);
        function activate(command) {
          const prefix = "/" + command.key;
          const tail = query.startsWith(prefix + " ") ? input.trim().slice(prefix.length).trim() : "";
          command.run(tail);
          close();
        }
        return h(
          "div",
          { className: "dshm-command-layer", onClick: (event) => {
            if (event.target === event.currentTarget) close();
          } },
          h(
            "section",
            {
              ref: dialog,
              className: "dshm-console-card dshm-command-window",
              role: "dialog",
              "aria-modal": true,
              "aria-label": t("consoleCommand"),
              onKeyDown: (event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  close();
                }
                if (event.key !== "Tab") return;
                const controls = [...dialog.current?.querySelectorAll("button:not([disabled]), input") || []];
                const first = controls[0], last = controls[controls.length - 1];
                if (first && (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) {
                  event.preventDefault();
                  (event.shiftKey ? last : first).focus();
                }
              }
            },
            h(
              "div",
              { className: "dshm-result-head" },
              h("h3", null, t("consoleCommand")),
              h(IconButton, { label: t("closeNotice"), onClick: close }, h(IconClose, { size: 14 }))
            ),
            h("form", { className: "dshm-command-form", onSubmit: (event) => {
              event.preventDefault();
              if (matches.length) {
                player.playTracks(matches, 0, { shuffle: false, ordered: true });
                openView("now");
                close();
              } else if (shown.length) activate(shown[0]);
              else if (input.trim() && !query.startsWith("/")) {
                onSelect("playlist", input.trim());
                close();
              }
            } }, h(IconSearch, { size: 18 }), h("input", {
              ref: search,
              value: input,
              maxLength: 220,
              "aria-label": t("consoleCommandPlaceholder"),
              placeholder: t("consoleCommandPlaceholder"),
              onChange: (event) => setInput(event.target.value)
            }), h("kbd", { className: "dshm-key" }, "\u21B5")),
            h(
              "div",
              { className: "dshm-console-rows" },
              shown.map((command) => h("button", {
                key: command.key,
                type: "button",
                className: "dshm-console-track",
                onClick: () => activate(command)
              }, h("span", { className: "dshm-text-code" }, ">"), command.text)),
              matches.map((track2, index) => h(
                "button",
                {
                  key: track2.id,
                  type: "button",
                  className: "dshm-console-track",
                  onClick: () => {
                    player.playTracks(matches, index, { shuffle: false, ordered: true });
                    openView("now");
                    close();
                  }
                },
                h(IconPlay, { size: 15 }),
                h("span", { className: "dshm-ellipsis" }, track2.title, h("small", null, track2.artist)),
                formatTime2(track2.duration)
              )),
              !shown.length && !matches.length ? h("small", { className: "dshm-console-muted" }, t(query.startsWith("/") ? "consoleNoCommand" : "consoleSendPrompt")) : null
            )
          )
        );
      }
      function MusicPanel({ t, api, lifeService, player, library, lyrics, reco, download, sync, history, likes, preview, warm, openView, openArtistPage, setMiniHidden, ui, artistImages, artistPage, onboarding, useUi, useLibrary, usePlayer, useLyrics, useReco, useDownload, useSync, useHistory, useLikes, usePreview, useWarm, useArtistImages, useArtistPage, useOnboarding }) {
        const view = useUi((s) => s.view);
        const welcomePreview = useUi((s) => s.welcomePreview);
        const [commandRequest, setCommandRequest] = useState(0);
        const onSelect = (consoleMode, consolePrompt = "") => {
          ui.set({ view: "studio", consoleMode, consolePrompt, consoleResult: null, saveError: false });
        };
        useEffect(() => {
          ui.set({ dockVisible: true });
          const handleKey = (event) => {
            if (event.defaultPrevented || event.repeat || event.isComposing || !event.metaKey && !event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
            event.preventDefault();
            event.stopPropagation();
            openView("library");
            setCommandRequest((request) => request + 1);
          };
          window.addEventListener("keydown", handleKey, true);
          return () => {
            ui.set({ dockVisible: false });
            window.removeEventListener("keydown", handleKey, true);
          };
        }, [ui, openView]);
        const pageReady = useArtistPage ? useArtistPage((snap) => snap.lastReady) : null;
        const toast = useUi((s) => s.toast);
        const [seenReadyAt, setSeenReadyAt] = useState(0);
        useEffect(() => {
          if (!pageReady || pageReady.at === seenReadyAt) return;
          setSeenReadyAt(pageReady.at);
          const cur = ui.getSnapshot();
          if (cur.view === "artist" && normalizeZh(cur.artistName || "").trim() === pageReady.key) return;
          ui.set({ toast: { kind: "artist", name: pageReady.name, at: pageReady.at } });
        }, [pageReady]);
        useEffect(() => {
          if (!toast) return void 0;
          const timer = setTimeout(() => ui.set({ toast: null }), 9e3);
          return () => clearTimeout(timer);
        }, [toast]);
        const renderUtility = (route) => {
          let content;
          switch (route) {
            case "studio":
              content = h(ConsoleStudio, { t, api, ui, useUi, useLibrary, useHistory, useLikes, usePlayer, history, player, openView, openArtistPage, onSelect });
              break;
            case "library-manage":
              content = h(LibraryView, { t, player, library, sync, download, preview, likes, openArtistPage, artistImages, useLikes, useSync, useDownload, useLibrary, usePlayer, useArtistImages });
              break;
            case "reco-manage":
              content = h(RecoView, { t, reco, download, player, library, likes, preview, history, openArtistPage, warm, useReco, useDownload, useLibrary, useLikes, usePlayer, useHistory, useWarm });
              break;
            case "now-manage":
              content = h(NowPlayingView, { t, player, lyrics, usePlayer, useLyrics, openView, openArtistPage, artistImages, useArtistImages });
              break;
            case "artist":
              content = h(ArtistPageView, { t, reco, player, likes, preview, library, openView, openArtistPage, artistImages, artistPage, useUi, useLikes, useLibrary, usePlayer, useArtistImages, useArtistPage });
              break;
            case "history":
              content = h(HistoryView, { t, history, player, openArtistPage, artistImages, likes, useHistory, useLibrary, useArtistImages, useLikes });
              break;
            case "echo-gallery":
              content = h(EchoGallery, { openView });
              break;
            case "welcome":
              content = h(WelcomeView, {
                t,
                onboarding,
                useOnboarding,
                preview: !!welcomePreview,
                onExitPreview: () => {
                  ui.set({ welcomePreview: false });
                  openView("library");
                },
                onRoute: (target) => {
                  ui.set({ welcomePreview: false });
                  if (target === "library") {
                    library.load();
                    setTimeout(() => library.load(), 1500);
                    openView("library");
                  } else openView("reco");
                }
              });
              break;
            case "command":
              content = h(ConsoleCommand, {
                t,
                useLibrary,
                player,
                openView,
                onSelect,
                close: () => {
                  if (ui.getSnapshot().view === "command") openView("home");
                }
              });
              break;
            default:
              return null;
          }
          return h("div", { className: "dshm-console echo-utility-content" }, content);
        };
        return h(
          React.Fragment,
          null,
          h(EchoHabitat, {
            lifeService,
            player,
            library,
            lyrics,
            likes,
            reco,
            history,
            preview,
            warm,
            ui,
            usePlayer,
            useLibrary,
            useLyrics,
            useLikes,
            useHistory,
            useReco,
            useUi,
            openView,
            openArtistPage,
            setMiniHidden,
            renderUtility,
            requestedView: view,
            commandRequest
          }),
          toast ? h(
            "div",
            { className: "dshm-toast", role: "status" },
            h("span", { className: "dshm-toast-icon" }, h(IconCheck, { size: 14 })),
            h(
              "button",
              {
                type: "button",
                className: "dshm-toast-main",
                onClick: () => {
                  ui.set({ toast: null });
                  openArtistPage(toast.name);
                }
              },
              toast.kind === "artist" ? t("artistReadyToast") + " \xB7 " + toast.name : t("pageReadyToast")
            ),
            h("button", {
              type: "button",
              className: "dshm-toast-x",
              "aria-label": t("closeNotice"),
              onClick: () => ui.set({ toast: null })
            }, h(IconClose, { size: 12 }))
          ) : null
        );
      }
      function PanelIcon({ size, active }) {
        return h(IconNote, {
          size: size || 18,
          style: { color: active ? "var(--dsw-alias-brand-text)" : "currentColor", display: "block" }
        });
      }
      function MiniPlayer({ t, player, lyrics, artistImages, usePlayer, useUi, useLyrics, useArtistImages, openNow, openArtistPage, setMiniHidden, setMiniCollapsed }) {
        const track2 = usePlayer((s) => s.track);
        const playing = usePlayer((s) => s.playing);
        const position = usePlayer((s) => s.position);
        const duration = usePlayer((s) => s.duration);
        const error = usePlayer((s) => s.error);
        const hidden = useUi((s) => s.miniHidden || s.dockVisible);
        const collapsed = useUi((s) => s.miniCollapsed);
        const shuffle = usePlayer((s) => s.shuffle);
        const repeat = usePlayer((s) => s.repeat);
        const mode = modeMeta(t, shuffle, repeat);
        const trackId = track2 ? track2.id : null;
        const snap = useLyrics((s) => s.trackId === trackId ? s : null);
        const [pos, setPos] = useState(() => readPrefs().miniPos || null);
        const [fabPos, setFabPos] = useState(() => readPrefs().miniFabPos || null);
        const [dragging, setDragging] = useState(false);
        const boxRef = useRef(null);
        const dragRef = useRef(null);
        const posRef = useRef(pos);
        posRef.current = pos;
        const fabRef = useRef(null);
        const fabDragRef = useRef(null);
        const fabPosRef = useRef(fabPos);
        fabPosRef.current = fabPos;
        const fabMoved = useRef(0);
        useEffect(() => {
          if (trackId) lyrics.load(trackId);
        }, [trackId]);
        useEffect(() => {
          if (typeof window === "undefined") return void 0;
          const clampAll = () => {
            const cur = posRef.current;
            if (cur) {
              const el = boxRef.current;
              const w = el ? el.offsetWidth : 380, hh = el ? el.offsetHeight : 96;
              const next = {
                left: Math.max(0, Math.min(cur.left, window.innerWidth - w - 8)),
                top: Math.max(0, Math.min(cur.top, window.innerHeight - hh - 8))
              };
              if (next.left !== cur.left || next.top !== cur.top) {
                setPos(next);
                writePrefs({ miniPos: next });
              }
            }
            const fp = fabPosRef.current;
            if (fp) {
              const next = {
                left: Math.max(0, Math.min(fp.left, window.innerWidth - 56)),
                top: Math.max(0, Math.min(fp.top, window.innerHeight - 56))
              };
              if (next.left !== fp.left || next.top !== fp.top) {
                setFabPos(next);
                writePrefs({ miniFabPos: next });
              }
            }
          };
          clampAll();
          window.addEventListener("resize", clampAll);
          return () => window.removeEventListener("resize", clampAll);
        }, []);
        if (!track2) return null;
        if (hidden) return null;
        if (collapsed) {
          const onFabDown = (e) => {
            const el = fabRef.current;
            if (!el) return;
            e.preventDefault();
            const box = el.getBoundingClientRect();
            fabDragRef.current = { px: e.clientX, py: e.clientY, left: box.left, top: box.top };
            fabMoved.current = 0;
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
            }
          };
          const onFabMove = (e) => {
            const d = fabDragRef.current;
            if (!d) return;
            const dx = e.clientX - d.px, dy = e.clientY - d.py;
            fabMoved.current = Math.max(fabMoved.current, Math.abs(dx) + Math.abs(dy));
            if (fabMoved.current < 3) return;
            const next = {
              left: Math.max(0, Math.min(d.left + dx, window.innerWidth - 56)),
              top: Math.max(0, Math.min(d.top + dy, window.innerHeight - 56))
            };
            fabPosRef.current = next;
            setFabPos(next);
          };
          const onFabUp = (e) => {
            if (!fabDragRef.current) return;
            fabDragRef.current = null;
            if (fabMoved.current < 5) {
              setMiniCollapsed(false);
              return;
            }
            if (fabPosRef.current) writePrefs({ miniFabPos: fabPosRef.current });
            try {
              if (fabRef.current) fabRef.current.releasePointerCapture(e.pointerId);
            } catch {
            }
          };
          const fabStyle = fabPos ? { left: fabPos.left, top: fabPos.top, right: "auto", bottom: "auto" } : void 0;
          return portalToBody(h(
            "div",
            {
              ref: fabRef,
              style: fabStyle,
              className: cx("dshm-mini-fab", dragging && "dshm-mini-fab-dragging"),
              role: "button",
              tabIndex: 0,
              title: t("miniExpand"),
              "aria-label": t("miniExpand"),
              onPointerDown: onFabDown,
              onPointerMove: onFabMove,
              onPointerUp: onFabUp,
              onPointerCancel: onFabUp,
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setMiniCollapsed(false);
                }
              }
            },
            h(Thumb, { src: track2.coverUrl, size: 48, round: true, glyph: IconNote }),
            h(
              "span",
              { className: "dshm-mini-fab-badge", "aria-hidden": true },
              h(playing ? IconPause : IconPlay, { size: 11 })
            )
          ));
        }
        const gripDown = (e) => {
          const el = boxRef.current;
          if (!el) return;
          e.preventDefault();
          const box = el.getBoundingClientRect();
          dragRef.current = { px: e.clientX, py: e.clientY, left: box.left, top: box.top, w: box.width, h: box.height };
          setDragging(true);
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
          }
        };
        const gripMove = (e) => {
          const d = dragRef.current;
          if (!d) return;
          const next = {
            left: Math.max(0, Math.min(d.left + (e.clientX - d.px), window.innerWidth - d.w - 8)),
            top: Math.max(0, Math.min(d.top + (e.clientY - d.py), window.innerHeight - d.h - 8))
          };
          posRef.current = next;
          setPos(next);
        };
        const gripUp = (e) => {
          if (!dragRef.current) return;
          dragRef.current = null;
          setDragging(false);
          if (posRef.current) writePrefs({ miniPos: posRef.current });
          try {
            if (boxRef.current) boxRef.current.releasePointerCapture(e.pointerId);
          } catch {
          }
        };
        const frac = duration > 0 ? Math.min(1, position / duration) : 0;
        const lines = snap && snap.data && snap.data.synced ? snap.data.lines : null;
        let activeIdx = -1;
        if (lines) {
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].time == null) continue;
            if (position + 0.2 >= lines[i].time) activeIdx = i;
            else break;
          }
        }
        const win = [];
        if (lines && lines.length) {
          const start = activeIdx < 0 ? 0 : Math.max(0, Math.min(activeIdx - 1, lines.length - 3));
          for (let i = start; i < Math.min(lines.length, start + 3); i++) win.push({ i, text: lines[i].text || "\u266A" });
        }
        const style = pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : void 0;
        const activeLine = activeIdx >= 0 && lines && lines[activeIdx] ? lines[activeIdx].text || "\u266A" : "";
        const artistBtn = h(
          "button",
          {
            type: "button",
            className: "dshm-mini-artist",
            title: t("artistOpen"),
            "aria-label": t("artistOpen"),
            onClick: (e) => {
              e.stopPropagation();
              openArtistPage(track2.artist || "");
            }
          },
          track2.artist ? h(ArtistAvatar, { name: track2.artist, size: 14, service: artistImages, useArtistImages }) : null,
          h("span", { className: "dshm-ellipsis" }, error ? t("playError") : track2.artist || t("unknownArtist"))
        );
        return portalToBody(h(
          "div",
          {
            ref: boxRef,
            style,
            className: cx("dshm-mini", dragging && "dshm-mini-dragging"),
            role: "region",
            "aria-label": t("miniLabel")
          },
          h("div", {
            className: "dshm-mini-grip",
            role: "button",
            tabIndex: 0,
            title: t("miniDrag"),
            "aria-label": t("miniDrag"),
            onPointerDown: gripDown,
            onPointerMove: gripMove,
            onPointerUp: gripUp,
            onPointerCancel: gripUp,
            onKeyDown: (e) => {
              const step = 12;
              const cur = posRef.current || (boxRef.current ? { left: boxRef.current.getBoundingClientRect().left, top: boxRef.current.getBoundingClientRect().top } : { left: 0, top: 0 });
              const dl = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
              const dt = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
              if (!dl && !dt) return;
              e.preventDefault();
              const next = { left: Math.max(0, cur.left + dl), top: Math.max(0, cur.top + dt) };
              setPos(next);
              writePrefs({ miniPos: next });
            }
          }, h(IconGrip, { size: 14 })),
          h(
            "div",
            { className: "dshm-mini-inner" },
            h(
              "button",
              {
                type: "button",
                className: "dshm-mini-main",
                onClick: openNow,
                title: t("openNow"),
                "aria-label": t("openNow")
              },
              h(Cover, { track: track2, size: 36 }),
              h(
                "span",
                { className: "dshm-mini-text" },
                h("span", { className: "dshm-mini-title dshm-ellipsis" }, track2.title),
                artistBtn
              )
            ),
            h(
              "div",
              { className: "dshm-mini-controls" },
              h(IconButton, { label: t("prev"), onClick: () => player.prev() }, h(IconPrev, { size: 15 })),
              h(IconButton, {
                label: playing ? t("pause") : t("play"),
                className: "dshm-mini-play",
                onClick: () => player.toggle()
              }, h(playing ? IconPause : IconPlay, { size: 16 })),
              h(IconButton, { label: t("next"), onClick: () => player.next() }, h(IconNext, { size: 15 })),
              h(IconButton, {
                label: mode.label,
                title: mode.hint + " \xB7 " + t("modeCycleHint"),
                className: cx((shuffle || repeat === "one") && "dshm-iconbtn-active"),
                onClick: () => player.cycleMode()
              }, h(mode.icon, { size: 15 })),
              h(IconButton, {
                label: t("miniCollapse"),
                title: t("miniCollapse"),
                onClick: () => setMiniCollapsed(true)
              }, h(IconChevronDown, { size: 15 })),
              h(IconButton, { label: t("hideMini"), title: t("hideMini"), onClick: () => setMiniHidden(true) }, h(IconClose, { size: 13 }))
            )
          ),
          h(
            "div",
            { className: "dshm-mini-seek" },
            h(Slider, {
              value: frac,
              label: t("seekLabel"),
              disabled: !(duration > 0),
              onChange: (f) => player.seek(f * duration)
            })
          ),
          win.length ? h(
            "div",
            { className: "dshm-mini-lyrics", "aria-label": t("miniLyrics") },
            win.map((ln) => h("div", {
              key: ln.i,
              className: cx("dshm-mini-lyric", ln.i === activeIdx && "dshm-mini-lyric-on"),
              title: ln.text
            }, ln.text))
          ) : null
        ));
      }
      const inject = ["slots", "locale", "layout"];
      function apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-music: dictionaries");
        const t = ctx.locale.bind(NS);
        const api = createHostApi(t);
        const lifeService = createLifeClient({ resolveUrl });
        lifeService.load().then(() => lifeService.retry()).catch(() => {
        });
        const library = createLibrary(api);
        const lyricsService = createLyricsService(api);
        const artistService = createArtistService(api);
        const artistPageService = createArtistPageService(api);
        const artistImageService = createArtistImageService(api);
        const onboardingService = createOnboardingService(api);
        const recoService = createRecoService(api);
        const downloadService = createDownloadService(api);
        const syncService = createSyncService(api);
        const historyService = createHistoryService(api);
        const player = createPlayer(t, api, lifeService);
        const previewService = createPreviewService(api);
        const warmService = createWarmService(previewService, player);
        const likesService = createLikesService(api, () => downloadService.warm());
        ctx.effect(() => () => {
          downloadService.dispose();
          syncService.dispose();
          previewService.dispose();
        }, "dsh-music: s3 poll timers");
        downloadService.warm();
        syncService.warm();
        onboardingService.load().then((data) => {
          if (data && data.completed === false) ui.set({ needsMusicSetup: true });
        });
        ctx.effect(() => () => onboardingService.dispose(), "dsh-music: onboarding timer");
        const savedPrefs = readPrefs();
        const miniPrefsOk = savedPrefs.miniVersion === 2;
        if (!miniPrefsOk) writePrefs({ miniVersion: 2, miniHidden: false, miniCollapsed: false });
        const ui = createStore({
          view: "home",
          consoleMode: "playlist",
          consolePrompt: "",
          consoleLists: savedConsoleLists(),
          consoleLog: [],
          dockVisible: false,
          miniHidden: miniPrefsOk ? !!savedPrefs.miniHidden : false,
          miniCollapsed: miniPrefsOk ? !!savedPrefs.miniCollapsed : false,
          artistName: null,
          welcomePreview: false
        });
        const openView = (view) => ui.set({ view });
        const openArtistPage = (name) => ui.set({ view: "artist", artistName: name });
        const setMiniHidden = (hidden) => {
          ui.set(hidden ? { miniHidden: true } : { miniHidden: false, miniCollapsed: false });
          writePrefs(hidden ? { miniHidden: true } : { miniHidden: false, miniCollapsed: false });
        };
        const setMiniCollapsed = (collapsed) => {
          ui.set({ miniCollapsed: collapsed });
          writePrefs({ miniCollapsed: collapsed });
        };
        ctx.effect(() => () => {
          player.dispose();
          lifeService.dispose();
        }, "dsh-music: player and life");
        ctx.effect(() => {
          if (typeof document === "undefined") return () => {
          };
          const el = document.createElement("style");
          el.setAttribute("data-dsh-music", "");
          el.textContent = CSS + "\n" + ui_default + "\n" + creature_default + "\n" + habitat_default;
          document.head.appendChild(el);
          return () => {
            el.remove();
          };
        }, "dsh-music: styles");
        ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 30,
          label: () => t("panel"),
          locale: NS
        }, PanelIcon)), "dsh-music: sidebar entry");
        ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
          name: "main",
          key: PANEL_ID,
          locale: NS,
          inject: () => ({
            api,
            lifeService,
            player,
            library,
            lyrics: lyricsService,
            artist: artistService,
            artistImages: artistImageService,
            onboarding: onboardingService,
            reco: recoService,
            download: downloadService,
            sync: syncService,
            history: historyService,
            likes: likesService,
            preview: previewService,
            warm: warmService,
            openView,
            openArtistPage,
            setMiniHidden,
            ui,
            artistPage: artistPageService,
            hooks: {
              player: player.source,
              library: library.source,
              ui,
              lyrics: lyricsService.source,
              artist: artistService.source,
              artistPage: artistPageService.source,
              artistImages: artistImageService.source,
              onboarding: onboardingService.source,
              reco: recoService.source,
              download: downloadService.source,
              sync: syncService.source,
              history: historyService.source,
              likes: likesService.source,
              preview: previewService.source,
              warm: warmService.source
            }
          })
        }, MusicPanel)), "dsh-music: main panel");
        ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "dsh-music.mini-player",
          locale: NS,
          inject: () => ({
            lifeService,
            player,
            likes: likesService,
            lyrics: lyricsService,
            artistImages: artistImageService,
            setMiniHidden,
            setMiniCollapsed,
            openHome: () => {
              openView("home");
              ctx.layout.selectPanel(PANEL_ID);
            },
            openLibrary: () => {
              openView("library");
              ctx.layout.selectPanel(PANEL_ID);
            },
            openNow: () => {
              openView("now");
              ctx.layout.selectPanel(PANEL_ID);
            },
            openArtistPage: (name) => {
              if (!name) return;
              openArtistPage(name);
              ctx.layout.selectPanel(PANEL_ID);
            },
            hooks: { player: player.source, ui, lyrics: lyricsService.source, likes: likesService.source, artistImages: artistImageService.source }
          })
        }, (props) => portalToBody(h(EchoMini, props)))), "dsh-music: mini player");
        library.load();
      }
      return { inject, apply };
    }
  });
})();
