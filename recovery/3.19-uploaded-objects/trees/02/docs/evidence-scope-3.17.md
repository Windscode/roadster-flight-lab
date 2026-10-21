# 3.17 证据归属与历史保留审计

版本阅读说明：以下原审计保留 01:23 UTC 的 `df685…` 阶段结论。整轮候选随后收敛为 `26692…`；最后一节追加最终身份及新证据，不把早期原图、性能或失败记录改写成新 build。

只读审计时间：2026-10-21 01:23 UTC。未重跑、补拍、改写旧证据或修改产品源码。

01:23 UTC 原审计当时的候选 build 为 `df6854e239f29782d8ab53048603b6ba249da3e0eb967020512a92558765a19f`。其 `dist/model-build.js` 文件字节 SHA256 为 `8abb21fb399ac175a1003bb2935fac82157dc71e5b873b702ed5516c8b4a4b73`；清单中的 **178 项实际源文件均已重新计算 SHA256，全部匹配**。以下原快照中的“最终”保留其当时含义，直到“最终候选追加审计”小节才切换为 `26692…`，均不表示已发布。

## 归属表

| 证据 | 实际身份与覆盖 | 可作结论及限制 |
| --- | --- | --- |
| `qa/city-native-3.17/candidate/` 三张原图 | HTTP 收到的 `model-build.js` 原始字节哈希与最终候选完全相同，见 `build-binding.json` | 属于最终 build 的真实渲染；普通跟随图 `drive-clear-day.png` 是暂停状态，只证明正常跟随视角外观。 |
| `qa/input-native-3.17/first/` | 实际原生键序列运行于 `4bc12c8cd0a0b1391b196dc28e37bed30de04bad7aea4427c88b72a935293522`；冻结清单与最终的 178 项中 175 项相同 | 可归属于最终相同的物理、驾驶输入、受控动作源码；不是最终 build 全应用原生重测。 |
| `qa/research-native-3.17/second/` | 实际运行于 `7c77e408d50f145dcf4182a71f7c96755778701063054810631e3e002a5f7d8e`；原报告只保留 build ID 和 178 项计数，未发现该 build 的完整冻结源清单 | 实际 Worker、保存、下载、重载、选择 B 后三维重执行及观察取消在当时版本通过。不能据此声称后续修复后的全部研究 UI 原生通过。 |
| `qa/wind-workspace-3.17.json` | 报告仍标 `4bc…`（重生成 build 清单前），但记录的 UI、研究统计、任务求解与 Worker 四项实际源码 SHA256 均与最终相同 | 最终相关源码的隔离 DOM、故意失败 Worker fixture、实际求解器部分记录测试；不是原生 Worker/浏览器像素证明。 |
| `qa/wind-response-3.17/report.json` | 最终 `df685…`，六项实际固定步长求解器检查通过 | 属于最终数值回归，不能替代研究 UI 的原生操作或用户显卡性能证据。 |
| `qa/vehicle-form-3.17/candidate/` 与 `candidate-lab/` | 草稿阶段真实采图；工坊原始 JSON 仍保留旧 `28e9…` build，采图时文件哈希单独留在 `capture.json` | `vehicle.js`、工坊 HTML/JS、阴影模块、`main.js`、`wind-laboratory.js`、`vehicle-models.js` 均与最终字节相同，因此可用于对应形体/阴影修复的局部源码证据。不能把旧身份回填成最终 build；实验室前后姿态存在 26.934 mm 位移，只作定性条带对照。 |

## 原生输入证据可覆盖什么

两个冻结清单位于 `qa/build-identities-3.17/`。`4bc…` 到最终仅有以下三项变化，均属于研究工作区：

| 文件 | `4bc…` 源 SHA256 前缀 | 最终源 SHA256 前缀 |
| --- | --- | --- |
| `landing-research-ui.js` | `672601e4099061bf` | `f7b77571e13ee50c` |
| `research-console.css` | `2c41746096d0ed92` | `a8aa189a7ce330de6` |
| `wind-control-study.js` | `c65a87fb9c3b17d5` | `54f2963341cd3c62` |

`main.js`、`input-session.js`、`controls.js`、`pilot-input-intent.js`、`operation-hud.js`、`pitch-maneuver.js`、`physics.js`、接触/轮胎/车辆参数及依赖求解器均未变。实际记录是 Chromium Playwright 键盘事件先保持 W，再追加 U 或 E+1，并读取应用固定步长输入与四元数日志；不是仅断言键码。

