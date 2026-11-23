import * as THREE from 'three';
import { createBodyMotionState, restoreBodyMotionState, captureBodyMotionState, retargetBodyMotionState, stepBodyMotion, motionRequestState, acceptMotionSequence, interpolateBodyDescriptor, reconcileBodyContacts } from './body-motion.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const smooth = t => t * t * (3 - 2 * t);
const UP = new THREE.Vector3(0, 1, 0);
let bodyViewSequence = 0;

function randomGenerator(seed) {
  let value = 2166136261;
  for (const letter of String(seed)) value = Math.imul(value ^ letter.charCodeAt(0), 16777619);
  return () => { value = Math.imul(value ^ value >>> 15, 1 | value); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

function makeEarGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.46, 0);
  shape.bezierCurveTo(-0.42, 0.38, -0.22, 0.94, 0, 1);
  shape.bezierCurveTo(0.23, 0.92, 0.43, 0.35, 0.45, 0);
  shape.quadraticCurveTo(0, -0.14, -0.46, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.10, bevelThickness: 0.09, bevelSegments: 3, steps: 1, curveSegments: 12 });
  geometry.rotateY(Math.PI / 2);
  return geometry;
}

/** All render assets derive from the same physical descriptor as the controller. */
export function createBodyAnatomy(body) {
  const group = new THREE.Group(), bones = {}, updaters = [], eyes = [];
  const geometries = new Set(), materials = new Set();
  const ownGeometry = geometry => { geometries.add(geometry); return geometry; };
  const ownMaterial = material => { materials.add(material); return material; };
  const sphere = ownGeometry(new THREE.SphereGeometry(1, 32, 24));
  const smallSphere = ownGeometry(new THREE.SphereGeometry(1, 16, 12));
  const coat = body.descriptor.appearance;
  const matte = (color, roughness = 0.93) => ownMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
  const furMaterial = matte(coat.coat), underMaterial = matte(coat.undercoat), maneMaterial = matte(coat.mane), tailMaterial = matte(coat.tail);
  const eyeMaterial = matte(coat.eye, 0.22), noseMaterial = matte(coat.nose, 0.65), earMaterial = matte(coat.ear);
  const highlightMaterial = matte('#fffaf2', 0.16), copperMaterial = matte('#ad835b', 0.57);
  for (const joint of body.descriptor.skeleton.joints) {
    const bone = new THREE.Bone();
    bone.name = joint.id; bone.position.fromArray(joint.rest); bones[joint.id] = bone;
    (joint.parent ? bones[joint.parent] : group).add(bone);
  }
  group.updateMatrixWorld(true);
  const orderedBones = body.descriptor.skeleton.joints.map(joint => bones[joint.id]);
  const skeleton = new THREE.Skeleton(orderedBones);
  const jointIndex = Object.fromEntries(body.descriptor.skeleton.joints.map((joint, index) => [joint.id, index]));

  function ellipsoid(parent, material, transform, geometry = sphere) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); updaters.push(d => transform(mesh, d));
    return mesh;
  }

  // A genuinely skinned torso. The geometry and inverse bind transforms evolve
  // together, so growing bone offsets never stretch an old binding by accident.
  const torsoGeometry = ownGeometry(new THREE.SphereGeometry(1, 40, 28));
  const torsoBase = Float32Array.from(torsoGeometry.attributes.position.array);
  const torsoIndices = [], torsoWeights = [], torsoColors = [];
  const coatColor = new THREE.Color(coat.coat), creamColor = new THREE.Color(coat.undercoat);
  for (let i = 0; i < torsoBase.length; i += 3) {
    const x = torsoBase[i], y = torsoBase[i + 1];
    const weight = Math.min(0.76, Math.abs(x) * 0.8);
    torsoIndices.push(jointIndex.root, jointIndex[x < 0 ? 'spine' : 'chest'], 0, 0);
    torsoWeights.push(1 - weight, weight, 0, 0);
    const color = coatColor.clone().lerp(creamColor, clamp((-y - 0.15) * 1.15, 0, 0.8));
    torsoColors.push(color.r, color.g, color.b);
  }
  torsoGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(torsoIndices, 4));
  torsoGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(torsoWeights, 4));
  torsoGeometry.setAttribute('color', new THREE.Float32BufferAttribute(torsoColors, 3));
  const torsoMaterial = ownMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
  const torso = new THREE.SkinnedMesh(torsoGeometry, torsoMaterial);
  torso.castShadow = true; torso.receiveShadow = true; torso.frustumCulled = false; torso.userData.part = 'torso';
  group.add(torso); torso.bind(skeleton);
  updaters.push(d => {
    const points = torsoGeometry.attributes.position;
    for (let i = 0; i < torsoBase.length; i += 3) points.setXYZ(i / 3, torsoBase[i] * d.bodyLength * 0.53,
      d.rootHeight + torsoBase[i + 1] * d.bodyHeight * 0.50, torsoBase[i + 2] * d.bodyWidth * 0.5);
    points.needsUpdate = true; torsoGeometry.computeVertexNormals(); torsoGeometry.computeBoundingSphere();
  });

  ellipsoid(bones.chest, underMaterial, (mesh, d) => { mesh.position.set(d.bodyLength * 0.04, -d.bodyHeight * 0.12, 0); mesh.scale.set(d.bodyLength * 0.25, d.bodyHeight * 0.40, d.bodyWidth * 0.43); });
  const head = ellipsoid(bones.head, furMaterial, (mesh, d) => { mesh.position.set(0, -d.headRadius * 0.03, 0); mesh.scale.set(d.headRadius, d.headRadius * 0.91, d.headRadius * 0.98); });
  head.userData.part = 'head';
  ellipsoid(bones.head, underMaterial, (mesh, d) => { mesh.position.set(d.headRadius * 0.45, -d.headRadius * 0.35, 0); mesh.scale.set(d.headRadius * 0.65, d.headRadius * 0.43, d.headRadius * 0.72); });
  for (const side of [-1, 1]) {
    ellipsoid(bones.head, underMaterial, (mesh, d) => { mesh.position.set(d.headRadius * 0.76, -d.headRadius * 0.20, side * d.headRadius * 0.18); mesh.scale.set(d.headRadius * 0.32, d.headRadius * 0.25, d.headRadius * 0.32); });
    const eye = ellipsoid(bones.head, eyeMaterial, (mesh, d) => { mesh.position.set(d.headRadius * 0.75, d.headRadius * 0.08, side * d.headRadius * 0.60 * body.identity.eyeSpacing); mesh.scale.set(d.headRadius * 0.11, d.headRadius * 0.145, d.headRadius * 0.115); });
    eyes.push(eye);
    ellipsoid(bones.head, highlightMaterial, (mesh, d) => { mesh.position.set(d.headRadius * 0.825, d.headRadius * 0.13, side * d.headRadius * 0.655 * body.identity.eyeSpacing); mesh.scale.setScalar(d.headRadius * 0.027); }, smallSphere);
    ellipsoid(bones.head, maneMaterial, (mesh, d) => { mesh.position.set(d.headRadius * 0.29, -d.headRadius * 0.14, side * d.headRadius * 0.81); mesh.scale.set(d.headRadius * 0.45, d.headRadius * 0.49, d.headRadius * 0.30); });
  }
  ellipsoid(bones.head, noseMaterial, (mesh, d) => { mesh.position.set(d.headRadius * 1.047, -d.headRadius * 0.14, 0); mesh.scale.set(d.headRadius * 0.073, d.headRadius * 0.065, d.headRadius * 0.10); }, smallSphere);
  const mouthGeometry = ownGeometry(new THREE.BufferGeometry());
  const mouthMaterial = ownMaterial(new THREE.LineBasicMaterial({ color: coat.nose, transparent: true, opacity: 0.53 }));
  const mouth = new THREE.Line(mouthGeometry, mouthMaterial); bones.head.add(mouth);
  updaters.push(d => mouthGeometry.setFromPoints([[1.052, -0.19, 0], [1.061, -0.255, 0], [1.02, -0.29, 0.065]].map(v => new THREE.Vector3(...v.map(n => n * d.headRadius)))));
  const earGeometry = ownGeometry(makeEarGeometry());
  for (const side of ['left', 'right']) {
    const ear = new THREE.Mesh(earGeometry, furMaterial); bones[`ear.${side}`].add(ear);
    ear.castShadow = true;
    const inside = new THREE.Mesh(earGeometry, earMaterial); ear.add(inside); inside.position.set(0.13, 0.10, 0); inside.scale.set(0.22, 0.76, 0.70);
    updaters.push(d => { ear.scale.set(d.earLength * 0.86, d.earLength * 0.78, d.earLength * 0.96); ear.rotation.x = (side === 'left' ? 1 : -1) * (0.19 + body.identity.earTilt); });
  }

  // Mane volume is attached to the neck instead of screen coordinates.
  const random = randomGenerator(body.seed);
  const mane = new THREE.InstancedMesh(smallSphere, maneMaterial, 22); bones.neck.add(mane); mane.castShadow = true;
  const maneSeeds = Array.from({ length: 22 }, () => [random(), random()]);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), orientation = new THREE.Quaternion();
  updaters.push(d => {
    for (let i = 0; i < 22; i++) {
      const angle = i / 22 * Math.PI * 2, radius = d.headRadius * 0.71 + d.maneFullness * 0.45;
      position.set(-0.025 - maneSeeds[i][0] * 0.095, Math.cos(angle) * radius - d.headRadius * 0.11, Math.sin(angle) * radius);
      const size = 0.058 + d.maneFullness * 0.24 + maneSeeds[i][1] * 0.026;
      scale.set(size * (1.6 + maneSeeds[i][1] * 0.3), size * 0.94, size * 1.12); orientation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -angle);
      matrix.compose(position, orientation, scale); mane.setMatrixAt(i, matrix);
    }
    mane.instanceMatrix.needsUpdate = true; mane.boundingSphere = null;
  });

  for (const end of ['front', 'rear']) for (const side of ['left', 'right']) {
    const prefix = `leg.${end}.${side}`;
    for (const [joint, child, width] of [['hip', 'knee', 0.12], ['knee', 'ankle', 0.098]]) {
      ellipsoid(bones[`${prefix}.${joint}`], furMaterial, (mesh, d) => {
        const rest = bones[`${prefix}.${child}`].position;
        mesh.position.copy(rest).multiplyScalar(0.47);
        mesh.quaternion.setFromUnitVectors(UP, rest.clone().normalize());
        mesh.scale.set(width * (0.75 + d.bodyWidth * 0.4), rest.length() * 0.64, width * (0.78 + d.bodyWidth * 0.42));
      });
    }
    const paw = ellipsoid(bones[`${prefix}.ankle`], underMaterial, (mesh, d) => { mesh.position.set(d.pawRadius * 0.17, 0, 0); mesh.scale.set(d.pawRadius * 1.28, d.footHeight, d.pawRadius); });
    paw.userData.part = `foot.${end}.${side}`;
  }

  // Continuous tail mesh: adjacent joints share vertices by blended weights.
  const ringCount = 36, sides = 14, tailPositions = [], tailIndices = [], tailWeights = [], tailFaces = [], tailColors = [];
  for (let ring = 0; ring <= ringCount; ring++) {
    const t = ring / ringCount, span = Math.min(4, Math.floor(t * 5)), blend = Math.min(1, t * 5 - span);
    for (let side = 0; side <= sides; side++) {
      tailPositions.push(0, 0, 0);
      tailIndices.push(jointIndex[`tail.${span}`], jointIndex[`tail.${span + 1}`], 0, 0);
      tailWeights.push(1 - blend, blend, 0, 0);
      const color = new THREE.Color(coat.tail).lerp(coatColor, Math.max(0, 0.26 - t * 1.5)); tailColors.push(color.r, color.g, color.b);
      if (ring < ringCount && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        tailFaces.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const tailGeometry = ownGeometry(new THREE.BufferGeometry());
  tailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tailPositions, 3));
  tailGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(tailIndices, 4));
  tailGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(tailWeights, 4));
  tailGeometry.setAttribute('color', new THREE.Float32BufferAttribute(tailColors, 3)); tailGeometry.setIndex(tailFaces);
  const tail = new THREE.SkinnedMesh(tailGeometry, ownMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 })));
  tail.castShadow = true; tail.receiveShadow = true; tail.frustumCulled = false; tail.userData.part = 'tail'; group.add(tail); tail.bind(skeleton);

  // Sparse fine tufts soften the silhouette; they are geometry, not a texture
  // painted over changing poses. Deterministic placement preserves identity.
  const tuftGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 4, 1));
  function fur(parent, count, material, dimensions) {
    const mesh = new THREE.InstancedMesh(tuftGeometry, material, count);
    mesh.frustumCulled = false; parent.add(mesh);
    const seeds = Array.from({ length: count }, () => [random(), random(), random()]);
    updaters.push(d => {
      const [center, radii, strand] = dimensions(d);
      for (let i = 0; i < count; i++) {
        const y = 1 - 2 * seeds[i][0], phi = seeds[i][1] * Math.PI * 2, planar = Math.sqrt(1 - y * y);
        const normal = new THREE.Vector3(Math.cos(phi) * planar, y, Math.sin(phi) * planar);
        position.set(center[0] + normal.x * radii[0], center[1] + normal.y * radii[1], center[2] + normal.z * radii[2]);
        orientation.setFromUnitVectors(UP, normal);
        const height = strand * (0.62 + seeds[i][2] * 0.65); scale.set(height * 0.26, height, height * 0.26);
        position.addScaledVector(normal, height * 0.18); matrix.compose(position, orientation, scale); mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.boundingSphere = null;
    });
  }
  fur(bones.root, 250, furMaterial, d => [[0, 0, 0], [d.bodyLength * 0.53, d.bodyHeight * 0.495, d.bodyWidth * 0.5], 0.015]);
  fur(bones.head, 160, furMaterial, d => [[0, -d.headRadius * 0.03, 0], [d.headRadius * 0.99, d.headRadius * 0.90, d.headRadius * 0.97], 0.010]);
  const tuftSource = tuftGeometry.toNonIndexed(), tuftVertices = tuftSource.attributes.position;
  const tailTuftSeeds = Array.from({ length: 180 }, () => [random() * 0.98, random() * Math.PI * 2, random()]);
  const tailFurPositions = [], tailFurIndices = [], tailFurWeights = [];
  for (const [t] of tailTuftSeeds) {
    const span = Math.min(4, Math.floor(t * 5)), blend = t * 5 - span;
    for (let v = 0; v < tuftVertices.count; v++) { tailFurPositions.push(0, 0, 0); tailFurIndices.push(jointIndex[`tail.${span}`], jointIndex[`tail.${span + 1}`], 0, 0); tailFurWeights.push(1 - blend, blend, 0, 0); }
  }
  const tailFurGeometry = ownGeometry(new THREE.BufferGeometry());
  tailFurGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tailFurPositions, 3));
  tailFurGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(tailFurIndices, 4));
  tailFurGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(tailFurWeights, 4));
  const tailFur = new THREE.SkinnedMesh(tailFurGeometry, tailMaterial); group.add(tailFur); tailFur.bind(skeleton); tailFur.frustumCulled = false;

  const memoryGroup = new THREE.Group(); bones.neck.add(memoryGroup);
  let memoryKey = '';
  function setMemories(memories = []) {
    const list = memories.slice(-5), key = list.map(item => item.id).join('|');
    if (key === memoryKey) return; memoryKey = key;
    while (memoryGroup.children.length) memoryGroup.remove(memoryGroup.children[0]);
    list.forEach((memory, index) => {
      const bead = new THREE.Mesh(smallSphere, copperMaterial); bead.userData.memoryId = memory.id;
      bead.position.set(0.12 - index * 0.055, -0.16 - Math.sin(index * 0.5) * 0.05, 0.23); bead.scale.set(0.018, 0.031, 0.016); bead.rotation.z = 0.35;
      memoryGroup.add(bead);
    });
  }
  let previousDimensions = '';
  function updateDescriptor(descriptor) {
    const key = JSON.stringify(descriptor.dimensions);
    if (key === previousDimensions) return;
    previousDimensions = key;
    for (const joint of descriptor.skeleton.joints) bones[joint.id].position.fromArray(joint.rest);
    skeleton.boneInverses = descriptor.skeleton.joints.map(joint => new THREE.Matrix4().makeTranslation(...joint.restWorld.map(n => -n)));
    updaters.forEach(update => update(descriptor.dimensions));
    const tailJoints = descriptor.skeleton.joints.filter(joint => joint.id.startsWith('tail.'));
    const points = tailGeometry.attributes.position, d = descriptor.dimensions;
    for (let ring = 0; ring <= ringCount; ring++) {
      const t = ring / ringCount, span = Math.min(4, Math.floor(t * 5)), blend = Math.min(1, t * 5 - span);
      const start = new THREE.Vector3(...tailJoints[span].restWorld), end = new THREE.Vector3(...tailJoints[span + 1].restWorld), center = start.clone().lerp(end, blend);
      const radius = d.tailFullness * (0.65 + 0.37 * Math.sin(Math.PI * t)) * Math.pow(Math.max(0.0001, 1 - t * t), 0.6);
      for (let side = 0; side <= sides; side++) {
        const theta = side / sides * Math.PI * 2;
        points.setXYZ(ring * (sides + 1) + side, center.x, center.y + Math.cos(theta) * radius, center.z + Math.sin(theta) * radius);
      }
    }
    points.needsUpdate = true; tailGeometry.computeVertexNormals(); tailGeometry.computeBoundingSphere();
    const furPoints = tailFurGeometry.attributes.position, vertex = new THREE.Vector3();
    tailTuftSeeds.forEach(([t, theta, size], tuft) => {
      const span = Math.min(4, Math.floor(t * 5)), blend = t * 5 - span;
      const start = new THREE.Vector3(...tailJoints[span].restWorld), end = new THREE.Vector3(...tailJoints[span + 1].restWorld), center = start.lerp(end, blend);
      const radius = d.tailFullness * (0.65 + 0.37 * Math.sin(Math.PI * t)) * Math.pow(Math.max(0.0001, 1 - t * t), 0.6);
      const normal = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta)), height = 0.014 + size * 0.008;
      center.addScaledVector(normal, radius + height * 0.15); orientation.setFromUnitVectors(UP, normal);
      for (let v = 0; v < tuftVertices.count; v++) {
        vertex.fromBufferAttribute(tuftVertices, v).multiply(new THREE.Vector3(height * 0.18, height, height * 0.18)).applyQuaternion(orientation).add(center);
        furPoints.setXYZ(tuft * tuftVertices.count + v, vertex.x, vertex.y, vertex.z);
      }
    });
    furPoints.needsUpdate = true; tailFurGeometry.computeVertexNormals(); tailFurGeometry.computeBoundingSphere();
  }
  function applyPose(state, descriptor) {
    bones.root.position.fromArray(state.root);
    for (const [id, q] of Object.entries(state.rotations)) if (bones[id]) bones[id].quaternion.fromArray(q);
    const cycle = state.time % 8.4;
    const blink = cycle > 6.9 && cycle < 7.08 ? 1 - Math.sin((cycle - 6.9) / 0.18 * Math.PI) * 0.93 : 1;
    for (const eye of eyes) eye.scale.y = descriptor.dimensions.headRadius * 0.145 * blink;
    torso.boundingSphere = null; tail.boundingSphere = null; tailFur.boundingSphere = null;
  }
  updateDescriptor(body.descriptor);
  return { group, updateDescriptor, applyPose, setMemories, dispose() { skeleton.dispose(); tuftSource.dispose(); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); } };
}

