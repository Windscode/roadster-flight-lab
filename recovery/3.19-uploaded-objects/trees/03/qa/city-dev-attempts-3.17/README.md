# 3.17 城市开发中的失败与范围修正

原 3.16 报告、原照片及原失败夹具没有改写。这里保留本轮自身的首次失败，最终结果另见 qa/city-streets-3.17.json / city-continuity-3.17.json。

- `streets-first-check-failed.json`：新雨棚源距物理屋面仅 23 mm，落入离线 transport 的 45 mm 近表面排除带；真实灯条及等效源已一起调整为屋面下 53 mm，灯条上端仍与雨棚相接。夜 CSM 构造器以 `options.lightIntensity || 3` 丢掉 0，已在构造后明确回写实际预设；后来用冻结 3.16 复现证实旧版夜间切档也有此问题。新门面首版增加了全楼分配三角形，已将同层窗台和上沿背衬合并，保留外露面和立柱。
- `streets-first-check-harness-error.log`：测试清理误调用不存在的 environment.dispose，结果已先写到上述 JSON；测试清理改为逐 Three 资源 dispose。不是浏览器崩溃。
- `streets-second-check-failed.json`：检查把雨棚光的地面瞄准点当成必须完全脱离地面排除带的点。保留原地面瞄准点，以其上方 10 cm 的空气点验证实际入射光；没有更改推力、照明强度或遮挡算法。
- `streets-third-check-during-bake-failed.json`：测试与重烘并行读到新 bin / 旧 manifest，SHA 校验按预期阻止通过。最终三套 bake 全部完成、源及 bin SHA 一致后重新运行。该中间结果不当作应用加载通过。
- `continuity-unadmitted-lamp-translations-failed.json`：历史检查最初仍要求所有原灯杆坐标不变。现在只接纳从冻结 a0fc 提取的 66 个明确杆/臂/灯头平移记录，先逐完整 authoring 属性和整城 canonical hash 核验，再恢复这 66 个旧坐标作历史比较；没有按 kind 或前缀排除原实体。道路、桥面、114 地块与 113 路段仍严格保持。
- 最初一次基线浏览器过程在发现另一代理占用 SwiftShader 后主动终止；无成功图片交付。随后独占窗口完成两张冻结基线。它不计入性能数据。

阶段 build df6854e2 的全建筑分配为 1,420,052 triangles / 1,011 batches；冻结 3.16 实际模块为 1,494,234 / 884。该阶段三角形减少约 5.0%，分配批次数增加约 14.4%。较宽的 render-budget 门槛通过，却没有覆盖更严格的历史 exterior 逐视点合同；随后整轮回归在该合同真实失败，不能把前一通过扩大解释。

## 首轮整轮回归发现的真实预算退化

`exterior-budget-before-merge.json` 保留实际 Three 视锥与原 balanced/high/ultra/balanced 顺序的批次清单。Botanical high 为 54 beauty draws，超过未改动的历史上限 47；其他 14 项未超。首次整轮回归的 attempt-1 总日志由根交付保留。

最终只改真实分批：75 栋重塑楼的两种混凝土标签经表面系统处理后材质/Shader 响应完全相同，保留实例颜色后合并；稀疏圆形通风盖由 160 m 区改 320 m 区。每个实际面、矩阵、法线、UV、纹理尺度、发光/标牌属性、LOD 距离和阴影标记不变。较大包围盒的代价仍按全部 15 项原预算检查。

`exterior-budget-after-merge.json` 显示 Botanical high 54→47，三角形 52,782→52,942，仍低于原 69,141.6 上限；全部 15 项通过。全建筑分配三角形不变，批次 1,011→918。最终相对 3.16 的批次数仍增加约 3.85%，不掩盖这个代价。

