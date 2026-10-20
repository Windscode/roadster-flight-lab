# 3.13：湿夜主体缺绘与材质 sampler 预算

本轮将城市照明按实际天气编译，并把夜间城市／路线光场无损打包为 3D atlas。保留原来的照明数值、材质纹理、反射、阴影与完整城市。在当前离线着色器矩阵中，高画质湿夜矿物立面由 **17 → 12** 个片元 sampler，道路由 **18 → 13**；极高分别由 **18 → 13**、**19 → 14**。这解决的是明确的链接资源超限路径。目标设备真实链接、绘制、画面和驾驶性能仍须通过网页内的独立采证门禁；离线通过不等于这些验收已经完成。

## 1. 已有证据与根因

用户的 3.12 诊断包记录了同机位、1280×720、湿夜、曝光 1.02 的高→流畅→高切换。真实浏览器 console 明确包含 `MeshStandardMaterial`、`VALIDATE_STATUS false` 与 `FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)`，其中失败材质具名为 `Urban / aged mineral plaster`。因此不能将楼体消失仅解释为夜景太暗。

旧道路也有缺绘现象，但该包的其余错误没有可靠具名到道路程序。这里保留证据边界：**矿物立面已有用户设备上的具名链接错误；道路的 18／19 单元超限由冻结 3.12 源码的最终 emitted shader 独立复现，仍需目标设备的新诊断包具名核实。** 本说明没有把读取 console 或源码当成读取图片像素。

3.12 `city-environment.js` 的 `bindMaterial` 对日／夜都依次注入白天 SH 间接光、夜间 bounce、局部太阳深度和静态夜间 direct field。关闭 `giReady`、`probeSunActive` 等 uniform 只改变运行时条件，没有删除链接时仍活跃的 sampler。高画质的公共片元预算是：

| 旧静态湿夜功能 | 活跃 sampler 元素 |
| --- | ---: |
| 白天 SH 城市＋街道场 | 2 |
| 接触 AO | 1 |
| 夜 bounce 城市＋路线场 | 2 |
| 夜 direct 城市＋路线场 | 2 |
| 局部太阳深度 | 1 |
| 聚光阴影数组（3 个近灯＋2 个车灯） | 5 |
| 环境图 | 1 |
| 公共合计 | **14** |
| 矿物 albedo／normal／roughness | **+3 → 17** |
| 道路 albedo／normal／roughness／局部积水反射 | **+4 → 18** |

极高的聚光阴影数组长度为 6，故各再增加 1。流畅把白天 SH 放到 vertex stage，且只有 3 个聚光阴影元素，旧矿物／道路的 fragment 数分别为 13／14；另外仍有 2 个 vertex SH sampler。这与用户“切流畅恢复”的观察一致，但不是对用户设备的替代测量。

## 2. 修改位置与不变的光照语义

### 编译期组合

`dist/city-material-lighting.js` 是运行时与离线检查共用的编译选择器：

| 实际模式 | SH 白天场 | 夜 bounce atlas | 静态夜 direct atlas | 接触 AO | 局部 probe 太阳深度 |
| --- | --- | --- | --- | --- | --- |
| 晴天高／极高 | 保留 | 不编译 | 不编译 | 保留 | 保留 |
| 湿夜高／极高静态城市 | 不编译 | 保留 | 保留 | 保留 | 不编译 |
| 湿夜高／极高车辆 | 不编译 | 保留 | 不编译 | 保留 | 不编译 |
| 流畅 | 保留对应天气的原光照 | 按天气 | 按静态／动态分类 | 与原预设一样关闭 | 与原预设一样关闭 |

`dist/indirect-lighting.js` 将屏幕空间 AO 绑定从 SH 光场中拆出。夜间仍有接触 AO，不再为取得它而携带两张已停用的白天场。原有 AO 强度、夜间环境填充、实际近灯与车灯数量、静态 direct 的近远互补、动态车辆受光和反射均保留。

### 夜场无损 atlas

`dist/night-field-atlas.js` 在 X 方向拼接城市与路线 RGBA16F 体积。`dist/night-city-lighting.js` 与 `dist/night-direct-lighting.js` 各保留一张 atlas sampler，代替原来的两张 sampler。输入文件格式、半精度系数、光场空间分辨率、五层高度、六个方向与 alpha 有效性权重均不改变。源 `nightCityField`／`nightRouteField` 句柄只留给数值诊断，不进入 shader uniform 注入；不能把这两个句柄的存在误计成两个 GPU sampler。

