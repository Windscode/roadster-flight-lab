# 3.16 车辆检视：28e9 源码审阅与两机位补图

本目录只对应运行构建 `28e9bc415a0509990cb88dcbb0a95117f013969e2283260208df5921c54b1d8f` 的车辆检视范围。它不代表公开部署，也不扩大城市、研究界面、操控或诊断矩阵的验收范围。

## 已完成的只读源码核对

[dependency-review-28e9.json](dependency-review-28e9.json) 核对了当前文件的实际字节，并分别与原拍摄 `2d88…`、原 `c12a…` 记录和 [81926 只读记录](../vehicle-final-3.16/dependency-review-81926.json) 对照。这次审阅没有启动浏览器，没有生成 PNG。旧报告和旧 PNG 保持原字节与原构建号。

| 核对范围 | 实际结果 |
| --- | --- |
| 172 项当前运行源码 | 全部与 `28e9…` 构建声明一致 |
| 相对原 `2d88…` | 164 项同字节，8 项改变 |
| 相对 `c12a…` | 6 项改变 |
| 相对 `81926…` | 170 项同字节；仅 main.js 与 render-capture-matrix.js 改变 |
| 检视页的 48 个静态模块 | 相对原拍摄 46 项同字节；city-continuity.js 与生成的 model-build.js 不同 |
| 加上四个可选冻结车模后的 56 个模块 | 相对原拍摄 54 项同字节，差异仍为上述两项 |
| 检视模块相对 `81926…` | 仅生成的 model-build.js 不同；48 项中 47 项、56 项中 55 项同字节 |
| 检视 HTML、CSS、所用 HDR | 与原拍摄字节相同 |
| 原 32 张车辆检视 PNG | 每张原文件 SHA-256 核对通过，没有改成 `28e9…` 新拍 |

`main.js` 的新变化是在暂停诊断 PNG 已进入编码时，不再重复提交普通主城／反射／合成器渲染。`render-capture-matrix.js` 增加 PNG 各阶段时刻及本次成功或中止的逐 draw 记录。这两个文件均不在独立检视页的加载闭包中。它们对主场景采集延迟、失败阶段和 14 帧矩阵的实际效果由对应的最终原生采集单独验证。

## 仍保留的依赖差异与推论边界

检视页的 `new RoadsterSim()` 确实经 `city-data.js` 和 `city-continuity.js` 建立城市物理世界。Foundry 第一对新建人行带的 z 区间缩短，属于真实的碰撞数据变更，不能从静态闭包中忽略。

但原技术机位向车模传入的是明确的悬架长度、转向、轮胎转角、接触计数和密封裙开关；车体根节点的位置和姿态不读取城市求解器车身。唯一供车模使用的求解器视觉字段是固定为 `fixed/0` 的尾翼，其翼面位置和倾角由 `rearWingPose(0)` 提供。检视 Scene、棚灯、地板、HDR 和相机均独立创建，未载入城市渲染网格或湿路反射。

据此，**在原记录的固定机位、灯光、关节与尾翼 0 条件下，没有发现这项城市碰撞区间改变进入棚内实际渲染输入的通路。** 这是有限条件下的源码与数据流推论，不是整个闭包同字节的声明，也不证明原 32 张 PNG 等于 `28e9…` 的逐像素结果。

本报告明确排除全部主城图片、独立 UI 截图、行驶与导航、研究运行与导出、暂停采集调度、逐 draw／14 帧验收、硬件 GPU 性能和部署身份。[根代理的普通操控／研究源码继承记录](../native-inheritance-after-capture-3.16.json) 是另一份范围独立的证据，不由本报告扩写。

## 两机位实际补图已完成

[两图采集脚本](../capture-vehicle-final-28e9-3.16.mjs) 在 2026-10-20 19:48:01–19:48:37 UTC 实际运行了 Chrome 155 / WebGL2，完成原页面的两个“同次条件 ZIP”操作。当前前侧与座舱图各一张；产品自动附带的两张冻结 3.15 参考帧、两张标注合成图和同帧 JSON 也按原字节保留。此次仅有 **两张当前车模补图**，没有重跑 24 帧全套。原 `81926…` 的准备计划仍保留，没有执行、重命名或改写。

