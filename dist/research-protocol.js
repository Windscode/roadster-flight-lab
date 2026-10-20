import {DEFAULT_PARAMS} from './physics.js';
import {MODEL_VERSION} from './vehicle-models.js';
import {MODEL_BUILD_ID} from './model-build.js';
import {normalizeRobustnessCase} from './research-robustness.js';
export const PROTOCOL_VERSION='flat-lab-4';
export const EXPERIMENTS={
 steer:{title:'转向阶跃',domain:'车辆操稳',duration:4,description:'平路初速，0.5–2.5秒施加转向阶跃。速度由独立PI驾驶器维持，记录实际速度误差。'},
 launch:{title:'轮速与牵引起步',domain:'车辆操稳',duration:8,description:'相同静置初态，0.5–6.5秒全油门，随后松开。记录每轮角速度、滑移、TCS调制、距离和能量耗散；可选择干地、湿地或左右分离附着。'},
 brake:{title:'直线制动',domain:'车辆操稳',duration:10,description:'平路初速，0.5秒开始持续制动。距离从制动指令时刻积分，停止需持续0.5秒确认。'},
 attitude:{title:'空中稳姿恢复',domain:'飞行控制',duration:4,description:'12米空中初态，给定滚转扰动；比较G稳姿开启与关闭。没有额外位置锁定。'},
 rise:{title:'升降与释放',domain:'飞行控制',duration:4,description:'普通E升降输入持续2秒后释放，观察实际高度参考、上升速度与耗气。'},
 hover:{title:'悬停与气源放空',domain:'气源与能量',duration:10,description:'4米空中初态保持高度，分别记录推力能力不足、持续高度失守及触地。'},
 roll:{title:'弹道滚转与着陆',domain:'飞行控制',duration:20,description:'平地静置后按所选响应建立弹道余量；默认观察20秒，独立判断完整旋转、首次轮胎承载和持续稳定着陆。极慢响应或供气不足仍可能拒绝或未完成。'},
};
export const RESEARCH_PARAMETERS={
 tireMu:{label:'路面摩擦系数',unit:'',min:.3,max:2.2,step:.05,domain:'车辆'},
 cornerStiffnessFront:{label:'前轮标称角刚度',unit:'N/rad',min:20000,max:150000,step:5000,domain:'车辆'},
 cornerStiffnessRear:{label:'后轮标称角刚度',unit:'N/rad',min:20000,max:150000,step:5000,domain:'车辆'},
 dryMass:{label:'空车等效质量',unit:'kg',min:1000,max:3500,step:50,domain:'车辆'},
 tankLitres:{label:'气罐容积',unit:'L',min:200,max:1800,step:50,domain:'气源'},
 initialPressureBar:{label:'初始罐压',unit:'bar',min:100,max:600,step:10,domain:'气源'},
 liftNozzleMax:{label:'单主喷口额定推力',unit:'N',min:5000,max:30000,step:500,domain:'飞行'},
 nozzleVelocityEfficiency:{label:'喷管速度效率',unit:'',min:.5,max:1,step:.01,domain:'气源'},
 valveRiseTime:{label:'阀门开启时间常数',unit:'s',min:.005,max:.2,step:.005,domain:'飞行'},
 climbRateMps:{label:'E/Q 目标垂直速度',unit:'m/s',min:.5,max:14,step:.1,domain:'飞行'},
};
const enums={roadSurface:['dry','wet','split'],wingMode:['fixed','active'],supplyMode:['finite','bench'],gasModel:['adiabatic','isothermal'],nozzleModel:['isentropic','constant']};
export function validateResearchParams(params={}){
 // Scientific protocol defaults remain finite and reproducible even when the
 // interactive city defaults to continuous external supply. Explicit requests
 // can still select the bench comparison.
 const out={...DEFAULT_PARAMS,supplyMode:'finite'};
 for(const [key,value] of Object.entries(params)){
  if(!(key in DEFAULT_PARAMS))throw Error('未知参数：'+key);
  if(enums[key]){if(!enums[key].includes(value))throw Error('参数枚举无效：'+key);}
  else if(typeof DEFAULT_PARAMS[key]==='boolean'){if(typeof value!=='boolean')throw Error('需要布尔参数：'+key);}
  else {if(!Number.isFinite(value)||value<0||value>2e6)throw Error('参数数值无效：'+key);const limits=RESEARCH_PARAMETERS[key];if(limits&&(value<limits.min||value>limits.max))throw Error(limits.label+'超出研究界面允许范围');}
  out[key]=value;
 }
 const inherited={springRate:[25000,200000],suspensionDamping:[1500,18000],suctionPressurePa:[0,25000],hoverHeight:[1,40],steeringAccelG:[.2,1.2],wingDeployment:[0,1],positionGain:[.2,8],velocityGain:[.3,8],altitudeGain:[.3,10],verticalDamping:[.5,10],attitudeResponse:[1,7],rollRateDegS:[15,360],pitchRateDegS:[5,120],yawRateDegS:[5,100],angularAccelerationDegS2:[20,720],verticalAccelerationMps2:[1,10]};
 for(const [key,value] of Object.entries(out))if(!RESEARCH_PARAMETERS[key]&&!enums[key]&&typeof value!=='boolean'&&value!==DEFAULT_PARAMS[key]){const limits=inherited[key];if(!limits||value<limits[0]||value>limits[1])throw Error('本版未开放该模型常数：'+key);}
 return out;
}
export function normalizeResearchRequest(request={}){
 const kind=request.kind||'steer';if(!EXPERIMENTS[kind])throw Error('未知试验类型');
 const speedKmh=request.speedKmh??80,angleDeg=request.angleDeg??2,steerInput=request.steerInput??.22,initialRollDeg=request.initialRollDeg??35,heightM=request.heightM??12;
 if(!Number.isFinite(speedKmh)||speedKmh<20||speedKmh>160)throw Error('请输入20–160 km/h初速');
 if(!Number.isFinite(angleDeg)||angleDeg<.2||angleDeg>5)throw Error('请输入0.2–5°路轮转角');
 if(!Number.isFinite(steerInput)||steerInput<.01||steerInput>1)throw Error('驾驶转向输入应为0.01–1');
 if(!Number.isFinite(initialRollDeg)||initialRollDeg<0||initialRollDeg>70||!Number.isFinite(heightM)||heightM<8||heightM>32)throw Error('稳姿初态允许0–70°滚转和8–32米高度');
 const steeringProtocol=request.steeringProtocol??'wheel';if(!['wheel','driver'].includes(steeringProtocol))throw Error('未知转向协议');
 if(request.stabilization!==undefined&&typeof request.stabilization!=='boolean')throw Error('稳姿开关需要布尔值');
 const result={kind,params:validateResearchParams(request.params),speedKmh,angleDeg,steerInput,steeringProtocol,initialRollDeg,heightM,stabilization:request.stabilization??true};
 if(kind==='roll'){
  const durationS=request.durationS??EXPERIMENTS.roll.duration;
  if(![8,20].includes(durationS))throw Error('滚转观察窗口只支持8秒历史窗口或20秒标准窗口');
  result.durationS=durationS;
 }
 if(request.robustness!==undefined){if(kind!=='attitude'||!result.stabilization)throw Error('鲁棒试验要求启用研究姿态控制');result.robustness=normalizeRobustnessCase(request.robustness);}
 return result;
}
// Historical requests did not carry duration. Preserve their saved input window
// when exporting/loading/recomputing; this never changes the original report.
export function savedResearchRequest(request,{protocolVersion,durationS}={}){
 const next=structuredClone(request);
 if(next?.kind==='roll'){
  if(next.durationS!==undefined&&durationS!==undefined&&next.durationS!==durationS)throw Error('保存的滚转请求与记录观察窗口不一致');
  const recorded=next.durationS??durationS??(['flat-lab-1','flat-lab-2','flat-lab-3'].includes(protocolVersion)?8:undefined);
  if(![8,20].includes(recorded))throw Error('保存的滚转方案缺少有效观察窗口，不能推断重算时长');
  next.durationS=recorded;
 }
 return next;
}
export function stableStringify(value){
 if(Array.isArray(value))return'['+value.map(stableStringify).join(',')+']';
 if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableStringify(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
// Reproducible identity for comparison, not a security signature.
export function protocolId(request){let hash=2166136261;for(const c of stableStringify({version:PROTOCOL_VERSION,model:MODEL_VERSION,build:MODEL_BUILD_ID,...request})){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}return'R-'+(hash>>>0).toString(16).padStart(8,'0');}
