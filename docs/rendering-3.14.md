# 3.14：极高离屏目标、逐次 draw 证据与矩阵导出

本轮延续 3.13 的编译期昼夜组合、无损夜场 atlas 和具名主相机诊断。没有降低默认画质、删除主体、关闭全部反射或改变曝光来换取通过。这里将 **用户提供的 3.13 实机结果、当前代码/接口夹具、尚缺的 3.14 目标 GPU 后验**分别列出。

## 已核对的实机基线

已物化并实际查看原始 PNG；完整提取条件、具名程序、错误列表及原 ZIP 的 SHA-256 见 [继承证据](../qa/visual-evidence-3.14.json)。

| 原条件 | 有效证据 | 不能扩大到的结论 |
| --- | --- | --- |
| 3.13，1280×720，湿夜，曝光 1.02，高→流畅→高 | 观察到的道路/楼面恢复；具名道路 13、矿物墙 12 个 active sampler 元素；LINK / VALIDATE 成功且颜色 draw 非零，指定帧错误列表为空 | `requiredCategories=[]`，不是全场景、全路线、所有画质或最终美术通过 |
| 同条件极高 08 | 25 个程序有 draw GL1286；道路 14 / 矿物 13 个 sampler，未超 16；链接/校验成功，shaderErrors 空 | 链接成功不能证明 draw 成功；原诊断没有 framebuffer completeness，也没有错误与目标逐次对应 |
| 两次城市 14 帧按钮 | 未取得下载包；一次任务超时/会话重置，另一次下载等待超时 | 未证明两次失败只有一个原因，也不能把等待超时本身说成 GPU 根因 |

原程序的聚合目标列表含 `offscreen:256xundefined` 和 `EffectComposer.rt2:1280x720`。这两项是定位线索，不足以把每个 GL1286 归给同一个目标。另有旧报告标为 passed 却含 priorGlErrors；新版明确保留并判失败。

该包中的 WebGL 自报 Windows / ANGLE / NVIDIA GeForce RTX 4080 SUPER / D3D11。这是所提供诊断的设备信息，不是本执行环境或独立拆机核实。当前云端浏览器重新打开仍为 `GL_VENDOR=Disabled / GL_RENDERER=Disabled`；两种环境不能合并成同一次验证。

## 可复现的代码根因与修正

### CubeRenderTarget 尺寸生命周期

在仓库捆绑的真实 Three.js 中，`WebGLCubeRenderTarget` 继承 `RenderTarget.setSize(width, height, depth)`。旧路径调用 `cubeTarget.setSize(profile.probeSize)`，漏传 height。CPU 对象可精确复现：width 变为 256，height 与 viewport.w 变为 `undefined`；六个 image 描述还停留在旧边长。

Three 的颜色分配用 `max(1, height >> level)`，因此缺失 height 进入 1 像素高度；深度 renderbuffer 分配直接传缺失高度，经 WebIDL 转换是 0。这不是期望的 256×256 方形目标。它是已证实的目标构造错误，**尚不能凭 CPU 复现声称旧包所有 GL1286 的唯一成因已在目标驱动上验证**。

新 [cube-probe-target.js](../dist/cube-probe-target.js) 在边长实际改变时重建正确的 cube target 与 camera，处置旧资源；同尺寸天气切换复用目标。原 HalfFloat、mipmap、深度、反射预算和物理状态保留。128 / 256 / 关闭 / 反复切换的六面尺寸、缓存与处置均有真实 Three 对象检查。

### 真正绑定到 framebuffer 的绘制诊断

[framebuffer-diagnostics.js](../dist/framebuffer-diagnostics.js) 与 [render-program-diagnostics.js](../dist/render-program-diagnostics.js) 现在记录：

- **实际已绑定** framebuffer 的 `checkFramebufferStatus`，不拿 `renderer.getRenderTarget()` 的名字当完整性结果。
- target 的类型、尺寸、face、mip、samples；实际颜色/深度/模板附件的对象身份、level、cube face。renderbuffer 的宽、高、格式和 samples 从驱动读取，查询前后的 renderbuffer 绑定恢复。
- 目标的 texture image 尺寸明确是 **CPU allocation descriptor**，没有冒充 WebGL 不提供的纹理实际尺寸查询。
- pass、相机、材质、对象、program、FBO 记录 ID 与 attempted draw 的关联。切目标之前、绑定后、draw 前、draw 后及诊断查询错误分别保留；早先积累的错误不再被静默吞掉。
- 主相机实际 Standard / Physical 颜色 draw 才满足道路、建筑、车身类别。阴影/法线/probe 通过不能替代主颜色绘制。
- 无 program 的 attempted draw 也保存错误和关联信息，避免“没有程序且 draw 计数没增加”把 GL 错误排除出报告。没有错误的零 draw 只记录，不凭空认定失败。

