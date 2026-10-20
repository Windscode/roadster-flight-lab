# 3.16 原生研究界面、任务生命周期与实际导出

最终运行构建：`81926b470303a5f51844285ff604fbb84717a627271efddde494e228ce319ec2`。实际 Chrome 155 / WebGL2 / ANGLE SwiftShader，1440×900、DPR 1、balanced、中文。

[汇总与边界](summary.json) · [最终原始报告](final-81926/report.json) · [原 3.15 原始报告](baseline-3.15/report.json)

## 原始图片

| 检查点 | 最终完整原图 | 说明 |
| --- | --- | --- |
| 操作侧栏 | [01-prepare.png](final-81926/01-prepare.png) | 实测 356 px，保留三维现场 |
| 历史结果分析 | [02-results.png](final-81926/02-results.png) | 旧记录显示 3.15；首屏快／稳／气量 |
| 收起观察 | [03-observe.png](final-81926/03-observe.png) | 主面板隐藏，底部状态入口保留 |
| 实际导出交接 | [04-export-handoff.png](final-81926/04-export-handoff.png) | 配套 download、保存与完整内容核对 |
| 新任务运行 | [05-task-running.png](final-81926/05-task-running.png) | 实际生产求解器，前后 telemetry 均 takeoff |
| 新任务结束 | [06-task-ended.png](final-81926/06-task-ended.png) | 已结束且已保存，驾驶权归还 |
| 新记录 | [07-new-result.png](final-81926/07-new-result.png) | 当前 3.16 构建、完整 120 Hz 统计 |
| 真正刷新回读 | [08-saved-refresh.png](final-81926/08-saved-refresh.png) | 原库字节完全一致，选回新记录 |
| 返回城市 | [09-return-city.png](final-81926/09-return-city.png) | 实际场景切换，研究面板收起 |
| 旧版操作基线 | [01-prepare.png](baseline-3.15/01-prepare.png) | 独立完整 3.15 候选 |
| 旧版分析基线 | [02-results.png](baseline-3.15/02-results.png) | 同一组三条项目合成历史记录 |

截图是未经处理的整个页面。运行中的截图具有保存前后 telemetry 时间括号；不能称为 PNG 与单个物理步的原子绑定，也不是全程录像。每张图的 SHA 在原报告中。原 3.15 与最终 3.16 的实际源码和光场分别核验，标签不互换。

## 完整结果与耗时

[最终历史整库导出](final-81926/task-library.json)包含原三条记录的全部值，2,503,647 字节；[新模型单任务](final-81926/current-model-task.json)为 870,846 字节。最终应用点击至交接 1,637.4 ms，Worker 编码 355.6 ms，主线程传输 6.3 ms，自动化观察至保存 7,214.9 ms；两个 download 的 failure 均为 null。原版 4,321,548 字节美化 JSON 应用交接 50.9 ms，自动化保存观察 6,234.8 ms。

进度／取消／Worker 的新增能力并不表示这一单次同步基线已经更快。开发中主线程分片 44.179 s 回归的原件另保留在完整证据包，最终没有复现该延迟。上述测量不解释用户此前约 42 分钟的工具等待。

新任务经既有三维挑战按钮启动，统计覆盖全部 1,372 个 120 Hz 物理步、11.433 s 落稳、2.067 s 平台稳定、404.765 kg 外供。实际导出另含 686 个控制 I/O 点和 230 个显示采样，这些采样不是逐物理步全状态录像。它验证当前模型任务生命周期。用户已通过的旧控制图修改／另存／对照流程保持原证据，不重新贴为本轮成果。新库 4 条、3,373,507 字节，旧记录原值不变，刷新前后原始库字节一致。

运行／结束两图原样保留了前一步未手动关闭的导出回执，右上关闭按钮可见；临时回执仍遮住部分右下 HUD。没有为展示视野而事后删除这块 UI。

## 身份与错误记录

最终运行前后实际 HTTP 源码 172 项、三套光场 manifest 与体积文件一致。开发服务器尚未产生最终提交的部署文件，原始 telemetry 的 sourceCommit/sourceTree 为 null；没有补写这些历史字段。最终候选由正常提交后准备，具有包内的实际 deployment 身份。

原始报告保留 0 个 pageerror 和 2 个资源 404。软件 GPU 不代表用户显卡帧率。原始捕获主机时间字符串保持不变；时长分别使用本机 performance.now 和生产 simTime，未声明不同主机墙钟已经同步。
