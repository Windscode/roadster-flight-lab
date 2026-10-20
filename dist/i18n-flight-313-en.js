import {t as tr} from './i18n.js';
export const entries={
 '旋转窗口结束：未满足回正判据':'Rotation window ended without satisfying the levelling criteria',
 '滚转预检：快翻正在执行，请等待完成或先取消':'Roll precheck: a quick roll is already running. Wait for completion or cancel it first.',
 '滚转预检：快翻要求初始倾角不超过 10°，请先回正车身（G）':'Roll precheck: quick rolls require an initial tilt no greater than 10°. Use G to level first.',
 '滚转预检：初始角速度过大，请先松键制动或用 G 回正':'Roll precheck: initial angular speed is too high. Release the controls to brake or use G to level.',
 '滚转预检：当前压力 / 供电下的起跳与制动推力不足':'Roll precheck: launch and braking thrust are insufficient at the current pressure / electrical supply.',
 '滚转预检：快翻的双向滚转 / 制动力矩余量不足，请检查压力、喷口或惯量':'Roll precheck: insufficient torque reserve in both roll / braking directions. Check pressure, nozzles or inertia.',
 '滚转预检：当前下降速度下没有足够起跳制动净空':'Roll precheck: insufficient launch-braking clearance at the current descent speed.',
 '滚转预检：快翻旋转 / 制动包络上方净空不足':'Roll precheck: insufficient overhead clearance for the quick-roll rotation / braking envelope.',
 '快翻：短起跳，完成一周后着陆':'Quick roll: short launch, one full turn, then land',
 '快翻：完成一周并返回起始高度':'Quick roll: one full turn, then return to starting height',
 '快翻：建立短起跳与轮廓净空':'Quick roll: establishing short-launch and body-envelope clearance',
 '起跳速度 / 轮廓净空未在预定窗口建立':'Launch speed / body-envelope clearance was not established within the planned window',
};
export const patterns=[
 [/^滚转预检：剩余冲量不足：可用 ([\d.]+) kN·s，快翻 \/ 回稳预算 ([\d.]+) kN·s$/u,(_,available,required)=>`Roll precheck: insufficient remaining impulse: ${available} kN·s available; ${required} kN·s budgeted for quick roll / recovery.`],
 [/^旋转窗口结束：实际累计 ([\d.−-]+)°，未满足完整一周 \/ 回正判据$/u,(_,angle)=>`Rotation window ended at ${angle}° actual travel, without satisfying the complete-turn / levelling criteria`],
 [/^滚转中止：(.+)，尝试物理回稳$/u,(_,reason)=>`Roll aborted: ${tr(reason)}. Attempting physical recovery.`],
 [/^自动翻转中止：(.+)$/u,(_,reason)=>`Automatic roll aborted: ${tr(reason)}`],
 [/^滚转未完成：(.+)；已返回起始空中高度$/u,(_,reason)=>`Roll incomplete: ${tr(reason)}; the original airborne height has been restored.`]
];