每个子体积先将归一化 UV 限定到自身首末 texel 中心，再映射到 atlas 尺寸。这样原先 `CLAMP_TO_EDGE` 的双／三线性插值保持原义，城市边缘不会读到路线，较矮子体积不会读到补齐行。Z 的方向／高度排列不变，仍使用显式 `textureLod(..., 0.)`。

没有把 AO 塞进夜场 alpha：AO 使用屏幕坐标，而夜场 alpha 是世界空间插值的有效性权重。二者复用会破坏已有功能，当前预算也不需要这样做。

### 缓存与切换

`city-environment.js` 的 `bindMaterial` 把 `quality`、天气、静态／动态与 AO 编译分支纳入 cache key，并公开在 `material.userData.cityLightingVariant`。异步到达的静态材质会重新分类绑定。日夜转换和画质转换都会释放相应材质的旧程序表，再恢复原 surface injector 与 CSM 绑定；材质纹理不被销毁。这避免 CSM 重置其 shader 记录后，Three 回用某个旧 program 而跳过 `onBeforeCompile` 的状态错配。

光场加载完成时使用当时的画质选择，同一 uniform 对象更新到对应 atlas。每种场最多缓存 coarse／fine 两张；高与极高共享 fine，逐帧不会重新打包。世界天气切换仍是明确的预设切换，不伪造两种光场同时保留的平滑过渡。

原 3.11 receiver-plane PCF 修正仍最后注入，没有回退到已被用户隔离证实有密纹的旧阴影路径。道路、基础城市及 corridor 材质补了具名诊断，未改变其反射率。

## 3. 内存与硬件尺寸代价

运行时读取实际 `MAX_3D_TEXTURE_SIZE`，创建 atlas 前检查全部维度。当前 fine 最大边为 162，coarse 为 108；超过设备限值会显式报告 field 错误，不以静默缩减纹理精度换取加载成功。CPU fixture 的 256 默认值仅供没有真实 GL 的数值检查，真实浏览器使用查询值。

下表为 **每种场**（bounce 或 stationary direct）RGBA16F 逻辑 texel 字节数；不是驱动实际显存占用测量。

| 画质 | Atlas 尺寸 | 原两体积有效数据 | Atlas 数据 | 补齐代价 |
| --- | --- | ---: | ---: | ---: |
| 流畅 | 108×53×30 | 1,215,360 B | 1,373,760 B | 158,400 B |
| 高／极高 | 162×81×30 | 2,793,120 B | 3,149,280 B | 356,160 B |

每种场访问过两档后的 atlas cache 为 4,523,040 B，两种场合计 9,046,080 B（约 8.63 MiB）。这既是新增 CPU atlas 缓冲的上界，也是两档均上传后 atlas 的逻辑纹理存储量；原始 CPU 源体积仍保留，每种场为 3,334,320 B。两种场的源数据＋atlas CPU 数组总量上界约 14.99 MiB，不包括对象、驱动与资源管理开销。

与两档均访问过的旧 GPU 原始 city／fine route／coarse route 存储相比，两个 field 合计增加 2,377,440 B，约 2.27 MiB；只比较当前 high/fine 的有效纹理存储，两个 field 的补齐增加 712,320 B，约 0.68 MiB。采样次数与照明分辨率不增加，代价来自补齐和缓存中重复保存的城市区域。

## 4. 前后相同源条件的离线结果

`scripts/validate-city-shaders.mjs --compareBaseline` 从公开提交 `70e98013d6da246c78c4c50ca2ef44595d1f356b` 读取原模块，而非在新代码中手写一个“旧预算”。它使用仓库 vendored Three 的真正 `WebGLProgram` 源码生成器展开 include、灯数组和循环，再由 glslang 链接并反射活跃 sampler 数组；数组按 `size` 累加。

| 湿夜具名材质 / 预设 | 冻结 3.12 fragment | 3.13 fragment | 对目标 16 的余量 |
| --- | ---: | ---: | ---: |
| 矿物立面 / 流畅 | 13 | 9 | 7 |
| 扫描柏油＋局部积水 / 流畅 | 14 | 10 | 6 |
| 矿物立面 / 高 | 17 | 12 | 4 |
| 扫描柏油＋局部积水 / 高 | 18 | 13 | 3 |
| 矿物立面 / 极高 | 18 | 13 | 3 |
| 扫描柏油＋局部积水 / 极高 | 19 | 14 | 2 |