采集脚本原始记录为 [capture-result-28e9.json](capture-result-28e9.json)；其中 `captured-pending-visual-review` 是脚本完成时的真实状态，未在事后改写。[后续逐图审阅](visual-review.json) 已实际打开上述六张 PNG，状态为 `two-current-images-captured-and-visually-reviewed`。运行前后服务器返回的 172 项源码、生成构建文件和 HDR 共 174 个文件均与本地冻结字节一致。两个当前帧分别为 281 / 203 draw、各 9 个程序，审计均通过。

| 最后构建实际画面 | 同次冻结参考 | 逐帧条件 |
| --- | --- | --- |
| [前侧原 PNG](studio-front-quarter/surface-mvh3ixdo-275399e7-442d-4fe1-a931-07e39e513275-current-3.16.png) | [3.15 参考](studio-front-quarter/surface-mvh3ixdo-275399e7-442d-4fe1-a931-07e39e513275-reference-3.15.png) | [原 JSON](studio-front-quarter/surface-mvh3ixdo-275399e7-442d-4fe1-a931-07e39e513275-conditions.json) |
| [座舱原 PNG](studio-cabin/surface-mvh3j1xu-bd493abd-d187-41dc-b2fc-2dc7d023b526-current-3.16.png) | [3.15 参考](studio-cabin/surface-mvh3j1xu-bd493abd-d187-41dc-b2fc-2dc7d023b526-reference-3.15.png) | [原 JSON](studio-cabin/surface-mvh3j1xu-bd493abd-d187-41dc-b2fc-2dc7d023b526-conditions.json) |

| 条件 | 精确目标 |
| --- | --- |
| 浏览器视口／原始画布／DPR | 1280×720／900×720／1 |
| 展示配置 | 实验单座、ultra、近灯、完整材质、校正阴影 |
| 棚光 | 曝光 0.92，环境强度 0.72，原程序化棚灯和 HDR |
| 前侧／座舱 | 原 50 mm／18 mm 机位；逐项比较位置、目标、四元数与投影矩阵 |
| 关节 | 悬架 0.287 m，转向与轮胎转角 0，尾翼 fixed/0，非剖视，密封裙关闭 |
| 来源核对 | 运行前后检查服务器源码与 HDR，原浏览器版本及 WebGL 设备描述一致 |

已保留新的时间戳、采集 ID、实际仿真时间、设备诊断和 `28e9…` 构建号。真正用于画面的相机、灯光、材质和关节输入逐项匹配，浮点容差为相对 `1e-12`。**这两个新拍当前 PNG 的 SHA-256 分别与原 `2d88…` 对应 PNG 相同**；这是两个已实际重拍机位的字节测量结果，不外推到其余 30 张旧检视图或主城图。

实际画面中，石墨前鼻表面与下开口可分辨，轮毂材质层次和玻璃透光较原参考清楚；座舱上方的实体纯黑遮挡已移除，柱体、方向盘和仪表台边界可见。前鼻仍是较宽的方形轮廓，下开口仍黑，门侧与肩部偏硬，内饰屏幕、按钮和座椅仍简化。它们证明本轮可见改进，也保留未完成的造型与精度问题。

设备为 ANGLE SwiftShader 软件 GPU。原记录保留 ReadPixels 停顿警告，以及尚未进行最终候选打包时的 deployment.json 404；不能称 console 为空。没有未捕获页面异常或应用导出失败。记录中的保存时长包含产品导出、浏览器和自动化保存，不是单独应用编码耗时，也不作为硬件 GPU 性能结果。

[manifest.json](manifest.json) 列出本目录交付文件的实际 SHA-256。两个完整原生 ZIP 保留在独立交付目录；仓库保存每个解出的原文件，以免重复放置同一批二进制。原只读依赖报告的时间与准备状态保持不变；后来完成的实际采集由上述新记录补充。

只读核对命令：

```sh
node --experimental-vm-modules qa/vehicle-evidence-28e9-dependency-3.16.mjs
```

仅生成准备计划，不启动浏览器：

```sh
node qa/capture-vehicle-final-28e9-3.16.mjs --prepare OUTPUT_DIR CANDIDATE_URL
```