这些同步查询只发生在用户明确请求的诊断帧。诊断帧、矩阵期间以及紧邻诊断造成的下一帧不进入路线性能统计。它们有单独证据身份，不能用来计算正常驾驶 FPS。

## 14 帧矩阵的可靠收尾

[render-capture-matrix.js](../dist/render-capture-matrix.js) 保留 7 组画质/天气切换，每组交换厅与车体两个主机位：高晴天、高湿夜、极高湿夜、极高晴天、流畅湿夜、再次高湿夜、再次极高湿夜。物理、操纵、相机交互和场景更改在采集中冻结；结束后恢复原状态。

一次 collection 完成和实际 draw 通过是两个字段：`executionStatus` 与 `drawStatus`。完整包应为 **14 个原始 PNG + 14 个同帧 JSON + 总 manifest + README，共 30 个文件**。具名 draw 失败可以采完 14 帧，但不会显示 draw passed。

每帧从实际绘制到 PNG 编码有 20 秒期限；`inFlight` 阻止编码期间再次采同一任务。ESC / 取消保留已完成前缀和精确下一帧；0 帧 readiness 超时也生成可读 failed 包，包含原始原因。晚到的 PNG 回调不会补造帧或二次下载。ZIP 编码失败保留 JSON 与本会话结果，并提供“重新下载最近采集包”；不会显示成功或丢弃现场记录。

原 3.13 两次失败是否都源于旧 cube target，仍待新逐次诊断。没有把“这次导出事务更可靠”写成旧超时原因已经证明。

## 当前已测试的层级

| 层级 | 实际检查 | 边界 |
| --- | --- | --- |
| 真正 Three CPU 对象 | 旧单参数 resize 复现；新目标六面、cache/dispose | 无 GPU attachment 创建 |
| GL-interface 定向夹具 | linked/validated 且 sampler 合法但 draw1286 仍失败；FBO attachment、carry-in/pre/bind/draw 错误、无 program 分支 | 不能替代具体驱动 |
| 实际应用 DOM + 真实物理 | 两轮 14 帧调度；冻结恢复；0/14 failed 包；ESC 前缀；慢 PNG；晚回调；持续原因及英文 | 渲染 facade 不绘图，报告保留 draw-failed |
| ZIP 消费端 | STORE/CRC、14 个合成 PNG 及 30 项文件可用 Python ZipFile/Pillow 打开 | 合成 PNG 不是 3.14 三维后图 |
| 离线 GLSL | 最终 feature 组合和 active sampler 反射；当前上限 14；旧版超预算仍可复现 | stock `average` 兼容改名仍公开；这是离线兼容检查，不是原样目标驱动链接 |
| 目标 GPU / 动态像素 / 路线帧时 | **未完成** | 云端 WebGL Disabled；本轮没有真实 3.14 三维后图或性能通过 |

报告：[framebuffer/matrix](../qa/framebuffer-matrix-3.14.json)、[主页面 DOM](../qa/same-page-ui-3.14.json)、[城市离线 shader](../qa/city-shaders-3.14.json)、[后处理离线 shader](../qa/render-shader-validation-3.14.json)。数量不等于图像质量。

## 目标浏览器的最少补采

1. 打开最终部署，确认 `deployment.json` 与页面同为 3.14；固定 **1280×720、DPR 1、湿夜、曝光 1.02、交换厅机位**，高→流畅→高各一次普通观察与“真实绘制诊断 + PNG”。已恢复的高档不能回退。保持实际设备和驱动信息随包导出。
2. 选极高，先运行单帧诊断，再运行 **14 帧城市切换检查**。包应可打开，14 PNG 与 JSON 一一对应；每次实际颜色 draw 无 GL1286，FBO 完整、尺寸有限、主体完整、无 shader/前置错误。先取消一次确认 cancelled 前缀，再重试完成。正常与暂停/导出像素分别看。
3. 车辆检视做 24 帧六机位对照；实验室和一个实际挑战另采主颜色 draw。随后进行跨区实际驾驶与低空路线，预热后再采 p50/p95/p99/长帧；不要把矩阵耗时、暂停/HUD 数字或单点截图当性能。

若仍有错误，直接保留新包中失败事件对应的 pass/FBO/attachments/conditions。不要降低画质或删楼后把另一个条件写成原条件通过。
