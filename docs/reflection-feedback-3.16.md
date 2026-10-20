# 3.16 湿路反射：原生 GL1282 根因与最小修复

## 结论与当前验收边界

3.15 的湿路反射存在实际资源读写反馈：捕获纹理同时作为当前反射 framebuffer 的颜色附件和道路材质的活动 sampler。反射 pass 把 `roadReflectionEnabled` 设为 0，却保留 `roadReflection = target.texture`。原生 Chrome 的逐 draw 记录在这些道路 draw 上报告 `1282 / INVALID_OPERATION`，浏览器原始 stderr 明确给出纹理与 framebuffer 形成 feedback loop 的原因。

3.16 仅修改 [wet-road-reflection.js](../dist/wet-road-reflection.js)：反射 draw 期间暂时取下 sampler 引用，离开写入 target 后在 `finally` 恢复旧 texture 和旧 Enabled；随后才提交成功缓存状态。已完成 8 组新增资源状态回归、13 组原反射稳定性回归、7 组视觉走廊回归。它们使用真实生产模块与 CPU renderer 边界观察器，没有 WebGL 上下文。**最终构建的原生同条件后图及 14 帧逐 draw 验证由本轮城市验收独立执行；本文在未读到该最终证据前不声明 GPU 已通过。**

此修复没有改物理、反射距离、分辨率、质量档、刷新预算、材质采样次数或光照参数；没有清除或降低任何 GL 错误门槛。实际帧率与画面质量仍以最终原生捕获为准。

## 真实 3.15 同帧证据

完整索引与摘录见 [reflection-feedback-observed-3.15.json](../qa/reflection-feedback-observed-3.15.json)。这里的 3.15 捕获是本轮独立运行冻结原版所得，不将其冒充用户先前电脑上的同一帧。

| 项目 | 原生记录 |
| --- | --- |
| 原版 commit / tree | `9f6c8f47a2678beee3915a0320ac2bf93312e96b` / `6e3eda6c0ad9965063bbf61d91a2421089e57852` |
| 原版构建 | `0ca13961ae8e9db6061a0e6ca63f9e56ada83ead5848b1724b48a05ee778978b` |
| 条件 | Crosstown；高画质；湿夜；1280 × 720；暂停；相机位置 `[-78, 2.05, -135]` |
| 审计窗口 | `2026-10-20T17:37:16.341Z` 至 `2026-10-20T17:37:18.028Z` |
| 总提交 / 事件 | 697 draw calls / 698 draw events |
| 已带入错误 | `[1282]`，保留为 `carry-in-gl-errors` |
| 首个新错误 | reflection draw index 0；`preDrawErrors=[]`、`drawErrors=[1282]`、`diagnosticErrors=[]` |
| 其余同类新错误 | index 1、2、3、4 |
| 错误材质 | `City / scanned asphalt + local puddles` |
| 道路 programs | 294（instanced mesh）、295（mesh）；均 link / validate 成功且实际绑定程序匹配 |
| 活动 sampler | 共 12 个元素；`roadReflection` 为活动 `sampler2D`，texture unit 6 |
| 写入 FBO | 完整：`FRAMEBUFFER_COMPLETE`；512 × 288；FBO object ID 64；颜色 texture object ID 62；mip 0 |
| 首次绑定与查询 | before / bind / diagnostic errors 全为空 |
| 末尾错误队列 | 空；早先逐 draw 读取的错误仍保留，不据此将该帧改判成功 |

同一 framebuffer 内随后的混凝土 draw 没有该错误；相同道路程序后来在主画面等 pass 也有干净提交。因此完整 framebuffer、成功 link / validate、低于 sampler 数量上限，均不能排除当前 draw 的资源反馈问题。这里定位的是湿路反射中的道路绘制失败，不能据此推断整座城市曾经不存在真实 3D，也不能把所有暗部、孤立多边形或美术质量问题都归给这个错误。

原 JSON 有实际 sampler 的活动状态与 unit 号、实际 FBO 的附件 object ID，但没有序列化 unit 6 当前绑定的 `WebGLTexture` 对象 ID。本文不伪称旧诊断已经记录二者的严格对象相等。严格 JS 资源同一性由冻结源码和新增边界回归证明，实际错误类型由 Chrome stderr 独立确认，最终修复效果还必须由原生逐 draw 后验闭环。

### 原文件与原始浏览器消息

下面路径均相对本轮工作区根目录；源文件保持不变，完整内容随本轮原生证据包保留。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `city-final-316/315-crosstown-wet-night/roadster-3.15.0-crosstown-wet-night.json` | 667650 | `ead4d4ed348dd4bf1b8b6a4dd3c9a46cf8cfba075998bf54ad876c01de9bc1f4` |
| `city-final-316/315-crosstown-wet-night/roadster-3.15.0-crosstown-wet-night.png` | 934279 | `2a19c4cc9caf734f8c8183c66178cd211b3b09fa28f975a937bf7d4c94860c1f` |
| `city-final-316/315-crosstown-wet-night.zip` | 1602654 | `49ea42510fce08059d7edca693c4011aa74e7841dbc5c6452cd3c3ba255d37a1` |
| `city-final-316/reflection-feedback-original-browser-message.txt` | 34415 | `74e90070f1042d16acf888ec900fc853b35cf843199a0fa99c04fd3531214017` |

