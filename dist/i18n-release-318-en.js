import {registerTranslations} from './i18n.js';
registerTranslations({
  'G 已开启：回平、保高与水平速度阻尼；不锁定 X/Z 位置。':'G enabled: level attitude, height and horizontal velocity damping; no X/Z position lock.',
  'G 已关闭；已请求的 X / U / L 动作继续，操作卡显示当前阶段。':'G disabled; the requested X / U / L maneuver continues. The operation card shows its phase.',
  'G 已关闭；H / E 辅助飞行仍由你先前的请求保持。按 H 返回 DRIVE 可关闭。':'G disabled; H / E flight assist remains active from your earlier request. Press H to return to DRIVE and disable it.',
  'G 已关闭；当前为 DRIVE，碰撞或倾斜不会自动开启辅助喷气。':'G disabled; currently in DRIVE. A collision or tilt will not automatically enable flight assist.',
  'G 已关闭；当前直接推力控制仍按手动输入执行。':'G disabled; direct thrust continues to follow manual input.',
  'G 回平保高 · 开启':'G level + height · On',
  'G 回平保高 · 关闭':'G level + height · Off',
  '已开启 G 回平保高':'G level and height hold enabled',
  '已关闭 G 回平保高':'G level and height hold disabled',
  'G 已关闭：已请求的动作继续；H 取消动作并返回 DRIVE。':'G off: the requested maneuver continues; H cancels it and returns to DRIVE.',
  'G 已关闭：直接阀门输入正在控制喷气；松开阀门后请求归零。':'G off: direct valve input controls the jets; releasing the valves clears the request.',
  'G 已关闭：H / E 辅助飞行正在运行；按 H 返回 DRIVE 可关闭。Z / B 滚转，1 / 2 俯仰。':'G off: H / E flight assist is active; H returns to DRIVE and disables it. Z / B roll; 1 / 2 pitch.',
  'G 已关闭：当前为 DRIVE。H / E 会开启辅助飞行；碰撞和倾斜不会自动开启。':'G off: currently in DRIVE. H / E enables flight assist; collisions and tilt do not enable it automatically.',
  'G 已关闭：当前为直接推力模式，喷气请求跟随手动输入。':'G off: direct thrust mode; jet requests follow manual input.',
  'G 与辅助飞行的控制边界':'G and flight-assist control boundaries',
  'G：回平、航向和高度保持，并抑制水平速度；不锁定 X/Z 位置。H / E 启动的辅助飞行独立保留，按 H 回到 DRIVE 可关闭。X / U 是明确请求的完整动作；手动 E + 1 仍是独立操纵。右侧操作卡显示当前喷气来源与目标。':'G levels attitude, holds heading and height, and damps horizontal velocity without an X/Z position lock. H / E flight assist remains independent; H returns to DRIVE and disables it. X / U are explicitly requested full maneuvers. Manual E + 1 retains separate controls. The operation card shows the current jet controller and target.'
},[[/^当前 3\.18 外观$/,'Current 3.18 exterior'],[/^导出同机位 3\.15 \/ 3\.18 对照 PNG$/,'Export matched-view 3.15 / 3.18 PNGs']]);
