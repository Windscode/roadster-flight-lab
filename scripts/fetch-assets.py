from pathlib import Path
import re, urllib.request, posixpath, concurrent.futures

ROOT = Path(__file__).resolve().parents[1] / 'dist'
BASE = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/'
queue = ['controls/OrbitControls.js', 'loaders/HDRLoader.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js', 'postprocessing/ShaderPass.js', 'shaders/FXAAShader.js', 'postprocessing/SSAOPass.js', 'objects/Reflector.js', 'csm/CSM.js', 'exporters/GLTFExporter.js']
seen = set()
while queue:
    name = queue.pop(0)
    if name in seen: continue
    seen.add(name)
    text = urllib.request.urlopen(BASE + name, timeout=40).read().decode()
    for dep in re.findall(r"from\s+['\"]([^'\"]+)['\"]", text):
        if dep.startswith('.'):
            queue.append(posixpath.normpath(posixpath.join(posixpath.dirname(name), dep)))
    path = ROOT / 'vendor/addons' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    rel = posixpath.relpath('three.module.js', 'addons/' + posixpath.dirname(name))
    text = re.sub(r"from\s+(['\"])three\1", 'from ' + repr(rel), text)
    path.write_text(text)
    print('vendor', name, flush=True)

assets = {
    'environment.hdr': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kiara_2_sunrise_1k.hdr',
    'concrete.jpg': 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_diff_1k.jpg',
    'concrete-normal.jpg': 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_nor_gl_1k.jpg',
    'concrete-roughness.jpg': 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_rough_1k.jpg',
}
def fetch(item):
    name, url = item
    try:
        data = urllib.request.urlopen(url,timeout=60).read()
        (ROOT/'assets'/name).write_bytes(data)
        return name, len(data)
    except Exception as e: return name, str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
    for result in ex.map(fetch, assets.items()): print(result, flush=True)

