# 3.9 研究记录与复现 / Research records and reproduction

本轮新增的是可检查的复现结论与历史配置工作流；现场完整快照、输入记录、同页研究、观测扰动和控制器 A/B 均沿用 3.8 的基础。

## 三种操作，三种含义

| 操作 | 执行含义 | 对历史响应的判定 |
| --- | --- | --- |
| 查看历史 / 导出 | 读取原报告、身份、原始统计与实际保存的曲线 | 不调用求解器，不改变历史版本 |
| 原条件三维 / 数值重放 | 导入完整原初态，执行原固定步驾驶输入与公开控制命令；内部控制器重新计算喷口和轮系命令 | 仅相同模型、构建、协议可执行；完成后比较终态和保留的响应曲线 |
| 按当前模型重算 / 控制器 A/B | 使用明确的当前模型；A/B 只改变已声明的控制器参数 | 报告相对历史差异，不要求复现一致，不将固定输入的重算称为自主策略重新规划 |

`status: completed` 只说明输入段已执行。独立的 `reproduction.status` 可以是 `matched`、`diverged`、`incomplete`、`insufficient_evidence` 或 `not_applicable`。三维与数值路径调用同一比较器，界面显示量值误差、容差、保留曲线覆盖、控制状态比较与首次可观测分歧，JSON 保存完整证据。

## 比较范围与容差

| 终态量 | 数值一致性容差 |
| --- | --- |
| 位置、速度、角速度 | 1e-6 m、1e-6 m/s、1e-6 rad/s |
| 四元数姿态夹角 | 1e-5°，把 q 和 −q 视为同一姿态 |
| 气量、罐温 | 1e-8 kg、1e-6 K |
| 四轮角速度向量 | 1e-5 rad/s；另列每轮误差 |
| 连续控制状态 | 绝对容差 1e-7 + 相对容差 1e-9 × 两值最大绝对值 |
| 离散控制状态 | 精确相等 |

控制状态包括目标、积分器、角速度参考、自动流程、转向记忆、轮胎侧偏松弛、ABS/TCS 调制、升降制动、回正状态、阀门、吸附执行状态、尾翼、实际风场、观测噪声种子与延迟缓冲，以及抗积分饱和记忆、终态参数、质量/惯量、重力/求解器设置、仿真时钟、步计数和耗能/耗气累计。PRNG 状态、种子和整数计数按离散数值精确比较，不使用连续相对容差。带标签的控制四元数与普通观测历史四元数都按旋转等价比较。已保存的传感器历史会比较；下一步控制前重建的 `_observation` 显示缓存不单独作为续算记忆比较。显示帧的 accumulator 不属于物理响应一致性判据。

这些容差用于辨认数值复现，**不代表 Tesla 真车标定精度**。它们远小于本项目模型假设的不确定度。阈值固定公开，不随某条测试的误差自动放宽。

历史响应只在真实保存的固定步索引上比较，不插值补造丢失的数据。报告列出保存点、比较点、原采样频率和是否抽稀；峰值、积分与 RMS 保持原始固定步统计来源。第一次分歧意味着“第一个有证据的分歧时刻”，并不声称知道两个稀疏历史点之间何时开始偏离。未达到原记录终点的取消/失败，只比较已经执行的前缀，不将当前状态与未来终态相减。终止时的公开控制命令失败，也保留此前最后一个已积分步的完整统计、气耗、电耗和原采样相位。原记录自身被取消时，可以复现已保存的那一段，同时保留原始 `sourceStatus: cancelled`。

## 3.8 历史的明确边界

网站没有安装 3.8 求解器，所以旧 3.8 记录可查看/导出，不能精确执行原模型。本轮仅提供 **schema 1、3.8.0 → 3.9.0** 的受限显式迁移：要求相同世界/碰撞几何和参数字段契约，保留每个旧参数值、刚体、轮系、气源、阀门、控制状态、风扰动相位和传感器状态；从当前初始模板补 `_driveAccounting`、`_verticalControl`、`_levelRecovery`。

其中升降制动和 pilot-active 是新控制记忆，不能统称为无影响的诊断。迁移是当前模型对旧条件的明确映射；3.8 没有相应控制律，界面和报告不将这种执行标成精确复现。旧记录中的 `climbRateMps = 1.5` 与 `steeringAccelG = 0.9` 保持原值，不静默换成新默认。没有迁移器的其他旧版本继续拒绝执行。

