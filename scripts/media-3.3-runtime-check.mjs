// Structural runtime acceptance. No browser, renderer or speakers are opened.
import fs from 'node:fs/promises';
import { Box3, Vector3, AnimationMixer } from '../dist/vendor/three.module.js';
import { GLTFLoader } from '../dist/vendor/addons/loaders/GLTFLoader.js';

const report = [];
const manifest = JSON.parse(await fs.readFile(new URL('../dist/assets/characters/manifest.json', import.meta.url), 'utf8'));
for (const model of manifest.models) {
  const data = await fs.readFile(new URL(`../dist/${model.src}`, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new Vector3()).toArray();
  const mixer = new AnimationMixer(gltf.scene);
  const clips = [];
  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().play();
    mixer.update(Math.min(clip.duration * 0.5, 0.5));
    gltf.scene.updateMatrixWorld(true);
    let finite = true;
    gltf.scene.traverse(object => {
      if (object.isSkinnedMesh) {
        object.skeleton.update();
        for (const n of object.skeleton.boneMatrices) if (!Number.isFinite(n)) finite = false;
      }
    });
    if (!finite) throw new Error(`Non-finite pose: ${model.id}/${clip.name}`);
    clips.push({ name: clip.name, duration: clip.duration, finiteBoneMatrices: finite });
  }
  report.push({ id: model.id, parsed: true, meshes: gltf.parser.json.meshes.length,
    defaultPoseBounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size },
    clips, externalRequests: 0 });
}
await fs.writeFile(new URL('../qa/media-3.3-runtime-acceptance.json', import.meta.url), JSON.stringify({ status: 'pass', threeVersion: '0.180.0', models: report }, null, 2));
console.log(JSON.stringify(report.map(model => ({ id: model.id, parsed: model.parsed, clips: model.clips.length, size: model.defaultPoseBounds.size }))));
