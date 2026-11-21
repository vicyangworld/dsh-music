/**
 * ECHO's procedural bodies. This is a renderer, not a pet-image generator:
 * the same morphology always has the same geometry and identifying marks.
 * React is supplied by the Harness module table; no second React is shipped.
 */
import { getMorphology } from '../../../bundle/shared/life-core.js';

const clamp = (value, fallback = 0.5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const round = (n) => Math.round(n * 100) / 100;
const point = ([x, y]) => `${round(x)} ${round(y)}`;
const defaults = { structure: 'fold', seed: 0.37, elongation: 0.5, spread: 0.5, curvature: 0.5, folds: 0.5, texture: 0.5, warmth: 0.5, buoyancy: 0.5, phase: 0.5, accent: 0.5, marks: [] };

function normalizeMorphology(input) {
  const m = { ...defaults, ...(input || {}) };
  for (const key of Object.keys(defaults)) if (typeof defaults[key] === 'number') m[key] = clamp(m[key], defaults[key]);
  if (!['fold', 'shell', 'ribbon'].includes(m.structure)) m.structure = 'fold';
  m.marks = Array.isArray(m.marks) ? m.marks.filter((mark) => mark && typeof mark.id === 'string').slice(0, 8) : [];
  return m;
}

function palette(m, tone) {
  const hue = round(34 + m.accent * 114);
  const warm = m.warmth;
  const sat = round(8 + warm * 10);
  return {
    hue,
    saturation: sat,
    light: `hsl(${hue} ${sat - 2}% ${tone === 'dark' ? 95 : 97}%)`,
    paper: `hsl(${hue} ${sat}% 86%)`,
    middle: `hsl(${hue} ${sat}% ${70 + warm * 6}%)`,
    shade: `hsl(${hue} ${sat - 3}% ${49 + warm * 4}%)`,
    dark: `hsl(${hue} 10% 33%)`,
    line: `hsl(${hue} 10% 39%)`,
    copper: `hsl(${30 + warm * 10} 31% 51%)`,
  };
}

function random(seed, offset) {
  let value = (Math.floor(seed * 0x7fffffff) ^ Math.imul(offset + 1, 0x45d9f3b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
}

// Quadratic joins stay inside the sampled control-point hull. They remove the
// faceted edge of the ribbon without changing its seed, winding or opening.
function smoothPath(points, closed = false) {
  if (!points.length) return '';
  const middle = (a, b) => a.map((value, index) => (value + b[index]) / 2);
  if (closed) {
    return `M ${point(middle(points.at(-1), points[0]))} ${points.map((p, index) => `Q ${point(p)} ${point(middle(p, points[(index + 1) % points.length]))}`).join(' ')} Z`;
  }
  return `M ${point(points[0])} ${points.slice(1, -1).map((p, index) => `Q ${point(p)} ${point(middle(p, points[index + 2]))}`).join(' ')} Q ${point(points.at(-1))} ${point(points.at(-1))}`;
}

// Shrink only when necessary, around the body's fixed attachment point. Using
// the control-point hull also bounds every Bézier point between those controls.
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
  // Opening, handedness, coil tension and tail length belong to the individual;
  // musical traits move them continuously without replacing that identity.
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
    points.push([center[0] + Math.cos(angle) * rx * radius + Math.sin(angle) * shear,
      center[1] + Math.sin(angle) * ry * radius]);
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
  // Reserve up to 41px for the band itself, keeping full and compact views safe.
  const scale = fitScale(points, center, [124, 476, 100, 363]);
  return points.map(p => p.map((v, i) => center[i] + (v - center[i]) * scale));
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
    const outline = [root,
      [root[0] + (tip[0] - root[0]) * 0.34 - width * 0.2, root[1] - height * 0.34], [tip[0] - width * 0.38, tip[1] + height * 0.18], tip,
      [tip[0] + side * width * 0.56, tip[1] - curl], [edge[0] + curl * side, edge[1] + 11], edge,
      [root[0] + (edge[0] - root[0]) * 0.84, root[1] - height * 0.28], [root[0] + width * 0.32, root[1] - 25], root];
    const vein = [[root[0], root[1] - 2], [root[0] + (tip[0] - root[0]) * 0.38, root[1] - height * 0.39], [tip[0] + side * 7, tip[1] + height * 0.17], tip];
    leaves.push({ index, angle, side, outline, vein, edge, detail: [tip[0] + side * 13, tip[1] + height * 0.4] });
  }
  const scale = fitScale(leaves.flatMap(leaf => [...leaf.outline, ...leaf.vein, leaf.detail]), root, [78, 526, 78, 378]);
  const fit = p => p.map((v, i) => root[i] + (v - root[i]) * scale);
  return { root, leaves: leaves.map(leaf => ({ ...leaf, outline: leaf.outline.map(fit), vein: leaf.vein.map(fit), edge: fit(leaf.edge), detail: fit(leaf.detail) })) };
}

function foldTransforms({ root, leaves }, compact) {
  const rotatePoint = (p, leaf) => {
    const rad = -leaf.angle * 36 * Math.PI / 180;
    const x = p[0] - root[0], y = p[1] - root[1];
    return [root[0] + (Math.cos(rad) * x - Math.sin(rad) * y) * 0.8, root[1] + (Math.sin(rad) * x + Math.cos(rad) * y) * 0.8];
  };
  const compactFit = compact ? fitScale(leaves.flatMap(leaf => [...leaf.outline, ...leaf.vein, leaf.detail].map(p => rotatePoint(p, leaf))), root, [132, 468, 90, 394]) : 1;
  return leaves.map(leaf => {
    const rad = (compact ? -leaf.angle * 36 : 0) * Math.PI / 180, scale = compact ? 0.8 * compactFit : 1;
    const a = Math.cos(rad) * scale, b = Math.sin(rad) * scale, c = -Math.sin(rad) * scale, d = Math.cos(rad) * scale;
    return [a, b, c, d, root[0] - a * root[0] - c * root[1], root[1] - b * root[0] - d * root[1]].map(round);
  });
}

function renderFold(h, m, ids, colors, compact) {
  const geometry = foldGeometry(m);
  const { leaves } = geometry;
  const transforms = foldTransforms(geometry, compact);
  const petals = leaves.map(leaf => {
    const { index, side, outline, vein: line } = leaf;
    const d = `M ${point(outline[0])} C ${outline.slice(1, 4).map(point).join(' ')} C ${outline.slice(4, 7).map(point).join(' ')} C ${outline.slice(7).map(point).join(' ')} Z`;
    const vein = `M ${point(line[0])} C ${line.slice(1).map(point).join(' ')}`;
    const matrix = `matrix(${transforms[index].join(',')})`;
    const clip = `${ids.leafClip}-${index}`;
    return h('g', { key: `fold-${index}`, className: 'echo-fold-leaf', style: { transform: matrix, transformOrigin: '0 0', transitionDelay: `${Math.abs(index - leaves.length / 2) * 14}ms` } },
      h('defs', null, h('clipPath', { id: clip }, h('path', { d }))),
      h('path', { d, fill: `url(#${ids[`leaf${index % 3}`]})` }),
      h('g', { clipPath: `url(#${clip})` },
        h('path', { d, fill: `url(#${ids.surfaceLight})`, opacity: 0.2 }),
        h('path', { d, fill: `url(#${ids.rootShade})` }),
        h('path', { d: vein, fill: 'none', stroke: colors.line, strokeWidth: 1.1 + m.texture * 0.6, opacity: 0.075 + m.texture * 0.035 }),
        h('path', { d: vein, transform: `translate(${side * 1.4} -0.5)`, fill: 'none', stroke: colors.light, strokeWidth: 1, opacity: 0.32 }),
      ),
    );
  });
  return h('g', { className: 'echo-body-fold' },
    h('path', { d: 'M 274 345 C 281 321 312 318 329 341 C 347 359 334 376 309 379 C 282 381 261 365 274 345 Z', fill: `url(#${ids.underside})`, className: 'echo-fold-foot' }),
    ...petals,
    h('path', { d: 'M 293 346 C 293 321 303 297 314 276 C 323 296 330 323 323 347 C 315 365 300 365 293 346 Z', fill: `url(#${ids.ceramic})` }),
    h('path', { d: `M ${301 + m.seed * 5} 334 Q 309 326 318 333`, fill: 'none', stroke: colors.dark, strokeWidth: 2, strokeLinecap: 'round', opacity: 0.65 }),
    h('path', { d: 'M 305 353 Q 310 358 315 352', fill: 'none', stroke: colors.light, strokeWidth: 1, opacity: 0.4 }),
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
    [peak, [peak[0] + width * mix(0.17, 0.58, random(m.seed, 306)), peak[1]], [cx + width * 0.98, base - height * mix(0.43, 0.79, random(m.seed, 307))], right],
  ];
  const lower = [
    [right, [cx + width * 1.04, base + 8], [cx + width * 0.48, base + 18], [cx, base + 15]],
    [[cx, base + 15], [cx - width * 0.58, base + 14], [cx - width * 1.04, base - 3], left],
  ];
  const path = `M ${point(left)} ${[...upper, ...lower].map(segment => `C ${segment.slice(1).map(point).join(' ')}`).join(' ')} Z`;
  return { cx, base, width, height, upper, lower, path };
}

function shellOutline(m) { return shellGeometry(m).path; }
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
  // Tuck the feet while keeping their ground plane fixed, so resting does not
  // make a grounded life levitate above its own contact shadow.
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
    plates.push(h('path', {
      key: `plate-${i}`,
      d: `M ${point(top)} C ${point([top[0] + bend, top[1] + height * 0.32])} ${point([end[0] - bend, base - height * 0.18])} ${point(end)}`,
      fill: 'none', stroke: i % 2 ? colors.light : colors.line, strokeWidth: i % 2 ? 1.5 : 0.9, opacity: i % 2 ? 0.19 : 0.045 + m.texture * 0.045,
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
    feet.push(h('path', { key: `foot-${i}`, d: `M ${point([x - half, base - 3])} C ${point([x - half - 5, base + reach * 0.7])} ${point([x + toe - half, base + reach])} ${point([x + toe, base + reach])} C ${point([x + toe + half, base + reach])} ${point([x + half, base + 14])} ${point([x + half, base - 3])} Z`, fill: `url(#${ids.underside})` }));
  }
  const eye = [cx - width * 0.83, base - height * 0.13];
  const scar = shellSurface(shell, mix(0.24, 0.7, m.seed), 0.16);
  const gleam = Array.from({ length: 17 }, (_, i) => shellSurface(shell, 0.1 + i / 16 * 0.48, 0.1));
  return h('g', { className: 'echo-body-shell', style: { transform: `matrix(${shellTransform(m, compact, shell).join(',')})`, transformOrigin: '0 0' } },
    h('g', { className: 'echo-shell-feet', style: { transform: `translateY(${compact ? -13 : 0}px)` } },
      ...feet,
    ),
    h('path', { d: shell.path, transform: 'translate(0 3.5)', fill: `url(#${ids.underside})`, opacity: 0.8 }),
    h('path', { d: shell.path, fill: `url(#${ids.ceramic})` }),
    h('g', { clipPath: `url(#${ids.shellClip})` },
      h('path', { d: shell.path, fill: `url(#${ids.surfaceLight})`, opacity: 0.24 }),
      ...plates,
      h('path', { d: `M ${point([cx - width, base - 13])} Q ${point([cx, base + 21])} ${point([cx + width, base - 16])}`, fill: 'none', stroke: colors.shade, strokeWidth: 4.5, opacity: 0.08 }),
    ),
    h('path', { d: `M ${point(eye)} q 7 11 19 7`, fill: 'none', stroke: colors.dark, strokeWidth: 3.4, strokeLinecap: 'round', opacity: 0.84 }),
    h('path', { d: `M ${point(scar)} q 3 12 10 17`, fill: 'none', stroke: colors.copper, strokeWidth: 1.3, opacity: 0.42 }),
    h('path', { d: smoothPath(gleam), fill: 'none', stroke: colors.light, strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.25 }),
  );
}

function renderRibbon(h, m, ids, colors, compact) {
  const points = ribbonPoints(m);
  const outline = ribbonShape(points, m);
  const ridge = smoothPath(points.slice(0, 65));
  const edge = smoothPath(outline.left.slice(2, 50));
  const veins = [];
  const surfaces = [], lights = [];
  // Light each short surface patch across the band. A single whole-object
  // gradient makes a winding ribbon read as a flat cutout; these bounded
  // patches retain its width and twist while sharing the upper-left key light.
  for (let start = 0; start < points.length - 1; start += 4) {
    const end = Math.min(points.length - 1, start + 4), middle = Math.round((start + end) / 2);
    const left = outline.left[middle], right = outline.right[middle];
    const width = Math.hypot(left[0] - right[0], left[1] - right[1]) || 1;
    const key = clamp(0.5 + ((left[0] - right[0]) * -0.6 + (left[1] - right[1]) * -0.8) / width * 0.5);
    const color = lightness => `hsl(${colors.hue} ${colors.saturation}% ${round(lightness)}%)`;
    const id = `${ids.ribbon}-surface-${start}`;
    lights.push(h('linearGradient', { key: id, id, gradientUnits: 'userSpaceOnUse', x1: left[0], y1: left[1], x2: right[0], y2: right[1] },
      h('stop', { offset: '0%', stopColor: color(61 + key * 27) }),
      h('stop', { offset: '42%', stopColor: color(82 + Math.sin(middle / points.length * Math.PI) * 3) }),
      h('stop', { offset: '100%', stopColor: color(88 - key * 25) }),
    ));
    // Neighbouring opaque patches overlap by a sample. Without the overlap,
    // antialiasing exposes the darker base as an unwanted segmented grid.
    const from = Math.max(0, start - 1), to = Math.min(points.length - 1, end + 1);
    const contour = [...outline.left.slice(from, to + 1), ...outline.right.slice(from, to + 1).reverse()];
    surfaces.push(h('path', { key: start, d: `M ${contour.map(point).join(' L ')} Z`, fill: `url(#${id})` }));
  }
  const count = 5 + Math.round(m.texture * 2);
  for (let i = 0; i < count; i += 1) {
    const index = 12 + i * 9;
    veins.push(h('path', { key: `ribbon-rib-${i}`, d: `M ${point(outline.left[index])} Q ${point(points[index + 1])} ${point(outline.right[index + 2])}`, fill: 'none', stroke: colors.line, strokeWidth: 0.7 + m.texture * 0.3, opacity: 0.06 + m.texture * 0.055 }));
  }
  return h('g', { className: 'echo-body-ribbon', style: { transform: compact ? 'matrix(0.78, 0, 0, 0.72, 66, 89.6)' : 'matrix(1, 0, 0, 1, 0, 0)', transformOrigin: '0 0' } },
    h('defs', null,
      h('clipPath', { id: ids.ribbonClip }, h('path', { d: outline.path })),
      h('filter', { id: `${ids.ribbon}-softness`, x: '-10%', y: '-10%', width: '120%', height: '120%', colorInterpolationFilters: 'sRGB' }, h('feGaussianBlur', { stdDeviation: 4.5 })),
      ...lights,
    ),
    h('path', { d: outline.path, fill: `url(#${ids.ribbon})` }),
    h('g', { clipPath: `url(#${ids.ribbonClip})` },
      h('g', { filter: `url(#${ids.ribbon}-softness)` }, ...surfaces),
      h('path', { d: outline.path, fill: `url(#${ids.surfaceLight})`, opacity: 0.18 }),
      h('path', { d: edge, fill: 'none', stroke: colors.light, strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.43 }),
      h('path', { d: ridge, fill: 'none', stroke: colors.shade, strokeWidth: 1.5, opacity: 0.09 }),
      ...veins,
    ),
    h('path', { d: `M ${point(points[75])} Q ${point(points[78])} ${point(points[81])}`, fill: 'none', stroke: colors.dark, strokeWidth: 2.8, strokeLinecap: 'round', opacity: 0.65 }),
    h('path', { d: `M ${point(outline.right[20])} Q ${point(points[22])} ${point(outline.left[23])}`, fill: 'none', stroke: colors.copper, strokeWidth: 1.25, opacity: 0.42 }),
  );
}

function markerPlacement(m, mark, compact = false) {
  const at = clamp(mark.position);
  if (m.structure === 'ribbon') {
    const points = ribbonPoints(m);
    return { position: points[Math.round(mix(9, 62, at))], matrix: compact ? [0.78, 0, 0, 0.72, 66, 89.6] : [1, 0, 0, 1, 0, 0], delay: 0 };
  }
  if (m.structure === 'shell') {
    const shell = shellGeometry(m);
    return { position: shellSurface(shell, mix(0.12, 0.88, at), 0.32), matrix: shellTransform(m, compact, shell), delay: 0 };
  }
  const geometry = foldGeometry(m);
  const { leaves } = geometry;
  const leaf = leaves[Math.min(leaves.length - 1, Math.floor(at * leaves.length))];
  return { position: cubic(...leaf.vein, mix(0.58, 0.74, at)), matrix: foldTransforms(geometry, compact)[leaf.index], delay: Math.abs(leaf.index - leaves.length / 2) * 14 };
}

export function createCreatureComponents(React) {
  const h = React.createElement;
  const { useRef, useState, useEffect, useMemo } = React;
  let sequence = 0;

  function Creature({ life, morphology, active = false, compact = false, gesture = 0, onTouch, onMemorySelect, className = '', label, motionEnabled = true, tone = 'light', framing = 'stage' }) {
    const instance = useRef(null);
    if (!instance.current) instance.current = `echo-being-${++sequence}`;
    const root = useRef(null);
    const greetingTimers = useRef([]);
    const lastGesture = useRef(0);
    const [visible, setVisible] = useState(typeof document === 'undefined' || !document.hidden);
    const [response, setResponse] = useState(0);
    const [responseDuration, setResponseDuration] = useState(1300);
    const [responding, setResponding] = useState(false);
    const m = useMemo(() => normalizeMorphology(morphology || (life ? getMorphology(life) : defaults)), [life, morphology]);
    const colors = useMemo(() => palette(m, tone), [m, tone]);
    const ids = useMemo(() => Object.fromEntries(['ceramic', 'underside', 'ribbon', 'leaf0', 'leaf1', 'leaf2', 'surfaceLight', 'rootShade', 'leafClip', 'ribbonClip', 'contact', 'grain', 'shellClip', 'title', 'desc'].map((key) => [key, `${instance.current}-${key}`])), []);
    const canMove = motionEnabled && visible;
    const presence = framing === 'presence';
    const viewport = presence ? [52, 48, 496, 388] : compact ? [120, 70, 360, 340] : [0, 0, 600, 480];

    useEffect(() => {
      if (typeof document === 'undefined') return undefined;
      const change = () => {
        setVisible(!document.hidden);
        if (document.hidden) {
          greetingTimers.current.forEach(clearTimeout);
          greetingTimers.current = [];
          setResponding(false);
        }
      };
      document.addEventListener('visibilitychange', change);
      return () => document.removeEventListener('visibilitychange', change);
    }, []);

    useEffect(() => {
      if (!gesture || gesture === lastGesture.current) return undefined;
      lastGesture.current = gesture;
      greetingTimers.current.forEach(clearTimeout);
      greetingTimers.current = [];
      if (!canMove) return undefined;
      const pattern = life?.greeting?.pattern;
      const intervals = Array.isArray(pattern) && pattern.length >= 2 && pattern.length <= 8
        ? pattern.filter(Number.isFinite).map((ms) => Math.max(50, Math.min(5000, ms)))
        : [];
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
      if (!response) return undefined;
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
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      touch(event);
    };
    const look = (event) => {
      if (!canMove || (compact && !presence) || !root.current) return;
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const rect = root.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      root.current.style.setProperty('--echo-look-x', `${round(x * 2.7)}px`);
      root.current.style.setProperty('--echo-look-y', `${round(y * 1.6)}px`);
      root.current.style.setProperty('--echo-look-r', `${round(x * 0.75)}deg`);
    };
    const lookAway = () => {
      if (!root.current) return;
      root.current.style.setProperty('--echo-look-x', '0px');
      root.current.style.setProperty('--echo-look-y', '0px');
      root.current.style.setProperty('--echo-look-r', '0deg');
    };
    const name = label || life?.name || '你的音灵';
    const body = useMemo(() => m.structure === 'shell' ? renderShell(h, m, ids, colors, compact) : m.structure === 'ribbon' ? renderRibbon(h, m, ids, colors, compact) : renderFold(h, m, ids, colors, compact), [m, colors, compact]);
    const marks = useMemo(() => m.marks.map(mark => ({ mark, ...markerPlacement(m, mark, compact) })), [m, compact]);
    const stops = (items) => items.map(([offset, color, opacity]) => h('stop', { key: offset, offset, stopColor: color, ...(opacity == null ? {} : { stopOpacity: opacity }) }));
    const gradient = (id, x1, y1, x2, y2, items) => h('linearGradient', { id, x1, y1, x2, y2 }, ...stops(items));
    const memoryName = (mark) => life?.memories?.find((memory) => memory.id === mark.id)?.title || '共同记忆';
    const shell = m.structure === 'shell' ? shellGeometry(m) : null;
    const shadow = shell ? { x: shell.cx, y: shell.base + shellFootReach(m) + 2, width: shell.width * (compact ? 0.68 : 0.9) } : { x: 303, y: m.structure === 'ribbon' ? 397 : 383, width: m.structure === 'ribbon' ? 102 : 91 };

    return h('div', {
      ref: root,
      className: `echo-creature ${className}`.trim(),
      'data-structure': m.structure,
      'data-active': active ? 'true' : 'false',
      'data-compact': compact ? 'true' : 'false',
      'data-motion': canMove ? 'on' : 'off',
      'data-responding': responding ? 'true' : 'false',
      'data-tone': tone,
      'data-framing': presence ? 'presence' : 'stage',
      onPointerMove: look,
      onPointerLeave: lookAway,
      style: { '--echo-breath-duration': `${round(6.8 + m.phase * 3.6)}s`, '--echo-drift-duration': `${round(12 + m.seed * 6)}s`, '--echo-listen-duration': `${round(3.8 + (1 - m.buoyancy) * 1.6)}s`, '--echo-response-duration': `${responseDuration}ms`, '--echo-inhale': String(Number((1.006 + m.buoyancy * 0.008).toFixed(3))), '--echo-shadow-opacity': tone === 'dark' ? 0.31 : 0.21, '--echo-origin-x': `${round((303 - viewport[0]) / viewport[2] * 100)}%`, '--echo-origin-y': `${round((350 - viewport[1]) / viewport[3] * 100)}%` },
    }, h('svg', { viewBox: viewport.join(' '), className: 'echo-creature-svg', role: 'group', 'aria-labelledby': `${ids.title} ${ids.desc}`, focusable: false },
      h('title', { id: ids.title }, name),
      h('desc', { id: ids.desc }, compact ? '收拢身体，安静陪伴。' : '由共同经历塑造的生命。轻触身体与它打招呼，触摸身体上的小标记可以回看记忆。'),
      h('defs', null,
        h('radialGradient', { id: ids.ceramic, cx: '26%', cy: '18%', r: '96%', fx: '24%', fy: '15%' }, ...stops([['0%', colors.light], ['25%', colors.paper], ['62%', colors.middle], ['86%', colors.shade], ['100%', colors.dark]])),
        gradient(ids.underside, '8%', '0%', '74%', '100%', [['0%', colors.middle], ['62%', colors.shade], ['100%', colors.dark]]),
        gradient(ids.leaf0, '5%', '0%', '84%', '100%', [['0%', colors.light], ['29%', colors.paper], ['66%', colors.middle], ['100%', colors.shade]]),
        gradient(ids.leaf1, '8%', '0%', '88%', '100%', [['0%', colors.light], ['40%', colors.paper], ['76%', colors.middle], ['100%', colors.shade]]),
        gradient(ids.leaf2, '5%', '0%', '84%', '100%', [['0%', colors.paper], ['16%', colors.light], ['54%', colors.paper], ['79%', colors.middle], ['100%', colors.shade]]),
        gradient(ids.ribbon, '7%', '0%', '88%', '100%', [['0%', colors.light], ['26%', colors.paper], ['53%', colors.middle], ['76%', colors.shade], ['100%', colors.dark]]),
        h('radialGradient', { id: ids.surfaceLight, cx: '25%', cy: '18%', r: '83%' }, ...stops([['0%', colors.light, 0.72], ['46%', colors.light, 0.12], ['100%', colors.light, 0]])),
        h('linearGradient', { id: ids.rootShade, gradientUnits: 'userSpaceOnUse', x1: 304, y1: 351, x2: 303, y2: 180 }, ...stops([['0%', colors.dark, 0.2], ['44%', colors.dark, 0.035], ['100%', colors.dark, 0]])),
        h('radialGradient', { id: ids.contact }, ...stops([['0%', '#26362c', 0.75], ['36%', '#26362c', 0.27], ['100%', '#26362c', 0]])),
        h('clipPath', { id: ids.shellClip }, h('path', { d: shellOutline(m) })),
        h('filter', { id: ids.grain, x: '-8%', y: '-8%', width: '116%', height: '116%', colorInterpolationFilters: 'sRGB' },
          h('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.67, numOctaves: 2, seed: Math.floor(m.seed * 1000), stitchTiles: 'stitch', result: 'noise' }),
          h('feColorMatrix', { in: 'noise', type: 'saturate', values: 0, result: 'mono' }),
          h('feComponentTransfer', { in: 'mono', result: 'fine' }, h('feFuncA', { type: 'linear', slope: 0.025 + m.texture * 0.02 })),
          h('feComposite', { in: 'fine', in2: 'SourceGraphic', operator: 'in', result: 'surface' }),
          h('feBlend', { in: 'SourceGraphic', in2: 'surface', mode: 'multiply' }),
        ),
      ),
      h('ellipse', { cx: shadow.x, cy: shadow.y, rx: shadow.width, ry: m.structure === 'ribbon' ? 15 : 18, fill: `url(#${ids.contact})`, className: 'echo-creature-shadow' }),
      m.structure !== 'ribbon' ? h('ellipse', { cx: shadow.x, cy: shadow.y - 3, rx: shell ? shadow.width * 0.52 : 35, ry: 5.5, fill: `url(#${ids.contact})`, className: 'echo-creature-shadow echo-creature-contact' }) : null,
      h('g', { className: 'echo-creature-drift' },
        h('g', { className: 'echo-creature-attention' },
          h('g', { className: 'echo-creature-breath' },
            h('g', { className: 'echo-creature-response', key: `response-${response}` },
              h('g', {
                className: 'echo-creature-touch-target',
                role: onTouch ? 'button' : undefined,
                tabIndex: onTouch ? 0 : undefined,
                'aria-label': onTouch ? `和${name}打招呼` : undefined,
                onClick: onTouch ? touch : undefined,
                onKeyDown: onTouch ? keyboardTouch : undefined,
              },
                h('rect', { x: 119, y: 67, width: 364, height: 326, rx: 80, fill: 'transparent', pointerEvents: onTouch ? 'all' : 'none', className: 'echo-creature-focus-ring' }),
                h('g', { filter: compact && !presence ? undefined : `url(#${ids.grain})`, className: 'echo-creature-surface' }, body),
              ),
              !compact || presence ? h('g', { className: 'echo-creature-memories' }, ...marks.map(({ mark, position: [x, y], matrix, delay }) => {
                const click = (event) => { event.stopPropagation(); if (onMemorySelect) onMemorySelect(mark.id); };
                return h('g', { key: mark.id, className: 'echo-memory-pose', style: { transform: `matrix(${matrix.join(',')})`, transformOrigin: '0 0', transitionDelay: `${delay}ms` } }, h('g', {
                  className: 'echo-memory-mark', transform: `translate(${round(x)} ${round(y)})`,
                  role: onMemorySelect ? 'button' : undefined, tabIndex: onMemorySelect ? 0 : undefined,
                  'aria-label': `回看记忆：${memoryName(mark)}`,
                  onClick: onMemorySelect ? click : undefined,
                  onKeyDown: onMemorySelect ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); click(event); } } : undefined,
                },
                  h('circle', { r: presence ? 24 : 14, fill: 'transparent', className: 'echo-memory-hit' }),
                  h('path', { d: 'M -4 -3 Q -1 3 4 5 M -1 -5 Q 1 0 6 1', fill: 'none', stroke: colors.copper, strokeWidth: 1.6 + clamp(mark.strength) * 0.5, strokeLinecap: 'round' }),
                  h('circle', { r: 10, fill: 'none', stroke: colors.copper, strokeWidth: 0.8, className: 'echo-memory-halo' }),
                ));
              })) : null,
            ),
          ),
        ),
      ),
    ));
  }

  return { Creature };
}