W→U 记录为 `completed-and-driving`：动作耗时 4.675 s，CG 峰值 6.133 m，完成后四轮接触并恢复 DRIVE，W 仍保持。此工况使用 350 bar 恒压外供，记录外供耗气 191.319 kg，不能称有限储气成功。W→E+1 连续请求 6.5 s 的记录为 `manual-outcome-recorded`，后续仍为 HOVER，不能称手动 E+1 已解决或以 U 的结果替代它。原生脚本只读运行时 build ID；归属依赖留存的冻结源清单比较，没有每个输入模块的 HTTP 响应字节证明。

## 研究后修范围

原生 `second` 之后修复的两项没有补做原生浏览器覆盖：

1. 不足 480 个样本的 2–6 s 指标不再冒充完整窗口；完整窗口指标显示空值/“—”，另列真实区间与样本数，保留部分窗口原始统计。
2. 风场 A/B job 冻结实际模式、种子、风场日程、修改后的任务、来源身份和 A/B 图；错误/取消 attempt 保留可复现请求。

`tests/wind-workspace-3.17.test.mjs` 与对应 JSON 已覆盖实际求解器在 3 s 取消、仅有 120 个窗口样本，以及故意 Worker 错误后的请求留存。最终布局 CSS 与这些 UI 修复的原生像素/交互范围仍未测。原生导出成功仅证明本次 2,623,216 字节文件落盘，不能解释或否定用户此前 1,758 s / 2,561 s 的工具调用挂起，也不能宣传所有导出提速。

## 历史 QA 未被回归覆盖

以基线提交 `a0fce89e55efe6eaa54210987ef07cf9dfd7171e` 的 Git tree 为准，对 **1,164 个已跟踪 `qa/` blob** 逐个计算工作区 Git blob SHA1：1,162 项字节不变，没有缺失；只有两项明确的测试辅助源码增量：

- `qa/city-geometry-scope.mjs`：核验并精确反转 116 个新增街边碰撞包络、66 个移动灯杆记录后比较历史城市；保留原历史身份检查。
- `qa/render-budget-check.mjs`：夜间 CSM 数量采用本轮明确的单级配置，白天仍校验档位配置。

847 份历史 JSON、152 张 PNG/JPG、旧压缩日志、失败证据和 fixtures 均无字节变化。此结论是上述审计时点的快照；本轮未执行恢复操作。

所有本轮原生图形证据来自 Chrome 156 / SwiftShader 软件渲染，不代表用户 GPU 验收，也不代表持续帧时、逐 draw 或全部切档响应通过。源码相同、数值通过、原生工作流通过、像素观察与用户设备体验应分别陈述。

## 最终候选追加审计：`26692…`

最终全产品 build 为 `26692f4324d2392ae7ac5981709299e2f6da29929259221445a7ba49591781d4`，冻结清单位于 `qa/build-identities-3.17/`。01:31 UTC 已再次核对 **178/178 实际源文件 SHA256 全部匹配**；最终 `model-build.js` 原始字节 SHA256 为 `aa42c10155b6cd409981c52d23beff9baca2f571c9207993174784bfb3484fd7`。

### 后续源码边界

`df685…` → `26692…` 仅以下三项变化，175/178 项相同：

| 文件 | 最终 SHA256 前缀 | 已核查的变化 |
| --- | --- | --- |
| `urban-architecture.js` | `a4819cc5230ed7af` | 相同材料响应的实例合批。`qa/city-batch-equivalence-3.17.json` 比较 173,926 个实例：原型几何、法线/UV、变换、颜色与材质响应、LOD、阴影标志一致；分配三角形保持 1,420,052，批次从 1,011 降至 918。 |
| `landing-research-ui.js` | `343e260dc43e4a5f` | 只插入 `mount.dataset.busy=String(busy);`。只读移除此一处后，文件 SHA256 精确恢复为 `df685…` 的 UI 哈希。 |
| `research-console.css` | `d0be108ffca3dbb8` | 只追加 178 字节，使空闲/完成状态条 `position:static`，避免滚动时遮住标题与种子；去掉追加内容后哈希精确恢复为 `df685…`。 |

城市合批的全场景实例等价不等于任意相机的剔除或 GPU 时间等价。`qa/exterior-materials-3.17.json` 已在最终城市源码上通过未放宽的历史 15 视图合同；`qa/city-dev-attempts-3.17/exterior-budget-after-merge.json` 的 3 档 × 5 视图均在原预算内。合批前预算失败和原构建器仍分别保留在 `qa/city-dev-attempts-3.17/`、`qa/fixtures/urban-architecture-before-batch-3.17.mjs`。

