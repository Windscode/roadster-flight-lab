// Surface-study presentation only. Frozen mesh identities and exported data
// never pass through translation.
export const entries={
  '对照版本':'Reference version',
  '当前 3.10 外观':'Current 3.10 exterior',
  '3.9 外观基线':'Original 3.9 exterior',
  '对照原始帧 + 同次条件 ZIP':'Original comparison frames + conditions ZIP',
  '导出当前状态 JSON（独立）':'Export current state JSON (independent)',
  'ZIP 包含两张未经缩放的真实 WebGL 原始帧、另附标注的对照图，以及由同一 captureId 关联的同次条件。采集时冻结相机与物理状态；独立 JSON 仅记录点击时的当前状态，不关联之前导出的图片。':'The ZIP contains two unscaled original WebGL frames, a separately labelled comparison, and matching conditions linked by one captureId. Camera and physics are frozen during capture. An independent JSON records the state when clicked; it is not linked to earlier images.',
  '正在锁定机位与物理状态，采集同条件双帧…':'Locking camera and physics to capture matching frames…',
  '两张原始帧、对照图与同次条件已合并导出；captureId 将它们关联。':'Two original frames, the comparison and matching conditions were exported together, linked by their captureId.',
  '采集时 WebGL 上下文不可用。':'The WebGL context is unavailable during capture.',
  '同一支 50 mm 镜头、同一光棚，对照当前模型与冻结的 3.9 / 3.8 外观。拖动环视；固定机位用于重复采集。':'Compare the current model with frozen 3.9 / 3.8 exteriors using the same 50 mm lens and light studio. Drag to orbit; fixed views support repeatable captures.',
  '轮距、轴距、隐藏机构和材料参数是独立重建。本站没有原厂 CAD 或尾翼标定。3.9 与 3.8 基线保留各自原始几何和材质代码，使用当前同一光棚与物理尾翼状态；这是外观对比，不是旧渲染流水线。玻璃透射和座舱是外部视角的简化近似；喷口、密封裙、气路与隐藏机构是实验改装假设，不是原车 CAD。':'Track, wheelbase, hidden mechanisms and optical properties are independently reconstructed. No OEM CAD or calibrated wing data is available. The 3.9 and 3.8 references preserve their original geometry/material code under the same current studio and physical wing state; this compares exteriors, not old render pipelines. Glazing and cockpit are simplified for exterior views. Nozzles, sealing skirt, plumbing and hidden mechanisms are experimental retrofit assumptions, not OEM CAD.',
};
export const patterns=[
  [/^当前 ([\d.]+) 外观$/,'Current $1 exterior'],
  [/^([\d.]+) 外观基线$/,'Original $1 exterior'],
  [/^正在按需载入 ([\d.]+) 原始外观…$/,'Loading the original $1 exterior…'],
  [/^基线：([a-f\d]+) · 使用当前渲染器 \/ 光棚 \/ 机位。$/,'Baseline: $1 · Current renderer / studio / camera.'],
  [/^导出同机位 ([\d.]+) \/ ([\d.]+) 对照 PNG$/,'Capture $1 / $2 comparison PNG'],
  [/^已采集同条件双帧；左侧 ([\d.]+)，右侧 ([\d.]+)。$/,'Captured matching frames: $1 on the left, $2 on the right.'],
];