/** No DOM probing, animation loops or network work happens until called. */
export function createBodyRenderer(canvas, options) {
  if (!canvas || !options.body?.descriptor) throw new Error('可生长身体资源尚未就绪');
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!context) throw new Error('当前环境未提供 WebGL 2');
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 30);
  camera.position.set(4.1, 2.65, 5.6);
  const hemisphere = new THREE.HemisphereLight('#fff8ec', '#a9aca0', 2.45); scene.add(hemisphere);
  const key = new THREE.DirectionalLight('#fff5e6', 3.15); key.position.set(2.5, 5, 3.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
  key.shadow.normalBias = 0.035; key.shadow.bias = -0.0004; key.shadow.radius = 4; scene.add(key);
  const rim = new THREE.DirectionalLight('#e7f0ee', 1.45); rim.position.set(-3, 2, -4); scene.add(rim);
  const groundGeometry = new THREE.PlaneGeometry(8, 8), groundMaterial = new THREE.ShadowMaterial({ opacity: 0.13, depthWrite: false });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; ground.receiveShadow = true; scene.add(ground);
  let body = options.body, anatomy = createBodyAnatomy(body), motion = restoreBodyMotionState(body, options.motionSnapshot), descriptor = body.descriptor;
  let transition = null, inputs = { active: false, energy: 0, pointer: null, touch: 0 }, disposed = false, playing = false, visible = typeof IntersectionObserver === 'undefined', raf = 0, previousTime = 0;
  let motionEnabled = options.motionEnabled !== false, lastSource = '', width = 1, height = 1;
  scene.add(anatomy.group);
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  function status() {
    if (lastSource === motion.source) return;
    lastSource = motion.source;
    canvas.dataset.motionSource = motion.source; canvas.dataset.bodyRevision = String(body.bodyRevision);
    options.onStatus?.({ renderer: 'three', source: motion.source, bodyRevision: body.bodyRevision, model: motion.sequence?.model || null });
  }
  function fitCamera() {
    const d = descriptor.dimensions, aspect = width / height;
    const totalHeight = d.rootHeight + d.bodyHeight * 0.38 + d.headRadius + d.earLength;
    const visibleWidth = d.bodyLength + d.tailLength * 0.65 + d.headRadius * 1.4;
    const vertical = Math.max(totalHeight * 1.10, visibleWidth * 0.87 / aspect);
    camera.left = -vertical * aspect / 2; camera.right = vertical * aspect / 2; camera.top = vertical / 2; camera.bottom = -vertical / 2;
    camera.lookAt(-d.bodyLength * 0.11, totalHeight * 0.45, d.tailLength * 0.08); camera.updateProjectionMatrix();
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, options.compact ? 1.5 : 2)); renderer.setSize(width, height, false); fitCamera(); draw();
  }
  function draw() {
    if (disposed) return;
    anatomy.applyPose(motion, descriptor); renderer.render(scene, camera); status();
  }
  function tick(timestamp) {
    raf = 0;
    if (disposed || !playing) return;
    const dt = previousTime ? Math.min(0.05, (timestamp - previousTime) / 1000) : 1 / 60; previousTime = timestamp;
    if (transition) {
      transition.elapsed += dt;
      const t = smooth(clamp(transition.elapsed / 1.8, 0, 1));
      descriptor = interpolateBodyDescriptor(transition.from, body.descriptor, t);
      anatomy.updateDescriptor(descriptor); fitCamera(); if (t === 1) transition = null;
    }
    stepBodyMotion(motion, { ...body, descriptor }, inputs, dt); draw();
    raf = requestAnimationFrame(tick);
  }
  const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
  function schedule() {
    const wasPlaying = playing;
    playing = motionEnabled && visible && !document.hidden && !media?.matches;
    if (wasPlaying !== playing) options.onVisibility?.(playing);
    if (playing && !raf) { previousTime = 0; raf = requestAnimationFrame(tick); }
    if (!playing && raf) { cancelAnimationFrame(raf); raf = 0; previousTime = 0; }
    if (!playing && transition) { descriptor = body.descriptor; anatomy.updateDescriptor(descriptor); transition = null; motion.root[1] = descriptor.dimensions.rootHeight; reconcileBodyContacts(motion, descriptor); fitCamera(); }
    if (!playing) draw();
  }
  function pointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    inputs.pointer = [clamp((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -1, 1), clamp((event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1, -1, 1)];
  }
  function pointerLeave() { inputs.pointer = null; }
  function activate(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -((event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(anatomy.group, true);
    const memory = hits.find(hit => hit.object.userData.memoryId);
    if (memory) { options.onMemorySelect?.(memory.object.userData.memoryId); return; }
    if (!hits.length) return;
    inputs.touch += 1; options.onTouch?.(event);
  }
  function contextLost(event) { event.preventDefault(); options.onError?.(new Error('图形上下文已中断')); }
  canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerleave', pointerLeave); canvas.addEventListener('click', activate); canvas.addEventListener('webglcontextlost', contextLost);
  document.addEventListener('visibilitychange', schedule); media?.addEventListener?.('change', schedule);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas); if (!observer) window.addEventListener('resize', resize);
  const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => { visible = !!entries[0]?.isIntersecting; schedule(); }, { threshold: 0.01 }) : null;
  intersection?.observe(canvas);
  function dispose() {
    if (disposed) return; disposed = true; if (raf) cancelAnimationFrame(raf);
    observer?.disconnect(); intersection?.disconnect(); if (!observer) window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', schedule); media?.removeEventListener?.('change', schedule);
    canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerleave', pointerLeave); canvas.removeEventListener('click', activate); canvas.removeEventListener('webglcontextlost', contextLost);
    anatomy.dispose(); groundGeometry.dispose(); groundMaterial.dispose(); key.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
  try { resize(); schedule(); } catch (error) { dispose(); throw error; }
  return {
    setBody(next) {
      if (disposed || !next?.descriptor) return;
      if (next.lifeId !== body.lifeId || next.topology !== body.topology) {
        scene.remove(anatomy.group); anatomy.dispose(); body = next; anatomy = createBodyAnatomy(body); scene.add(anatomy.group); motion = createBodyMotionState(body); descriptor = body.descriptor; transition = null;
      } else if (next.bodyRevision !== body.bodyRevision || next.contentId !== body.contentId) {
        transition = { from: descriptor, elapsed: 0 }; body = next; motion = retargetBodyMotionState(motion, body);
      } else body = next;
      lastSource = ''; schedule();
    },
    setInputs(next) { inputs = { ...inputs, ...next }; if (next.motionEnabled !== undefined) { motionEnabled = !!next.motionEnabled; schedule(); } if (next.tone) { groundMaterial.opacity = next.tone === 'dark' ? 0.25 : 0.13; renderer.toneMappingExposure = next.tone === 'dark' ? 1.13 : 1.22; } if (next.memories !== undefined) anatomy.setMemories(next.memories); if (!playing) draw(); },
    setMotionSequence(sequence) { if (!playing || transition) return false; return acceptMotionSequence(motion, sequence); },
    getMotionState() { return motionRequestState(motion); },
    getMotionSnapshot() { return captureBodyMotionState(motion); },
    getMotionGoal() { const p = inputs.pointer || [0, 0], d = descriptor.dimensions; return { target: [d.bodyLength * 0.65 + 0.35, d.rootHeight + d.bodyHeight * 0.30 - p[1] * 0.35, p[0] * 0.85], attention: inputs.pointer ? 0.9 : 0.25, energy: clamp(inputs.energy ?? (inputs.active ? 0.5 : 0.12), 0, 1) }; },
    getStatus() { return { visible: playing, growing: !!transition, source: motion.source, bodyRevision: body.bodyRevision, contactError: motion.contactError }; },
    touch() { inputs.touch += 1; },
    dispose,
  };
}

/** React stays host-provided. Missing bodies and historic views retain SVG. */
export function createBodyComponents(React, { FallbackCreature }) {
  const h = React.createElement;
  function BodyCreature(props) {
    const { body, life, motionProvider, music, active = false, motionEnabled = true, compact = false, tone = 'light', framing = 'stage', gesture = 0, onTouch, onMemorySelect, className = '', label } = props;
    const canvas = React.useRef(null), runtime = React.useRef(null), latest = React.useRef(props), requestSequence = React.useRef(0), viewId = React.useRef(null), requestController = React.useRef(null);
    if (viewId.current === null) viewId.current = ++bodyViewSequence;
    latest.current = props;
    const [failed, setFailed] = React.useState(false), [source, setSource] = React.useState('procedural');
    const identity = body ? `${body.lifeId}:${body.topology}` : '';
    React.useEffect(() => { setFailed(false); }, [identity]);
    React.useEffect(() => {
      if (!body || !canvas.current || failed) return undefined;
      const remember = () => { if (runtime.current) { const snapshot = runtime.current.getMotionSnapshot(); latest.current.motionMemory?.write(snapshot); latest.current.onMotionSnapshot?.(snapshot); } };
      try {
        runtime.current = createBodyRenderer(canvas.current, { body, compact, motionEnabled, motionSnapshot: props.motionMemory?.read(body) || props.motionSnapshot,
          onTouch: event => { remember(); latest.current.onTouch?.(event); }, onMemorySelect: id => latest.current.onMemorySelect?.(id),
          onStatus: status => setSource(status.source), onError: () => setFailed(true),
          onVisibility: visible => { if (!visible) { requestController.current?.abort(); remember(); } },
        });
        runtime.current.setInputs({ active, tone, memories: life?.memories || [], energy: music?.energy });
      } catch (_) { setFailed(true); }
      return () => { requestController.current?.abort(); remember(); runtime.current?.dispose(); runtime.current = null; };
    }, [identity, failed]);
    React.useEffect(() => { runtime.current?.setBody(body); }, [body]);
    React.useEffect(() => { runtime.current?.setInputs({ active, motionEnabled, tone, memories: life?.memories || [], energy: music?.energy }); }, [active, motionEnabled, tone, life?.memories, music?.energy]);
    React.useEffect(() => { if (gesture) runtime.current?.touch(); }, [gesture]);
    React.useEffect(() => {
      if (!motionProvider || !body || failed) return undefined;
      let cancelled = false, busy = false;
      const generate = async () => {
        const current = latest.current, renderer = runtime.current;
        if (cancelled || busy || !renderer || !renderer.getStatus().visible || renderer.getStatus().growing || !motionProvider.getSnapshot?.().available) return;
        busy = true;
        const controller = new AbortController(); requestController.current = controller;
        const currentBody = current.body, requestId = `${currentBody.lifeId}:${currentBody.bodyRevision}:v${viewId.current}:${++requestSequence.current}`;
        try {
          const state = renderer.getMotionState();
          const response = await motionProvider.generate({ protocol: 'echo-motion/1', requestId, body: currentBody, state,
            goal: renderer.getMotionGoal(),
            music: { energy: 0, brightness: 0.5, rhythm: 0.5, texture: 0.5, ...current.music },
            style: { tempo: currentBody.identity.expressionSignature[0], attention: currentBody.identity.expressionSignature[1], amplitude: currentBody.identity.expressionSignature[2] },
          }, { signal: controller.signal });
          if (!cancelled && latest.current.body?.bodyRevision === currentBody.bodyRevision && latest.current.body?.lifeId === currentBody.lifeId) renderer.setMotionSequence(response);
        } catch (_) { /* Provider owns diagnostics. The local motor remains honest. */ }
        finally { busy = false; if (requestController.current === controller) requestController.current = null; }
      };
      const timer = setInterval(generate, 1400); generate();
      return () => { cancelled = true; requestController.current?.abort(); clearInterval(timer); };
    }, [motionProvider, identity, failed]);
    if (!body || failed) return h(FallbackCreature, props);
    const name = label || life?.name || '你的音灵';
    const memories = life?.memories?.slice(-5) || [];
    return h('div', { className: `echo-creature echo-body-creature ${className}`.trim(), 'data-structure': 'feifei', 'data-renderer': 'three', 'data-motion-source': source,
      'data-body-revision': body.bodyRevision, 'data-active': active ? 'true' : 'false', 'data-compact': compact ? 'true' : 'false', 'data-motion': motionEnabled ? 'on' : 'off', 'data-tone': tone, 'data-framing': framing },
      h('canvas', { ref: canvas, className: 'echo-body-canvas', role: onTouch ? 'button' : 'img', tabIndex: onTouch ? 0 : undefined, 'aria-label': onTouch ? `和${name}打招呼` : name,
        onKeyDown: event => { if (onTouch && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); runtime.current?.touch(); onTouch(event); } } }),
      memories.length && onMemorySelect ? h('div', { className: 'echo-body-memory-access', 'aria-label': '共同记忆' }, ...memories.map(memory => h('button', { key: memory.id, type: 'button', onClick: () => onMemorySelect(memory.id), 'aria-label': `回看记忆：${memory.title || '共同记忆'}` }, memory.title || '共同记忆'))) : null,
    );
  }
  return { BodyCreature, Creature: BodyCreature };
}
