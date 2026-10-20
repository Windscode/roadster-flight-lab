# 3.14 — 配平、相机、净空与失败末态

本页记录物理/操控实现与证据边界。基线为功能提交 `1dde9a3df081297978d7cc98409be86bcc6daa23`、证据提交 `a62b6e3d6f9b7a1410561ae64d9026dd35b64a2b`。3.13 的快翻、制动分配、连续输入、G 回正与研究历史保持；本批没有改大轮胎 μ、喷口上限、机械功率，也没有直接写车体姿态或速度来改善结果。

## 1. 配平：验证可行解集合

### 已复现的根因

3.13 `_holdTrimFeasible` 只检查一组对称均分候选。四个竖直喷口在满足总升力、俯仰力矩和滚转力矩后仍有一个对角分配自由度，单口降额时不能将均分候选不满足上限等同于无可行解。

水平、零速度/角速度、无风、350 bar 恒压 bench 的独立反例：

| 量 | 数值 |
| --- | ---: |
| 当前模型总质量 | 2199.558200 kg |
| 重力 | 21577.665945 N |
| FL 健康度 | 0% |
| FR / RL 静态推力 | 各 10788.832972 N |
| FL / RR 静态推力 | 0 N |
| 单主喷口额定上限 | 20000 N |
| 3.13 均分判定 | 不可配平 |
| 3.14 有界可行区间 | 可配平 |
| 独立合力/力矩残差 | 该水平反例为 0 |

这是对静态判定的数值修正，不是先前已经实测的动态恢复失败。独立 `r × F` 校核不读取分配器的 `column` 或 `achievedWrench`。

### 实现

`dist/trim-feasibility.js` 使用实际十喷口几何。先满足前后侧喷力及轴向力，再构造四主喷口的一个自由变量区间；整个区间与各喷口上下限相交。几何不符合所声明对称布局时明确拒绝证书。不可行请求保留有界近似分配的实际残差，近似残差不负责判定可行性。

公开容差：合力各分量 0.05 N，力矩各分量 0.05 N·m，喷口边界浮点容差 `1e-7 N`。报告还保存合力/力矩残差范数、喷口推力、上下调余量及饱和口。

`getHoldTrimAssessment({target:'current'|'level'|'hold', includeReserve:true})` 另给出：保持其余五维 wrench 不变时，单轴正负方向可增加的静态余量。它们不能同时使用，不包含阀门响应、动量、供气衰减或风扰恢复。上面的 FL 全失效反例虽然能承重，但双向 pitch/roll 余量均为零；界面不得将它改写为“任意扰动均可恢复”。

### 证据

- `tests/physics-controls-3.14.test.mjs` / `qa/physics-controls-deepening-3.14.json`：四只主喷口分别 0/25/50/100%，350/30/20 bar，水平、滚转 15°、俯仰 20°、组合倾斜及倒置；完整 240 组可行和不可行结果保留。
- `tests/trim-independent-3.14.py` / `qa/trim-independent-3.14.json`：独立 Python/SciPy HiGHS 线性等式可行性检查，由位置与方向重建六维矩阵，与 JS 证书核对。SciPy 仅为验证环境依赖，网站不加载它。
- 原 `pose-hold` 和 `physics-research-3.8` 回归覆盖无故障定姿、真实力/矩平衡、有限气源、原始阀门优先级、接触让行、显示率重复性、快照、ABS/TCS 等。最终构建结果以最终聚合报告为准。

## 2. 城市相机与净空

### 相机

`dist/chase-camera.js` 保留 3.12 水平位移 transport 和竖直滤波，并新增 `resolveCameraObstruction`。chase/orbit 的视线针对 `sim.getWorldGeometry()` 共享碰撞盒计算，将每个 OBB 按近裁面角点半径膨胀，覆盖近裁面，不只检测一条中心线。遇到障碍立即拉近；解除后等待 0.18 s，再按 3.5/s 缓慢释放。侧栏带来的投影视口偏移可用 `viewOffsetFraction` 增大近裁面包络。

