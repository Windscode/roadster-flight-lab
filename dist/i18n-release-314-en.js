import {registerTranslations} from './i18n.js';
registerTranslations(Object.fromEntries([
 ['状态','Status'],
 ['现场实验已结束，但仅本会话 / 未保存。请导出完整结果或整库；旧存档未覆盖。','The live experiment ended but is session only / unsaved. Export the complete result or archive; the previous archive was not overwritten.'],
 ['超调沿目标方向投影。新版主统计来自全部 120 Hz 物理步；20 Hz 曲线及历史抽稀仅供显示。每条结果的 statisticsHz 独立保留。流程完成只表示阶段已执行，稳定与受限情况请看测量。','Overshoot is projected along the target direction. Current primary statistics use every 120 Hz physics step; 20 Hz and historically thinned curves are for display. Each result retains its own statisticsHz. Program completion means the stages ran; use the measurements to assess stability and limits.'],
 ['无效姿态已捕获，试验复位','Invalid orientation detected; experiment reset'],
 ['车壳下估计','Hull gap estimate'],['整车上方','Above envelope'],['含轮胎下方','Below tyres / hull'],
 ['静态配平与失败证据','Static trim and failure evidence'],['计算当前配平与余量','Assess current trim and reserve'],['导出配平与净空 JSON','Export trim and clearance JSON'],['导出最近求解故障','Export last solver fault'],['尚未计算当前配平。','Current trim has not been assessed.'],['检查当前姿态和气压下的有界重力配平。静态可行、动态控制余量与实际恢复是不同结论。','Bounded gravity trim at the current attitude and pressure. Static feasibility, dynamic authority and actual recovery are separate verdicts.'],['下表为静态候选力，不是当前阀门实际推力。','The table shows a static force candidate, not current delivered valve thrust.'],['候选 N','Candidate N'],['上限 N','Capacity N'],['存在静态配平解','Static trim is feasible'],['当前请求无静态配平解','No static trim for this request'],['力残差','Force residual'],['力矩残差','Moment residual'],['动态恢复未据此判定','Dynamic recovery is not established'],['双向单轴力矩余量','Bidirectional single-axis torque reserve'],['其它五轴保持不变；各轴余量不能同时相加，未含阀门滞后。','Other five axes held constant; these reserves cannot be added simultaneously and exclude valve lag.'],['有余量','Reserve available'],['当前场景没有已保留的求解故障。低气源或硬着陆请查看对应任务结果。','No solver fault is retained in this scene. Low supply and hard landings are reported by their task results.'],['已导出复位前故障与最后有效状态；非有限值使用明确字段保存。','Exported the pre-reset fault and last valid state; non-finite values are explicitly encoded.'],
 ['08 / 横街工业转角','08 / Cross-street industrial corner'],['09 / 机造维护庭','09 / Foundry work bay'],['10 / 台地坡顶导向','10 / Terrace crest markings'],['11 / 议庭入口铺装','11 / Forum arrival paving'],['12 / 南岸到达与步行转换','12 / Quay arrival and pedestrian transition'],['13 / 水庭内部待实测视点','13 / Watercourt interior: native check pending'],
  ['世界重心 H','World CG H'],['包络估计（含轮胎）','Envelope estimate (includes tyres)'],['侧向','Side'],['8 m内未采到','No hit within 8 m'],['重心向下射线','CG downward ray'],['物理包络采样，可能漏过细小障碍；不是可用恢复高度。','Physical envelope samples may miss thin obstacles; this is not available recovery height.'],['仿真已暂停 · 按 P 继续','Simulation paused · Press P to resume'],['已复位并暂停。按 P 继续；旧按键与阀门指令已清除。','Reset and paused. Press P to resume; previous key and valve commands cleared.'],
  ['没有收到完整绘制与PNG编码结果；请保持页面可见并检查WebGL。','The rendered frame and PNG encoding did not finish. Keep the page visible and check WebGL.'],
  ['场景资源在 20 秒内未就绪；检查已结束，已采结果保留。','Scene resources were not ready within 20 seconds. The check ended; captured results are retained.'],
  ['真实绘制采集','Actual draw capture'],['采集结束','Capture finished'],['绘制检查通过','Draw checks passed'],
  ['已取消，已采前缀保留','Cancelled; captured prefix retained'],['未通过，原始失败证据已保留','Failed; original failure evidence retained'],
  ['采集包编码失败；可导出诊断JSON：','Archive encoding failed; diagnostic JSON is available:'],
  ['取消采集 · ESC','Cancel capture · ESC'],['重新下载最近采集包','Download the latest capture again'],
  ['实际绘制矩阵 · 物理暂停','Actual draw matrix · Physics paused'],
]),[
 [/^真实绘制采集 (\d+) \/ (\d+)$/,'Actual draw capture $1 / $2'],
 [/^力残差 ([-\d.]+) N$/,'Force residual $1 N'],
 [/^力矩残差 ([-\d.]+) N·m$/,'Moment residual $1 N·m'],
 [/^双向单轴力矩余量 X \/ Y \/ Z: ([-\d.]+) \/ ([-\d.]+) \/ ([-\d.]+) N·m\. 其它五轴保持不变；各轴余量不能同时相加，未含阀门滞后。$/,'Bidirectional single-axis torque reserve X / Y / Z: $1 / $2 / $3 N·m. Other five axes held constant; these reserves cannot be added simultaneously and exclude valve lag.'],
]);