当前晴天道路的高／极高为 11／12；带 clearcoat 与三张基础纹理的动态 Physical 测试材质，湿夜高／极高为 11／12。实例和普通 mesh 均覆盖。98 个组合中包含 92 个当前组合和 6 个冻结基线组合，当前最大 fragment 为 14，当前所有 stage 预算通过；4 个旧 high/ultra overflow 按预期被复现。完整 sampler 名字、类型、array size、stage AST、源 hash 和旧源码 hash 在 [city-shaders-3.13.json](../qa/city-shaders-3.13.json)。这仍不是 `gl.getActiveUniform` 的驱动结果。

本环境 glslang 对 stock Three 的 `average` 函数名报保留名冲突。报告保留原始错误，并且只在临时编译输入中将该标识符改名后检查其余真实 shader；98 个结果准确标为 `compatibility-pass`，没有改写生产 vendor，也没有把它称为真实设备 exact-pass。部分 glslang 联合 AST 会把 vertex-only sampler 标记为两个 stage，因此另对每个 stage 独立反射核对，原联合掩码仍保留。

## 5. 数值门禁、真实绘制门禁与未验收项

以下已在本轮重烘焙后的场数据运行：

```bash
node tests/sampler-budget-3.13.test.mjs
node tests/city-lighting-3.10.test.mjs
node tests/visual-regressions-3.11.test.mjs
node scripts/validate-city-shaders.mjs --validatorPath /path/to/glslang --compareBaseline
```

新 [sampler-budget-3.13.json](../qa/sampler-budget-3.13.json) 对每个场在反复切档过程中检查 5,405,040 个 half word 的逐位复制，并与独立旧体积三线性采样器比较 6,300 个位置（含边界、域外、方向及高度插值）。最大浮点算术差分别为 `7.11e-15` 和 `8.90e-14`；这是 CPU 插值运算舍入差，源 half word 没有变化。真实城市 JavaScript 绑定链的九次天气／画质序列检查了静态立面、道路与动态车辆，但没有创建 GL 上下文。既有夜场能量、遮挡、近远互补、固定机位选灯与 receiver-plane 阴影回归同样通过。

网页内新增的实际设备诊断在实际 draw 后读取当前 program 的 `LINK_STATUS`、活跃 uniform 数组、绑定、`VALIDATE_STATUS` 与 GL error，关联具名材质／对象和主相机绘制；失效链接的 active sampler 为 `null`，不会当成零。WebGL 的 active uniform 查询给出整个 program，因而将全部 active sampler 元素总数作为 fragment 16 上限的保守检查；源码声明的 stage 推断单独标明，并非驱动 per-stage 查询。暂停、正常运行、PNG 导出分别注明，诊断帧从性能统计剔除。

目标设备补采可集中为三项：

1. 在城市设置的“渲染完整性诊断”执行“高 / 极高切换检查 + 原始帧 ZIP”。它覆盖晴天／湿夜、反复切换、固定立面／道路与车辆视角，保存暂停帧和导出帧的诊断及原始 PNG。原用户的 1280×720、曝光 1.02 同机位对照另保留，用于确认原缺绘实际恢复。
2. 回到正常驾驶，湿夜高／极高各采一份“继续运行并采集实际驾驶帧”，核对运动中的主体绘制、灯光和反射稳定性。帧时间用已有路线性能采样；单个诊断帧不代表路线 FPS。
3. 在车辆检视页运行其材质诊断，并保留相同机位／分辨率的 corrected 阴影、玻璃、车漆与灯组实际图像。

**尚未完成的目标设备验收：** 新版具名道路和矿物 program 的实际 GPU 链接／绘制结果、普通画面与导出 PNG 的视觉一致性、整车表面质量、连续驾驶中的灯光／反射跳变、路线帧时间。云端 WebGL Disabled 不能外推目标 GPU，也不能替代这些要求。

## 技术依据

- [WebGL 2.0 规范](https://registry.khronos.org/webgl/specs/latest/2.0/)：上下文资源查询、程序与纹理 API。
- [OpenGL ES 3.0.6 规范](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)，§2.12.6–2.12.7、§3.9.2：active uniform 数组的 size、stage 纹理资源限制和 sampler 规则。
- [Khronos glslang](https://github.com/KhronosGroup/glslang)：离线编译和 AST reflection 的性质。其结果不替代真实 WebGL 驱动。
- 仓库 [Three WebGLProgram / renderer](../dist/vendor/three.module.js)、[CSM](../dist/vendor/addons/csm/CSM.js) 是本轮程序展开、cache key 与材质生命周期核查的直接实现依据。