实现阶段保留了一次实际失败：只在发生新的拉近时启动等待，细杆隔帧遮挡会在计时耗尽后产生约 0.299 m 的相邻帧跳变。现在只要同一最近遮挡仍限制相机距离，就刷新释放等待。原 `<0.02 m` 的细杆夹具断言保留，没有删断言换绿灯。

接入契约：

```js
const answer = resolveCameraObstruction({
  target, desired: wantedPosition, geometry: sim.getWorldGeometry(),
  previous: obstructionState, dt,
  near: camera.near, fov: camera.fov, aspect: camera.aspect,
  viewOffsetFraction
});
camera.position.copy(answer.position);
obstructionState = answer.state;
```

`wantedPosition` 必须独立保存。chase 对未遮挡期望位置做原跟随计算；实际 `OrbitControls` 操作独立 proxy camera，渲染相机只接收最终约束后的结果。已用仓库真实 OrbitControls 数值复现接入错误：渲染半径因墙体拉到 1.5 m 时，仅旋转就被 controls 的 `minDistance=3.6` 抬到 3.6 m；把这个半径比误当用户缩放，会将 8 m 期望距离变成 19.2 m。独立 proxy 消除了这条误判路径，原最小距离与显式缩放仍生效。切换模式/世界时清理相机约束状态。固定机位、驾驶舱不套用这个第三人称约束。

另有贴墙边界夹具：观察锚点在膨胀 padding 内但在实际墙外时，允许相机向外离开 padding；穿过墙体后离开 padding 仍算遮挡，不能借这个例外穿墙。这里是几何和实际 controls 代码的 Node 验证，尚不是人手拖动浏览器的验收。

数值夹具覆盖墙体、光轴未碰而近裁面碰到的细杆、狭巷、桥下、倒车接近与连续转向，并检查不修改车辆物理输入。它们不代替真实城市驾驶和像素验收。3.13 真人记录仅出现一次未隔离触发的 orbit 切换，本页没有将它解释为自动回退故障。

### 高度与距离的三个不同含义

`sim.getClearanceEstimate({maxDistance:12, directions:['down','up',...], includeQuickRoll:true})` 返回：

| 字段 | 含义 |
| --- | --- |
| `worldCgHeightM` | 重心世界 Y，不能用作恢复可用高度 |
| `centreDownDistanceM` | 重心世界竖直向下到最近碰撞面的射线距离 |
| `distances[direction]` | 四个物理车壳盒角点与当前轮胎包络采样的最近距离；含轮胎，正常接地为 0 |
| `hullDistances[direction]` | 同一批已取得射线中的车壳样本，排除轮胎；不是完整视觉车底 CAD |
| `quickRollHeadroom` | 与 quick-roll-1 预检共用的五条 CG 平面向上采样 |
| `recoveryHeightM` | `null`；没有把几何距离伪装成动态恢复余量 |

方向为 `down/up/negativeX/positiveX/negativeZ/positiveZ`。没有命中时为 `null` 和 `no-surface-in-range`，不能显示无限安全净空。真实轮胎/刚体接触强于从已穿入表面的样本出发的射线，会将对应方向包络距离标为 0。

所有包络距离仍需标“估计”：有限样本可能漏过样点之间的细障碍，不包含仅视觉存在的细部，不是连续扫掠体积证明。轮胎与接触值来自最近固定步。此 API 应低频查询用于 HUD；不要每个 120 Hz 固定步无差别查询所有方向。需要 120 Hz 研究指标时，应声明其真实碰撞/采样口径。

`tests/camera-clearance-3.14.test.mjs` 在地面、8 m 台地、20 m 屋顶及倾斜桥下分别核对标签数据。在正常水平地面，世界 CG 约 0.597 m、CG 下射线约 0.597 m、含轮胎包络为 0、四盒车壳下方约 0.347 m；不能用 `CG 下射线 - 0.6 m` 处理倾斜状态。

