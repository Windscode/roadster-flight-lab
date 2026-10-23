import {ACTIONS,sharedInputs,GamepadCalibration,defaultProfile} from './semantic-input.js';
import {getLanguage,onLanguageChange} from './i18n.js';
const STORE='roadster-actions-3.21',marker=Symbol('semantic-dispatch');
const label=a=>getLanguage()==='en'?a.en:a.label;
const text=(zh,en)=>getLanguage()==='en'?en:zh;
const keyName=code=>code.replace(/^Key|^Digit/,'').replace('Space','SPACE').replace('ShiftLeft','SHIFT').replace('ShiftRight','R-SHIFT');
export function installBrowserInput(shell,{win=window,doc=document}={}){
  let target=null,disposed=false,captureAction=null,raf=0,calRaf=0,calFrames=0;
  const calibration=new GamepadCalibration();
  try{const saved=win.localStorage.getItem(STORE);if(saved)sharedInputs.setProfile(JSON.parse(saved));}catch(error){sharedInputs.note('profile-load-rejected',{reason:error.message});}
  const pad=()=>Array.from(win.navigator.getGamepads?.()??[]).find(p=>p?.connected)??null;
  function pause(){if(win.roadsterLab?.getState?.().paused===false)doc.getElementById('pause-btn')?.click();sharedInputs.release('input-settings');}
  const dialog=doc.createElement('dialog');dialog.id='input-settings';dialog.dataset.noI18n='';
  dialog.innerHTML=`<header><h2 data-i="title"></h2><button type="button" data-i="close">×</button></header><p data-i="intro"></p><p role="status" data-i="status"></p><div data-i="bindings"></div><details><summary data-i="axis-title"></summary><p data-i="axis-help"></p><div data-i="axes"></div><button data-i="axis-save"></button></details><section><h3 data-i="cal-title"></h3><p data-i="device"></p><label><span data-i="dead-label"></span> <input data-i="deadzone" type="number" min="0.02" max="0.4" step="0.01"></label><div class="input-cal-actions"><button data-i="cal-start"></button><button data-i="cal-finish"></button><button data-i="defaults"></button></div><output data-i="cal-state"></output></section>`;
  const $=name=>dialog.querySelector(`[data-i="${name}"]`);
  const css=doc.createElement('style');css.textContent='#input-settings{color:#e5f1eb;background:#102125;border:1px solid #5d817a;border-radius:12px;width:min(780px,90vw);max-height:85vh;padding:22px;z-index:200}#input-settings::backdrop{background:#000b}#input-settings header{display:flex;justify-content:space-between;align-items:center}#input-settings button,#input-settings select,#input-settings input{color:inherit;background:#20363b;border:1px solid #587571;border-radius:5px;padding:7px}#input-settings [data-i=bindings]{display:grid;gap:6px}#input-settings .input-binding{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:8px;align-items:center}#input-settings p{line-height:1.6}#input-settings [role=status]{color:#eed39a;min-height:1.5em}#input-settings .input-axis{display:grid;grid-template-columns:4em 1fr 1fr;gap:6px;margin:5px 0}#input-settings section,#input-settings details{margin-top:20px}#input-settings output{display:block;min-height:2em;margin:10px 0}#input-settings .input-cal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.input-config-open{margin:8px 0;padding:9px 12px}';doc.head.append(css);doc.body.append(dialog);
  const openButtons=[];
  for(const mount of [doc.querySelector('#game-menu .menu-main')??doc.getElementById('game-menu'),doc.querySelector('#help-modal .help-grid')?.parentElement])if(mount){const button=doc.createElement('button');button.className='input-config-open';button.dataset.noI18n='';button.onclick=open;mount.prepend(button);openButtons.push(button);}
  function status(value){$('status').textContent=value;}
  function save(){try{win.localStorage.setItem(STORE,JSON.stringify(sharedInputs.getProfile()));status(text('已保存；保持暂停。关闭设置后主动继续。','Saved; remains paused. Resume explicitly after closing.'));}catch{status(text('当前设置已生效，但浏览器拒绝持久保存。','Applied for this session; persistent storage was denied.'));}renderBindings();renderHelp();}
  function guarded(fn){try{fn();}catch(error){status(error.message);}}
  function renderBindings(){
    const profile=sharedInputs.getProfile();$('bindings').replaceChildren();
    for(const a of ACTIONS){const row=doc.createElement('div');row.className='input-binding';const name=doc.createElement('span');name.textContent=label(a);const key=doc.createElement('button');key.type='button';key.dataset.bindAction=a.id;key.textContent=profile.keys[a.id].map(keyName).join(' / ');key.onclick=()=>{captureAction=a.id;status(text('按新按键；冲突不会自动覆盖。Esc 取消。','Press a new key; conflicts are not overwritten. Esc cancels.'));};
      const button=doc.createElement('select');button.dataset.padAction=a.id;button.setAttribute('aria-label',label(a)+' gamepad');const none=doc.createElement('option');none.value='';none.textContent=text('手柄：未绑定','Pad: unbound');button.append(none);for(let i=0;i<32;i++){const option=doc.createElement('option');option.value=String(i);option.textContent='B'+i;button.append(option);}button.value=Object.entries(profile.buttons).find(([,id])=>id===a.id)?.[0]??'';button.onchange=()=>guarded(()=>{sharedInputs.bindButton(a.id,button.value===''?null:Number(button.value));save();});row.append(name,key,button);$('bindings').append(row);}
    $('axes').replaceChildren();for(const axis of profile.axes){const row=doc.createElement('div');row.className='input-axis';const index=doc.createElement('input');index.type='number';index.min='0';index.max='15';index.value=axis.index;row.append(index);for(const sign of ['negative','positive']){const select=doc.createElement('select');for(const a of ACTIONS.filter(x=>x.channel)){const option=doc.createElement('option');option.value=a.id;option.textContent=(sign==='negative'?'− ':'+ ')+label(a);select.append(option);}select.value=axis[sign];row.append(select);}$('axes').append(row);}
    $('deadzone').value=profile.calibration.deadzone;
  }
  function renderHelp(){
    for(const b of openButtons)b.textContent=text('输入与手柄设置','Input & gamepad settings');
    const grid=doc.querySelector('#help-modal .help-grid');if(grid){grid.dataset.noI18n='';grid.replaceChildren();for(const a of ACTIONS){const item=doc.createElement('div'),kbd=doc.createElement('kbd'),name=doc.createElement('span');kbd.textContent=sharedInputs.profile.keys[a.id].map(keyName).join(' / ');name.textContent=' '+label(a);item.append(kbd,name);grid.append(item);}}
    const hint=doc.querySelector('.keyboard-hint');if(hint){hint.dataset.noI18n='';hint.textContent=['forward','left','reverse','right','brake','liftUp','pitchUp'].map(id=>{const a=ACTIONS.find(x=>x.id===id);return sharedInputs.profile.keys[id].map(keyName).join('/')+' '+label(a);}).join(' · ');}
    for(const [id,action]of Object.entries({'camera-btn':'camera','forces-btn':'forces','suction-btn':'suction','roll-btn':'autoRoll','pitch-btn':'autoPitch','land-btn':'land','refill-btn':'refill','reset-btn':'reset','pause-btn':'pause'})){const kbd=doc.querySelector('#'+id+' kbd');if(kbd){kbd.dataset.noI18n='';kbd.textContent=sharedInputs.profile.keys[action].map(keyName).join('/');}}
  }
  function render(){
    for(const [key,zh,en]of [['title','统一动作 / 手柄','Actions / gamepad'],['intro','键盘与手柄使用同一动作；手动抬头和自动后翻相互独立。暂停、失焦、改绑或断连后，先松开所有输入再继续。校准只在此窗口打开期间采样。','Keyboard and gamepad share actions; manual pitch and automatic flips remain independent. Release controls after pausing, losing focus, rebinding or disconnecting. Calibration samples only while this window is open.'],['axis-title','轴映射（负向 / 正向）','Axis mapping (negative / positive)'],['axis-help','编号从 0 开始。改轴后需重新校准。','Indices start at 0. Recalibrate after changing axes.'],['axis-save','应用轴映射','Apply axis mapping'],['cal-title','分两步校准','Two-stage calibration'],['dead-label','死区','Deadzone'],['cal-start','开始：松开摇杆','Start: release sticks'],['cal-finish','完成：已扫全行程','Finish: full range swept'],['defaults','恢复默认绑定','Restore defaults']])$(key).textContent=text(zh,en);
    renderBindings();renderHelp();
  }
  function stopCalibration(reason){win.cancelAnimationFrame(calRaf);calRaf=0;calibration.cancel();sharedInputs.note('calibration-stopped',{reason});$('cal-state').textContent=text('校准已停止，未提交的采样不会保存。','Calibration stopped. Uncommitted samples are not saved.');}
  function close(){captureAction=null;stopCalibration('settings-closed');sharedInputs.release('settings-closed');if(dialog.open)dialog.close();}
  function open(){pause();captureAction=null;render();if(!dialog.open)dialog.showModal();}
  $('close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{stopCalibration('dialog-closed');sharedInputs.release('settings-closed');});
  $('defaults').onclick=()=>guarded(()=>{stopCalibration('defaults');const p=defaultProfile();p.revision=sharedInputs.profile.revision+1;sharedInputs.setProfile(p);save();});
  $('axis-save').onclick=()=>guarded(()=>{stopCalibration('axis-change');const p=sharedInputs.getProfile();p.axes=[...$('axes').children].map(row=>({index:Number(row.children[0].value),negative:row.children[1].value,positive:row.children[2].value}));p.calibration.axes={};p.calibration.deviceId=null;p.revision++;sharedInputs.setProfile(p);save();});
  $('deadzone').onchange=()=>guarded(()=>{const p=sharedInputs.getProfile();p.calibration.deadzone=Number($('deadzone').value);p.revision++;sharedInputs.setProfile(p);save();});
  function calibrationTick(){calRaf=0;if(!dialog.open||!calibration.active)return;try{calFrames++;calibration.sample(pad());$('cal-state').textContent=calibration.active?(calibration.phase==='center'?text('保持中位不动… ','Hold centered… ')+calibration.samples+'/90':text('扫动全部已映射摇杆到两个端点，并按放扳机；然后点击完成。','Sweep all mapped sticks both ways and press/release triggers, then Finish.')):text('设备已断开；校准停止。','Device disconnected; calibration stopped.');if(calibration.active)calRaf=win.requestAnimationFrame(calibrationTick);}catch(error){stopCalibration('invalid-samples');status(error.message);}}
  $('cal-start').onclick=()=>guarded(()=>{stopCalibration('restart');calibration.start(pad());sharedInputs.release('calibration');calRaf=win.requestAnimationFrame(calibrationTick);});
  $('cal-finish').onclick=()=>guarded(()=>{const profile=calibration.finish(sharedInputs.getProfile());win.cancelAnimationFrame(calRaf);calRaf=0;sharedInputs.setProfile(profile);save();$('cal-state').textContent=text('已保存此设备的中心、量程及扳机标定。','Center, range and trigger calibration saved for this device.');});
  sharedInputs.emit=(a,event)=>{const e=new win.KeyboardEvent(event.value>0?'keydown':'keyup',{code:a.code,key:keyName(a.code),bubbles:true,cancelable:true,repeat:!!event.repeat});Object.defineProperty(e,marker,{value:true});(target?.isConnected?target:doc.body).dispatchEvent(e);};
  const canonical=new Set(ACTIONS.flatMap(a=>a.keys));
  function ingress(e){if(e[marker])return;if(dialog.open){if(captureAction&&e.type==='keydown'){e.preventDefault();e.stopImmediatePropagation();if(e.code==='Escape'){captureAction=null;status('');return;}guarded(()=>{sharedInputs.bindKey(captureAction,e.code);captureAction=null;save();});return;}if(e.type==='keyup')sharedInputs.keyUp(e.code);e.stopImmediatePropagation();return;}
    if(e.type==='keyup'&&(sharedInputs.physical.has(e.code)||sharedInputs.blocked.has(e.code))){e.stopImmediatePropagation();target=e.target;try{sharedInputs.keyUp(e.code);}finally{target=null;}return;}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    // Preserve editing and native tab/escape behavior, but release anything held
    // before focus entered an editor; never turn typing into driving.
    if(e.target?.closest?.('input,select,textarea,[contenteditable="true"]'))return;
    if(sharedInputs.actionForCode(e.code)||canonical.has(e.code)){e.preventDefault();e.stopImmediatePropagation();target=e.target;try{if(e.type==='keydown')sharedInputs.keyDown(e.code,{repeat:e.repeat});else sharedInputs.keyUp(e.code);}finally{target=null;}}
  }
  win.addEventListener('keydown',ingress,true);win.addEventListener('keyup',ingress,true);
  function safetyRelease(reason){stopCalibration(reason);sharedInputs.release(reason);if(win.roadsterLab?.getState?.().paused===false)doc.getElementById('pause-btn')?.click();}
  const disconnect=()=>safetyRelease('gamepad-disconnected'),blur=()=>safetyRelease('window-blur'),visibility=()=>{if(doc.hidden)safetyRelease('document-hidden');};
  win.addEventListener('gamepaddisconnected',disconnect);win.addEventListener('blur',blur);doc.addEventListener('visibilitychange',visibility);
  function tick(){if(disposed)return;const p=pad();const panel=dialog.open||doc.body.classList.contains('body-menu')||doc.querySelector('.drawer:not(.hidden),#help-modal:not(.hidden)')||shell.studyOpen||doc.activeElement?.matches('input,select,textarea');
    sharedInputs.enabled=!panel&&!doc.hidden;
    // Continuous axes are gated here; discrete pause/map events still traverse
    // the original shell's guards, so a controller can close its pause menu.
    sharedInputs.poll(p,{enabled:!dialog.open&&!doc.hidden});
    if(dialog.open)$('device').textContent=p?`${p.id} · ${p.axes.length} axes / ${p.buttons.length} buttons`:text('未检测到手柄（在页面激活后按一次手柄按钮）。','No gamepad (press a pad button after activating this page).');raf=win.requestAnimationFrame(tick);}
  const unlisten=onLanguageChange(render);render();raf=win.requestAnimationFrame(tick);
  win.roadsterInputs={open,close,getState:()=>({profile:sharedInputs.getProfile(),journal:sharedInputs.export(),calibration:{active:calibration.active,phase:calibration.phase,samples:calibration.samples,frames:calFrames},settingsOpen:dialog.open}),bindKey:(id,code)=>{pause();sharedInputs.bindKey(id,code);save();}};
  const api=win.roadsterInputs;
  return{dispose(){disposed=true;close();sharedInputs.emit=()=>{};if(win.roadsterInputs===api)delete win.roadsterInputs;win.cancelAnimationFrame(raf);win.removeEventListener('keydown',ingress,true);win.removeEventListener('keyup',ingress,true);win.removeEventListener('gamepaddisconnected',disconnect);win.removeEventListener('blur',blur);doc.removeEventListener('visibilitychange',visibility);unlisten();dialog.remove();css.remove();openButtons.forEach(b=>b.remove());}};
}
