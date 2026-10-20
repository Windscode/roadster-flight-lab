import {registerTranslations} from './i18n.js';

registerTranslations({
  '恢复默认升降速度 5 m/s':'Restore default vertical speed: 5 m/s',
  '目标垂直速度 · 0.5–14 m/s · 默认 5 m/s':'Target vertical speed · 0.5–14 m/s · Default 5 m/s',
  '升降响应已恢复默认 5 m/s。':'Vertical response restored to the 5 m/s default.',
  '手动姿态与操控强度':'Manual attitude & response',
  '平稳':'Gentle',
  '标准':'Standard',
  '机动':'Maneuver',
  '升降加速与制动':'Vertical acceleration & braking',
  'Z / B 滚转速率':'Z / B roll rate',
  '1 / 2 俯仰速率':'1 / 2 pitch rate',
  '姿态角加速度':'Angular acceleration',
  'G 已关闭：Z / B 滚转，1 / 2 俯仰；松键后主动制动。':'G off: Z / B roll; 1 / 2 pitch. Release to brake the motion.',
  'G 已开启：保持水平；Z / B 用于横移。关闭 G 后使用手动姿态。':'G on: hold level; Z / B translate sideways. Turn G off for manual attitude.',
  '研究程序保持目标姿态；按 G 转为水平稳定，手动输入可接管。':'A research program is holding its target attitude. Press G for level stabilization or use manual inputs to take over.',
  '手动与 X 共用速率和角加速度限制。高强度动作需要足够高度与制动空间。 X 在启动时固定本次限制，执行中的改动用于下一次。':'Manual control and X share rate and angular-acceleration limits. Strong maneuvers need enough height and braking clearance. X freezes its limits at launch; edits during a maneuver apply to the next X.',
  '已应用操控响应；实际动作仍受喷口、压力与制动余量限制。':'Response applied. Actual motion remains limited by nozzles, pressure and braking authority.',
});