### 查询成本

`tests/clearance-cpu-3.14.mjs` 在实际 `city/harbor/skyway/waterfront` 四个位置各预热 16 次、测量 60 次。全六向 56 个点、8 m 搜索、中心向下与 X 五条上方射线，合计每次 342 条射线。此共享验证机 Node 的 p50 为 0.37–0.59 ms、p95 为 0.56–1.16 ms；两个位置的 p99 约 5.4–5.7 ms，保留完整样本，不将长样本排除。4 Hz HUD 查询的中位累计 CPU 开销约 1.5–2.35 ms/s。这只是 API 成本，不能外推目标浏览器帧时或 GPU 性能；最终值与环境见 `qa/clearance-cpu-3.14.json`。

## 3. 失败末态

`dist/simulation-safety.js` 在安全复位前保存失败报告；不改变正常物理力和控制输出。常驻 WeakMap 保留最近 240 步输入/接触，以及最近有效的诊断物理快照，避免把整个静态城市每 120 Hz 完整导出。

`sim.getFailureReport()` 的关键字段：

- `kind/reason/phase/triggerStep/triggerSimTime`：明确发生在步前还是积分后的安全域/非有限状态故障。
- `lastValidPhysical/triggerPhysical`：`roadster-physical-diagnostic`，含位置、四元数、速度、资源、轮载/行程/滑移、阀门、接触对象/穿透和输入。它们是诊断快照，**不是完整 Cannon continuation snapshot**。
- `triggerContinuationSnapshot`：仅在复位前完整 `exportState()` 成功时保存；非有限故障时为 `null` 并给 `continuationUnavailable`。
- `nonFiniteFields`：具体字段与 `NaN/Infinity/-Infinity` 描述。诊断里的非有限数编码为 JSON 对象，不把无效 JSON 传给导出。
- `history`：最近 240 步，包含归一化已施加输入、原始输入及接触/轮状态。`historyFrequencyHz` 反映实际固定步长；混合步长则为 `null`。

研究结果应保存失败身份与 `terminalDiagnostic`。有完整末态时可以另存它；非有限末态不能将复位后的原点或诊断结构冒充可重放完整物理快照。完整初态、输入和触发步仍可保留，但失败末态本身需标记不可恢复。

复位清理旧驾驶输入、喷口 command/force、研究高度命令、轮接触信息和旧 Cannon 接触/重叠记录。故障锁存期间不继续消费旧输入；用户显式重置后可重新运行。独立失败报告不会被手动重置悄悄删掉。

低气源、真实硬着陆与高速台阶导致的失稳不自动归类为求解器异常。专项夹具验证低气源着陆会产生真实接触且没有虚构 solver fault。

## 4. 最小接触与转向夹具

`tests/contact-regressions-3.14.test.mjs` 使用明确隔离的地面/台阶/斜坡/柱/护栏，120 Hz 积分，输出完整每步 NDJSON gzip。它不改变生产城市场景，也不证明城市场景全碰撞通过。

覆盖 2/5/10 cm 全宽与单轮短台阶、坡脚/坡顶各 20/50/90 km/h 初始条件，桥墩正碰/斜擦、护栏、硬着陆，以及 54/90 km/h 干湿面的真实 `driverAxes` 键态映射和连续模拟量请求。每轮记录载荷、行程、轮速、侧偏/纵滑、纵横向力与摩擦利用率；每步含车体轨迹、速度、能量、接触对象和穿透量。

第一轮默认松油再生制动使 20 km/h 初始条件到台阶时只剩约 8.78 km/h。这个前置条件失败保留在 `qa/contact-preconditions-3.14.json` 和对应 gzip 选定完整轨迹。被动接触夹具随后**明确设 `regenForce=0`** 隔离路面接触，并报告首次接触步前/步后实际车速；生产默认值保持 2600 N，转向夹具仍用生产默认再生制动。台阶前输入与固定轮速仅为一次初态设置，之后全部积分，没有强制维持速度。