`4bc…` → `26692…` 共四项变化（原三项加 `urban-architecture.js`），174/178 项相同。**物理、驾驶输入、U 动作、接触和车辆参数仍全部未变**，原生 W→U 与 W→E+1 的局部源码归属继续成立。研究任务求解器、控制图执行和 Worker dispatch 从 `4bc…` 起也未改变；`wind-control-study.js` 的部分窗口统计修复发生于 `4bc…` → `df685…`，它从 `df685…` → 最终未变，不能笼统声称四个阶段所有研究文件都相同。

### 新原生证据及仍未覆盖的范围

| 证据 | 实际结果 | 最终归属 |
| --- | --- | --- |
| `qa/research-native-3.17/final-ui/` | 01:26:29 完成，`passed`。实际 `df685…` 原生 Worker 创建基线、运行 strong / seed 31701 的 A/B 并保存三条记录；原报告保留完整 178 项源哈希，与冻结清单逐项相同。 | 覆盖修复后的正常完整窗口 Worker/保存工作流。后续只有 UI busy 属性及 CSS 防遮挡变化；这次没有重做下载、live 重执行或取消。 |
| `qa/research-native-3.17/layout-verified/` | 01:30:59 完成，`passed`。实际最终 `26692…`，178 项源清单与最终冻结清单相同；浏览器实际收到的 manifest、UI、CSS、风扰统计四份响应字节哈希吻合。通过原生文件输入导入上述三条 `df685…` Worker 归档，原文保留；完成状态 `busy=false`、状态条为 `static`，标题和种子可见，原始 PNG 已实看。 | 最终 build 的真实归档导入与布局证据。**没有重新运行 Worker、下载或测 GPU 性能**；归档里的 `df685…` 来源身份不改。 |
| `qa/city-native-3.17/final-after-batch/` | 单张 Crosstown 湿夜原始 PNG 已实际完成并实看；1280×720、DPR 1、high、exposure 1.02、暂停固定视角。142 份实际 HTTP 源文件/manifest 响应 SHA256 已逐项与最终字节比较，全部匹配，含最终 `urban-architecture.js` 与 manifest。 | 最终 `26692…` 合批后的真实渲染证明。只存在 `/deployment.json` 的 404 及相应控制台信息，无 page/shader 错误；单张静态画面不代表持续帧时或切档性能。 |

完整窗口的正常 Worker 流程不能覆盖故意失败 Worker 或 3 s 取消后的部分窗口边界。上述两项边缘修复继续由实际求解器记录和隔离 DOM 检查支撑，未补做原生异常流程。`wind-workspace` 当时的 UI 源哈希现在比最终少单条 busy 属性；其统计、任务求解、Worker 源码仍与最终相同，不能再描述为整份 UI 字节相同。

城市 `candidate/` 原三张图和 `performance-candidate/` 性能数据仍归属于 **合批前 `df685…`**，原记录不变；不得把这些时序性能数值直接归到最终 build。最终合批后只新增上述单张湿夜原生证据，不能据此补齐最终全档位/全时序性能。该 PNG SHA256 为 `7f21c856b35c2ac12c797e737627c02a8519682e845afe7c5898b7dd3ff5d6dc`。

01:35 UTC 再次按原基线 Git blob 核对旧 `qa/`：仍为 **1,164 项中 1,162 项字节不变，只有上述两项明确的城市测试辅助源码改变，无缺失、无旧数据覆盖**。此追加审计未改产品、测试或证据原文，也未执行提交；最终提交身份须由后续交付清单给出。

最终原生汇总 `qa/native-acceptance-3.17.json` 的状态为 **`partial-native-acceptance-with-open-gates`**，并非全体验通过。八项保留范围分别是：手动地面 W/E/1 失败、严重台阶完整轨迹不收敛、有限气源 U 起飞前拒绝、软件渲染流畅度失败、用户 GPU 未测、最终合批后持续时序未重复、长期导出工具挂起未归因、全量 3A 美术未宣称。汇总仍将源等同的早期观察与最终全 build 原生观察分开。


## 最终标准整轮后的证据快照

第四次 `scripts/validate.mjs` 已完整退出0；DOM与离线GLSL均启用，最终运行源仍为178项、build `26692…`。完整回执、三次保留失败及预检日志位于 `qa/full-regression-3.17/`。本页早期时点提到的3.17数值/DOM报告已由标准回归正常更新为最终源码结果；之前的阶段报告快照位于该目录 `tail-precheck/` 的 `before-reports/` 等路径，原生采集报告与原图没有换身份。最终再次核对旧QA：1164个blob中1162个不变，仅两个已说明helper改变，无缺失。参见 `qa/history-preservation-3.17.json`。

本次原生按键发生在 `?view=lab` 实验室平地。原生手动仅测G开；G开/关皆失败的两组属于数值专项。U的4.675秒和X的3.6917秒是模拟时长，不能当作SwiftShader墙钟或完整城市后翻原生验收。
