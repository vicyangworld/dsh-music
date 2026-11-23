/** Offline geometry QA. This is a Blender render, NOT a Harness screenshot. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createLife } from '../bundle/shared/life-core.js';
import { createBodyFromLife } from '../bundle/shared/body-core.js';
import { createBodyAnatomy } from '../src/client/echo/body-renderer.js';
import { createBodyMotionState, stepBodyMotion } from '../src/client/echo/body-motion.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'bundle/docs/assets/feifei-body-prototype.png'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-feifei-render-'));
const body = createBodyFromLife(createLife({ seed: 'feifei-qa', now: 1 }));
const anatomy = createBodyAnatomy(body), motion = createBodyMotionState(body);
try {
  for (let frame = 0; frame < 240; frame++) stepBodyMotion(motion, body, { pointer: [0.05, 0] }, 1 / 60);
  anatomy.applyPose(motion, body.descriptor); anatomy.group.updateMatrixWorld(true);
  const meshes = [], point = new THREE.Vector3(), world = new THREE.Matrix4(), instance = new THREE.Matrix4();
  anatomy.group.traverse(object => {
    if (!object.isMesh) return;
    if (object.isSkinnedMesh) object.skeleton.update();
    const count = object.isInstancedMesh ? object.count : 1;
    for (let index = 0; index < count; index++) {
      if (object.isInstancedMesh) { object.getMatrixAt(index, instance); world.multiplyMatrices(object.matrixWorld, instance); }
      else world.copy(object.matrixWorld);
      const positions = object.geometry.attributes.position, vertices = [];
      for (let vertex = 0; vertex < positions.count; vertex++) {
        point.fromBufferAttribute(positions, vertex);
        if (object.isSkinnedMesh) object.applyBoneTransform(vertex, point);
        point.applyMatrix4(world); vertices.push(point.toArray());
      }
      const color = object.material.color, attributes = object.geometry.attributes.color;
      // Offline diagnostic uses mean material colours. Runtime keeps its full
      // vertex-colour shading; the native renderer is only a geometry check.
      const average = [color.r, color.g, color.b];
      if (attributes) {
        average.fill(0);
        for (let vertex = 0; vertex < attributes.count; vertex++) {
          average[0] += attributes.getX(vertex) / attributes.count;
          average[1] += attributes.getY(vertex) / attributes.count;
          average[2] += attributes.getZ(vertex) / attributes.count;
        }
      }
      meshes.push({ vertices, indices: object.geometry.index ? Array.from(object.geometry.index.array) : Array.from({ length: positions.count }, (_, i) => i), color: average, roughness: object.material.roughness ?? 0.9 });
    }
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const data = path.join(temporary, 'geometry.json'), script = path.join(temporary, 'render.py');
  fs.writeFileSync(data, JSON.stringify(meshes));
  fs.writeFileSync(script, String.raw`
import bpy, json, sys
from mathutils import Vector
arguments=sys.argv[sys.argv.index('--')+1:]
with open(arguments[0]) as stream: meshes=json.load(stream)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials={}
for index, source in enumerate(meshes):
    geometry=bpy.data.meshes.new('part'+str(index))
    geometry.from_pydata([(v[0],-v[2],v[1]) for v in source['vertices']],[],[source['indices'][i:i+3] for i in range(0,len(source['indices']),3)])
    geometry.update()
    obj=bpy.data.objects.new('part'+str(index),geometry)
    bpy.context.collection.objects.link(obj)
    key=tuple(round(v,5) for v in source['color'])+(source['roughness'],)
    if key not in materials:
        material=bpy.data.materials.new('material'+str(index)); material.use_nodes=True
        shader=material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*source['color'],1)
        shader.inputs['Roughness'].default_value=source['roughness']
        materials[key]=material
    geometry.materials.append(materials[key])
    for polygon in geometry.polygons: polygon.use_smooth=True
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-0.01))
floor=bpy.context.object
material=bpy.data.materials.new('warm-neutral-floor');material.use_nodes=True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(0.78,0.75,0.70,1)
material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=0.95
floor.data.materials.append(material)
bpy.ops.object.camera_add(location=(4.1,-5.6,2.65))
camera=bpy.context.object; camera.rotation_euler=(Vector((-.12,-.08,.80))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=2.95
scene=bpy.context.scene;scene.camera=camera
for name,location,energy,size,color in [('key',(2.5,-3.5,5),550,4,(1,.94,.85)),('fill',(0,4,3),330,4,(.85,.94,1)),('front',(5,0,1.5),100,3,(1,.98,.94))]:
    bpy.ops.object.light_add(type='AREA',location=location)
    light=bpy.context.object;light.name=name;light.data.energy=energy;light.data.shape='DISK';light.data.size=size;light.data.color=color
    light.rotation_euler=(Vector((0,0,.7))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.samples=128;scene.cycles.use_denoising=False
scene.world.color=(.65,.65,.65)
scene.render.resolution_x=900;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
scene.render.filepath=arguments[1];scene.render.film_transparent=False
bpy.ops.render.render(write_still=True)
`);
  const result = spawnSync('blender', ['--background', '--python', script, '--', data, output], { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout.slice(-3000));
  console.log(JSON.stringify({ output, renderer: 'Blender offline geometry QA', runtimeScreenshot: false, materialApproximation: 'mean vertex colours', motionSource: motion.source, triangles: meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0) }));
} finally {
  anatomy.dispose();
  fs.rmSync(temporary, { recursive: true, force: true });
}