机械能检查包含车体平动/转动、轮转动、重力与射线弹簧势能。4% 峰值增能和 0.30 m 穿透仅是本夹具的复查筛选阈值，不是工程认证容差。射线悬架、刚性轮底止挡、有限步长和无软体轮胎仍是模型限制。

**保留不利结局：** 90 km/h 初始条件撞 10 cm 台阶可出现明显俯仰/滚转失稳与车壳接触。完整台阶约降至 15.7 km/h，单轮短台阶约降至 33.5 km/h（以最终同构建报告为准）；这不是“90 km/h 台阶驾驶通过”。没有仅凭失稳就认定求解器错误，也没有加 μ、锁姿态、提高物理频率或抬升车辆掩盖它。报告将 `vehicle-upset/hull-contact` 与数值故障分开。

## 5. 研究高度外环接入

只开放风实验室 `hover + hold` 的世界竖直加速度层：

```js
sim.setResearchHeightControl({
  accelerationMps2, step: sim._stepCount, controllerHash,
  expiresAfterSteps: 12 // 1..12 fixed steps
});
sim.clearResearchHeightControl('reason');
```

输出范围 ±6 m/s²，物理入口的变化率上限 30 m/s³。请求/实际输出/限幅或超时理由分别显示。命令有有限寿命且纳入完整物理快照。只有高度加速度被替换，原水平/姿态反馈、wrench 分配、阀门动态、喷口上限、压力/气量/故障继续生效。X、原始喷口接管、切换模式、失效与复位会撤销此入口。算法内容、安全 AST、声明频率与任务统计由研究模块负责，不将这个入口宣传为任意六自由度算法沙箱。

## 6. 继承证据与未验收项

已实际查看物化的 3.13 `x08.jpg` 和上城返程 `39-upper-return-midway.jpg` 原始像素，并读取 `x-measurements-derived.json` 与全面评审相关段落。它们属于已发布 3.13，不能当作本批后图。

继承 X 真人 bench 证据：CG 0.597009→3.904830 m、净升 3.307821 m，+3.516667 s 首次两轮复接触，累计 roll 峰值约 365.510947°，末约 360°。没有精确退出事件；20.716667 s 不是动作耗时。此批没有重新将独立 quick-roll-1 绑回手动舒适包络。

冻结 3.9/3.12 与当前数值 X gate 已按当前报告版本写入 `qa/x-flip-3.14.json` 及曲线，避免覆盖 3.13。当前 ground / bench 600 L 的全部 metrics 与已发布 3.13 数值报告逐值相等：最高 CG 3.904829594 m、峰角速度 372.629215°/s、累计滚转峰值 365.785030°、内部退出 3.691667 s、退出时外供气吞吐 150.179731 kg。它与上面的真人记录分别统计，不将累计角度差或统计终点合并。本批保留快翻体验，没有宣称修复了实机超调或落点。有限供气和手动提前/延后松键序列仍单列。

旧 X fixture 将 modelVersion 单独改成当前版本，现在会因缺少研究外环完整状态明确拒绝。专项中仅为继续比较旧轨迹，显式加入声明的 inactive 默认状态，并在报告中保存这些默认值；这不开放未声明的旧记录完整迁移，不表示跨模型精确复现。历史 `x-midroll-3.12.json` 及 3.13 报告保持原字节。

仍需最终浏览器验收：城市 chase/orbit 的窄巷、桥下、贴墙倒车、连续转弯、低空入廊道；面板/焦点、R 后暂停与 P 恢复；真实键盘与模拟量手感；同构建实际图像与路线帧时。纯几何相机夹具、数值回归与 CPU 计时不能替代这些。部署/最终 sourceCommit/sourceTree 和最终聚合状态由发布文档绑定。
