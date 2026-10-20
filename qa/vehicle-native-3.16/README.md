# 3.16 原始车模与驾驶座舱图

本目录保留车辆组件候选构建 `2d88af03b1867667f85f6a638b12648424a378450636bd400ba0095b3341acfa` 的真实原始 PNG、原始采集 JSON 和人工逐图审阅记录。生成时间为 2026-10-20 17:23–17:31 UTC。源文件在采集前后逐一哈希核对相等。

共有 **34 张渲染器原始图**：24 张实验车技术矩阵、8 张原车双座补图、2 张主页面驾驶座舱。另有 **4 张独立整页 UI 图**，不计入 34 张同类渲染帧，也不冒充同帧原子条件。

**32 张检视图已完成到运行构建 `c12a71547cc90783b98cda473c2cb1a5b338a362a5d47592e8d238a9db0b819c` 的组件继承核验。** [完整差分与依赖记录](component-inheritance-c12a.json) 对照[当时完整源码哈希表](captured-model-build-2d88.js)：172 项源码中 170 项相同，仅两个城市模块改变，二者均不在检视依赖闭包。48 个静态模块里，47 个原字节相同；另一个是明确改变的 `model-build.js` 身份常量。加入四个可选冻结模型后共 56 模块，其余 55 个均相同。检视 HTML/CSS、前后实测哈希的 HDR 输入也相同。

这份记录承认身份常量变化，不宣称整个静态导入集合逐字节相同；常量只用于元数据、审计标签及可选合成对照标题，32 张保留的渲染器 PNG 未加入合成标题。它们是 28 张 `2d88…` 检视渲染器原图及 4 张原 3.15 页面原图，均保留真实原标签与原始条件，未重标为新采集的 `c12a…` 像素。**两张主城座舱和四张独立 UI 图不在此继承断言内。** 城市灯位/光场改变后的最终城市场景另采并保留新构建身份；本目录本身不承担最终全城或线上发布身份验收。

使用独立 Headless Chrome 155.0.8059.84、WebGL 2、ANGLE SwiftShader 软件渲染。当前图确实经过 WebGL 绘制；不把它称为用户电脑硬件 GPU 的性能验收。没有修图、重采样、生成式替换或后加的视觉标注。

## 完整对照清单

24 张主矩阵为六机位 × 棚光/自然光 × 冻结 3.15/当前 3.16。**两种模型使用同一个当前渲染器**；3.15 的源码冻结自 `9f6c8f47a2678beee3915a0320ac2bf93312e96b`。已有更早历史模型仍保留在产品中。

| 机位与光照 | 冻结 3.15 原图 | 当前 3.16 原图 |
| --- | --- | --- |
| 正前 · 棚光 | [3.15](study/studio-front-reference.png) | [3.16](study/studio-front-current.png) |
| 正前 · 自然光 | [3.15](study/daylight-front-reference.png) | [3.16](study/daylight-front-current.png) |
| 前侧 · 棚光 | [3.15](study/studio-front-quarter-reference.png) | [3.16](study/studio-front-quarter-current.png) |
| 前侧 · 自然光 | [3.15](study/daylight-front-quarter-reference.png) | [3.16](study/daylight-front-quarter-current.png) |
| 正侧 · 棚光 | [3.15](study/studio-side-reference.png) | [3.16](study/studio-side-current.png) |
| 正侧 · 自然光 | [3.15](study/daylight-side-reference.png) | [3.16](study/daylight-side-current.png) |
| 后侧 · 棚光 | [3.15](study/studio-rear-quarter-reference.png) | [3.16](study/studio-rear-quarter-current.png) |
| 后侧 · 自然光 | [3.15](study/daylight-rear-quarter-reference.png) | [3.16](study/daylight-rear-quarter-current.png) |
| 座舱 · 棚光 | [3.15](study/studio-cabin-reference.png) | [3.16](study/studio-cabin-current.png) |
| 座舱 · 自然光 | [3.15](study/daylight-cabin-reference.png) | [3.16](study/daylight-cabin-current.png) |
| 后轮近景 · 棚光 | [3.15](study/studio-rear-wheel-reference.png) | [3.16](study/studio-rear-wheel-current.png) |
| 后轮近景 · 自然光 | [3.15](study/daylight-rear-wheel-reference.png) | [3.16](study/daylight-rear-wheel-current.png) |

