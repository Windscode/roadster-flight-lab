import {registerTranslations,t} from './i18n.js';
registerTranslations({
  '后空翻':'Backflip',
  '受控后空翻':'Controlled backflip',
  '受控后空翻：自动起跳、旋转、着陆；1 / 2 为手动姿态':'Controlled backflip: automatic takeoff, rotation and landing; 1 / 2 remain manual attitude controls',
  '受控后空翻 U；与 1 / 2 手动姿态分开':'Controlled backflip U; separate from manual attitude on 1 / 2',
  '受控后空翻已接管：真实起跳、俯仰旋转、落地后交还驾驶。1 / 2 仍为手动定率姿态；新操纵可取消自动动作。':'Controlled backflip: physical takeoff, pitch rotation and landing, then return to driving. Keys 1 / 2 retain manual rate control; a new driving input cancels the automatic maneuver.',
  '手动俯仰 1 / 2；受控后空翻 U':'Manual pitch 1 / 2; controlled backflip U',
  'U 使用真实喷口完成起跳、后翻和着陆；持续 W 可在落地后继续驾驶。1 / 2 是手动角速率请求，低高度倒置可能无法回稳。':'U uses actual nozzle forces for takeoff, backflip and landing; held W continues driving afterwards. Keys 1 / 2 request a manual angular rate; low-altitude inversion can prevent recovery.',
  '已有自动动作，请完成或取消后再开始':'Finish or cancel the current automatic maneuver first',
  '初始倾角须不超过 10°，请先回正':'Initial tilt must be at most 10 degrees; level the vehicle first',
  '初始角速度过大，请先松键制动':'Initial angular speed is too high; release controls to brake rotation',
  '当前水平速度超过已验证的 18 m/s 起始范围':'Horizontal speed exceeds the validated 18 m/s starting range',
  '起跳与制动推力不足':'Insufficient takeoff and arrest thrust',
  '双向俯仰力矩 / 阀门跟踪余量不足':'Insufficient bidirectional pitch torque / valve tracking reserve',
  '下降速度下的车长旋转 / 制动净空不足':'Insufficient rotational / arrest clearance at this descent speed',
  '车长旋转包络 / 预计滑行路径上方净空不足':'Insufficient overhead clearance for the vehicle-length envelope / projected coast path'
},[
  [/^受控后翻预检：(.+)$/,(_all,reason)=>'Controlled backflip precheck: '+t(reason)],
  [/^剩余冲量 ([\d.]+) kN·s 低于后翻 \/ 回稳预算 ([\d.]+) kN·s$/,'Remaining impulse $1 kN·s is below the backflip / recovery budget $2 kN·s']
]);