修复前真实构造器及逐字节来源验证保存在 `../fixtures/urban-architecture-before-batch-3.17.*`；`../city-batch-equivalence-3.17.json` 对实际 173,926 个实例逐项验证等同，旧 39 楼的更早严格玻璃/非玻璃合同也再次通过。

`prebatch-bake-identities.json` 保留合批前场与源身份。合批后真正重跑三套烘焙，而非仅更新元数据；`../city-batch-bake-binding-3.17.json` 证明最终源和 8 个 bin 的 SHA 一致，物理/光源/平均反照率不变使场的二进制逐字节相同。df 阶段原图/性能不回填新身份；最终只补一张湿夜原图。

## 实际浏览器性能未达流畅

基线与候选的 high / ultra 30 秒窗口均完成，但每档只有 4–8 帧，且切档后首个 rAF 长达十余秒。基线阶段有整轮 CPU 验证并发，候选启动前验证因上述预算失败停止；两者不是严格同负载的优化 A/B。原始汇总与所有长帧见 `../city-native-3.17/performance-baseline/` 和 `performance-candidate/`。两份报告均保留本地缺少 `deployment.json` 的 404；没有删除错误后写成全绿。SwiftShader 不能代表用户 GPU。

## 第二次整轮回归：历史核心筛选依赖已合并的批次标签

`continuity-core-label-after-batch-failed.json` 保留本次 `arcology-west missing real floor cores: 0 !== 32` 失败。原 `../full-regression-3.17/attempt-2.log` 原位保留，文件 SHA 和失败对象见 `continuity-core-label-attempt2-provenance.json`。

原因是历史连续性检查用 `/ darkConcrete /` 批次名字识别核心；等价合批已把普通楼的该响应并入 `concrete`，实际核心仍在。仅修改测试的识别方法：实际闭合 12 三角盒、明确的不透明矿物材质响应与 mass LOD。原每楼 `floorCount+1`、每层 x/z 尺寸、物理 tier 的上下边界、mass 和 visible 断言全部保留，新增逐层高度/中心 0.2 mm 检查。产品源码、预算、烘焙和 build 26692 均未改。

重新通过 city-continuity 9 组、city-quality 6 组、sampler-budget 3 组。对 tests/qa 源码的全量相关标签搜索只找到这一处失效的 darkConcrete 批次选择器；其他 canonical aged mineral 材质入口仍存在，相关门禁已重跑。冻结构造器 fixture 保持原文。实际核心计数、材料响应识别与源不变证明见 `../city-core-selector-review-3.17.json`。

## 第三次整轮回归：历史间接光检查仍读取单一墙色字段

`../full-regression-3.17/attempt-3.log` 保留 `manifest.materialModel.wallTintSRGB` 为 undefined 的原失败；`indirect-material-schema-before-test.mjs.txt` 保留修前测试的完整原文，日志/测试/产品/场文件 SHA 见 `indirect-material-schema-attempt3-provenance.json`。当前真实 baker 已分别记录 retained 与 downtown 两套墙色、道路 tint 和线性平均反照率，旧测试仍读取被替代的单一字段。

仅更新 `tests/indirect-lighting.test.mjs`：严格核对完整当前材料结构、两套实际 palette、真实生成 concrete shader 与表面目录的 0.76 漫反射比例、实际 road tint，以及全部 12 个烘焙源的当前字节 SHA。原模型 SHA、所有存储探针、几何身份、4 点 768/1536 光线收敛的 25% 原阈值和曝光边界检查全部保留。

该 gate 已实际退出 0，7 组通过；其 `bake-indirect.mjs --audit` 路径没有旧字段依赖，并在写运行时光场的循环前退出，只更新本轮 QA 收敛报告。没有修改产品、baker、manifest 或 bin。17 个受保护文件（含 attempt-3 日志、最终 model-build、12 源、manifest 和两个场）的修前/修后哈希一致，详见 `../city-indirect-material-schema-review-3.17.json`；完整门禁输出见 `indirect-material-schema-repair-gate.log`。