主矩阵每张实际分辨率 900×720，DPR 1，ultra 档；浏览器 viewport 1280×720。曝光均为 0.92，棚光环境强度 0.72、自然光 0.68。每对的摄影机、投影、灯光、转向、悬架、尾翼及仿真时间相同。完整数值保留在 [vehicle-study.json](study/vehicle-study.json)，以产品 captureId / imageFile 绑定每帧，并保留逐 draw 的实际程序检查。

## 两个原始版本页面的双座补图

下列八张图分别来自隔离的完整 3.15 页面和当前 3.16 页面，同机位、同光照、同分辨率和姿态。每张 PNG 前后各有一个 `state-before-unbound.json` / `state-after-unbound.json`；脚本验证可比条件相等。**它们属于前后状态夹证，不是原子同帧条件。**

| 机位与光照 | 原 3.15 页面 | 当前 3.16 页面 |
| --- | --- | --- |
| 原车前侧 · 棚光 | [3.15](stock/studio-front-quarter-3.15.png) | [3.16](stock/studio-front-quarter-3.16.png) |
| 原车前侧 · 自然光 | [3.15](stock/daylight-front-quarter-3.15.png) | [3.16](stock/daylight-front-quarter-3.16.png) |
| 双座座舱 · 棚光 | [3.15](stock/studio-cabin-3.15.png) | [3.16](stock/studio-cabin-3.16.png) |
| 双座座舱 · 自然光 | [3.15](stock/daylight-cabin-3.15.png) | [3.16](stock/daylight-cabin-3.16.png) |

## 主页面真实驾驶座舱

| 场景 | 原始 WebGL 图 | 同帧条件 | 事后独立 UI 图 |
| --- | --- | --- | --- |
| 晴天 | [PNG](driver/roadster-3.16.0-cockpit-clear-day.png) | [JSON](driver/roadster-3.16.0-cockpit-clear-day.json) | [UI](driver/cockpit-clear-day-ui.png) |
| 湿夜 | [PNG](driver/roadster-3.16.0-cockpit-wet-night.png) | [JSON](driver/roadster-3.16.0-cockpit-wet-night.json) | [UI](driver/cockpit-wet-night-ui.png) |

这两帧为同一车辆状态、同一实际眼点、流畅档、1440×900、暂停可视性检查；没有用隐藏整车的方法模拟座舱。相机世界位置均为 `[-199.67, 1.0023778002507449, -345.15] m`，FOV 48°。晴天保留自动曝光记录 0.8812749860，湿夜为 1.02，未伪称两种天气同曝光 AB。

[返回环绕外视 UI](driver/exterior-restored-ui.png) 确认整车显示恢复；[采集器完成后 UI](candidate-suite-completed-ui.png) 保留实际产品状态。这些都是独立 UI 截图。

## 审阅、诊断与边界

[逐图审阅](visual-review-3.16.json) 逐项记录前鼻、肩部、轮毂、玻璃、原车/实验座舱与安装结构的可见变化及限制。34 张原图全部打开审阅，另外四张 UI 也已查看。鼻部宽楔形比例、门側平面、简化座椅/屏幕和未标定玻璃仍是明确限制；本目录不声称照片级或完整 3A 质量达标。

[原始采集执行报告](vehicle-native-capture-3.16.json) 在浏览器结束时写为 `captured-pending-visual-review`；其后的人工审阅状态另见上述审阅文件，没有回写修改原始执行记录。全部 24 个矩阵逐帧审计、8 个原车 PNG 的夹证检查、2 个驾驶帧审计通过；浏览器没有未捕获 pageerror。console 并非为空：原始记录保留未发布候选的 `deployment.json` 404、未附 URL 的通用 404、SwiftShader ReadPixels、并行着色器扩展和 PMREM 采样警告。在线部署身份由发布后的独立流程验收。

应用的主座舱导出面板显示 3.32 / 5.22 s 交给浏览器；自动化从触发到保存文件分别用了 33.87 / 69.65 s。两者的起止范围不同，后者包含真实 WebGL 与浏览器自动化等待，不能用来认定应用序列化用了相同时间，也不能从本轮完成推论用户此前工具挂起的原因。

[manifest.json](manifest.json) 包含文件 SHA-256、38 张 PNG 的用途、元数据关联方式、来源版本和三份原始 ZIP 的哈希。原始 ZIP 另存完整交付包，避免在 Git 仓库中重复保存已经解出的同字节 PNG/JSON。此目录的截图和测试状态均为本项目合成场景，不含 Tesla 官方原图、账户凭据或用户私人文件。