最后一个文件是从 `city-final-316/report.json` 的 JSON Pointer `/captures/12/failure/message` 逐字提取的完整 UTF-8 字符串，提取时报告 SHA-256 为 `b2d6f0db78a6a14bdfcc127eb7b0f99efb407d891ef4605c78df83eff08f77c1`。它包括浏览器关闭导致的工具异常前缀和 144 行驱动反馈报错，完整原文没有只留下最后一句。关键驱动信息为：

> GL_INVALID_OPERATION: glDrawElementsInstanced: Feedback loop formed between Framebuffer and active Texture.

另有 `glDrawElements` 的同类信息。该 stderr 来自同一个浏览器进程，包含冻结 baseline 与已作废的修复前 candidate context；它用于确定驱动错误类型，**不声称每行日志都已与某一个 baseline 帧做时间一一对应**。工具因关闭浏览器而报错不构成应用崩溃证据；真正的 GL 错误已在关闭之前发生并由上述同帧 JSON 独立记录。

## 根因与修复顺序

原版 `configure()` 设置 `uniforms.roadReflection.value = target.texture`。`attachRoadSurface()` 把这个 uniform 对象本身注入道路 shader，运行时条件内仍包含五次 `texture2D(roadReflection, ...)`。改变 Enabled 的数值不移除已链接程序中的 sampler。

[Khronos WebGL 1.0.3 规范](https://registry.khronos.org/webgl/specs/1.0.3/)的 **Feedback Loops Between Textures and the Framebuffer** 一节规定，此类同一纹理读写反馈在 WebGL 中产生 `INVALID_OPERATION`。该规则也保留于官方[当前 WebGL 1.0 草案](https://registry.khronos.org/webgl/specs/latest/1.0/)；本文以已发布的 1.0.3 条文作为引用依据。

项目所用 [Three.js](../dist/vendor/three.module.js) 的 `setValueT1` 会对 `null` sampler 选择独立的空 2D texture，并通过纹理系统实际绑定；它不把 `null` 当成跳过 uniform 上传。这正是修复依赖的既有渲染契约，没有新增每帧纹理分配。

本次顺序如下：

1. 保存调用方 target、cube face、mip、viewport、scissor、XR、阴影更新状态，以及 sampler 的旧 texture 引用与旧 Enabled。
2. 反射 pass 设置 Enabled 为 0，并将 `roadReflection.value` 暂设 `null`。道路 draw 的活动 sampler 由 Three 使用独立空纹理；活动 sampler 数量和 shader 本身保持不变。
3. 绑定反射 target，clear 并 render。道路仍参加反射 scene 的正常几何提交；没有通过隐藏道路来规避反馈。
4. 在 `finally` 恢复调用方 renderer target，**随后**恢复原 texture 与旧 Enabled，并还原可见性。
5. 成功后提交缓存时间、相机、源状态与投影矩阵，再依据原 domain 权重启用新反射。若 clear/render 抛出异常，旧 sampler 身份和调用方状态仍恢复，但缓存继续按既有规则作废：target 可能已被部分覆盖，不能重新启用原先的有效标志。

运行源 SHA-256：`69e9f1280bd8bf0d2119e156fba83ccc99c31c1b7a60e03df9670cc6c5264683`。原 3.15 同文件 SHA-256：`237baf4e5bc76ad1969f1e04a51d22777d429c0f3a89e295dff80a18f5a27061`。冻结对照见 [fixture manifest](../qa/fixtures/reflection-feedback-3.15/manifest.json)，测试核实只改了到同一 Three.js 的相对 import 路径。

## 已执行回归与最后的原生门槛

| 回归 | 结果 | 验证范围 |
| --- | --- | --- |
| [reflection-feedback-3.16](../tests/reflection-feedback-3.16.test.mjs) | 8 组通过 | 冻结原版同对象反馈复现；共享 uniform；high/ultra 多 pass；缓存复用；clear/render 异常；禁用/重建/释放；准确恢复先前 sampler |
| [reflection-stability-3.12](../tests/reflection-stability-3.12.test.mjs) | 13 组通过 | 原相机和动态源失效策略、12/20 Hz 上限、投影、空间渐隐、异常状态恢复 |
| [visual-corridor-3.9](../tests/visual-corridor-3.9.test.mjs) | 7 组通过 | 有限反射镜头、72 组裁剪姿态、远距剔除、原城市走廊与 renderer 恢复契约 |

机器报告分别为 [reflection-feedback-3.16.json](../qa/reflection-feedback-3.16.json)、[reflection-stability-3.16.json](../qa/reflection-stability-3.16.json)、[visual-corridor-3.16.json](../qa/visual-corridor-3.16.json)。这些组数是测试分组数，不能当作像素或 GPU draw 验收数量。

现有 `render-program-diagnostics.js` 已能把 carry-in、pre-draw、target bind、draw 与 diagnostic 错误分开保留。精确补上 sampler 对象 ID 还需扩展 framebuffer inspector 的对象身份表和逐 draw 纹理单元查询；当前已有明确驱动原因，因此本次不扩运行诊断，不增加常规 draw 的查询开销。

最终原生复测必须使用重新生成的完整构建身份，至少包含一次同条件 Crosstown 湿夜的**实际反射刷新 pass**，并保留完整 14 帧逐 draw 报告。只记录复用缓存的干净主画面帧不足以证明这次修复。任何新 GL 错误继续判失败；CPU shader/状态测试和零 console 文本均不能替代这项证据。