**旧城市现场记录有更严格的边界：** 3.9 增加了实际道路路缘/设施碰撞，3.8 城市世界的 `geometrySignature` 已不兼容。界面在启动 Worker 前明确禁用该类记录的原条件重放与完整初态重算；保留查看、导出，并要求在当前城市重新建立实验。这里可迁移的完整旧现场记录是碰撞世界仍相同的风场实验室 / 标准平地记录，不是任意 3.8 城市驾驶记录。标准数值研究按其独立的平地协议加载历史请求，不受城市建筑碰撞更改影响。

终态续算校验还包含上一步的接触支持集合，使用本地 body/shape 索引规范化。该集合影响下一步定姿起飞的车体接触判定；它不等同于已在下一次 Cannon 求解前重新构造的临时接触乘子，也不使用依进程创建顺序改变的全局对象 ID。

## 工作流与可验证证据

参数研究左侧明确标为“待运行试验”，右侧是“已保存结果”。浏览历史不会替换待运行配置；“载入此记录的配置”复制全部历史请求并显示来源身份，不立即运行、不改变现场车辆。运行后生成新的当前模型记录，保留其历史来源；待运行配置、研究模式和参数在刷新后恢复。制动/起步名称包含实际干地、湿地或分离附着工况及 ABS/TCS 开关。

仓库中 `qa/fixtures/` 的两份 3.8 证据由原始 `a25b228` 的求解器生成。湿地 ABS 关闭的旧报告与本轮按历史配置重算均为 **47.660222531435814 m** 制动距离和 **3.933333333333322 s** 抱死时间；旧报告身份与原 CSV 逐字保留。没有将未变化的结果改写成性能提升。ABS 是各轮滑移调节器，并不是 ESC；减少抱死不保证所有附着条件下更短的制动距离或更小的航向偏移。

验收记录：

- `qa/reproduction-verdict-3.9.json`：真实固定步求解器；带种子观测噪声、50 ms 延迟、阵风、喷口降额、接管；相同初态重复和 60/120/240 Hz 显示步分组；同终点但中途曲线改动、单独控制记忆改动、取消/失败、旧模型迁移、A/B。
- `qa/experiment-console-dom-3.9.json`：同一个实际数值求解器通过三维主循环适配器和后台执行入口；修改第 6 步历史位置 5 mm 后，两路均“执行完成、复现有分歧”，首次分歧一致，导出证据一致。
- `qa/research-workflow-3.9.json`：实际旧报告、当前求解结果、配置加载/刷新、原始历史不串、完整英语研究标签及中英切换。自定义名字含有可翻译的界面词语时仍原样显示；只翻译内置预设标题和状态。

以上报告附本次被测源文件 SHA-256。DOM/Canvas/Worker 调度端使用门面时，会在报告中明确说明。它们证明数值与界面行为，不证明实际浏览器布局、GPU 画面、驾驶手感或 FPS。真实 WebGL 禁用时的同页历史/数值入口与线上部署另由发布验收记录覆盖。

## English reading guide

Execution completion, model/condition compatibility and reproduction agreement are independent fields. A complete input replay can diverge; a cancelled execution cannot certify complete reproduction. The same comparator serves live 3D playback and numerical playback. It checks terminal rigid-body, gas, wheel and control-memory states plus retained curve samples at matching physics steps. Numerical tolerances measure repeatability, not real-vehicle accuracy.

Historical model 3.8 is not installed. Its records stay viewable and exportable; explicitly selecting current-model recomputation performs the bounded migration documented above. Controller A/B holds the recorded driver inputs and external command times fixed while the current controller decides actuator commands again. It does not rerun an autonomous pilot, and changing the controller does not demand equality with the original trajectory.

The expanded 3.9 city has different collision geometry. A complete 3.8 city recording cannot be migrated safely and is blocked before execution; viewing/export remain available. The supported old-state migration applies to unchanged laboratory / standard flat-road worlds. Historical standard numerical requests can still be loaded into the current flat-road protocol.

The editable next-run request and the selected historical report are separate. Load a historical configuration explicitly, then Run to create a new current-model result with provenance. Language changes affect presentation only: physical units, machine fields, historical identities, exports and user-defined names remain unchanged.
