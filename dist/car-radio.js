import {t as tr,onLanguageChange} from './i18n.js';
export async function createCarRadio(toast=()=>{}){
 const audio=document.createElement('audio');audio.preload='metadata';audio.volume=.18;audio.id='car-radio-audio';audio.hidden=true;document.body.appendChild(audio);
 const $=id=>document.getElementById(id),select=$('radio-track'),credits=$('radio-credit'),localUrls=[];
 const manifest=await fetch('./assets/music/manifest.json').then(r=>r.json());let tracks=manifest.tracks||[],index=0,loaded=false,userVolume=.18,context=null,gain=null;
 $('radio-chip').dataset.noI18n='';
 const groupNames={classical:'古典器乐',pop:'独立流行 / 演唱',ambient:'氛围 / 电子',local:'本地导入'};
 const text=(id,value)=>$(id).textContent=['radio-title','radio-artist','radio-credit'].includes(id)?value:tr(value);
 for(const id of ['radio-title','radio-artist','radio-credit'])$(id).dataset.noI18n='';
 const visibleIndices=()=>tracks.map((t,i)=>({t,i})).filter(({t})=>$('radio-collection').value==='all'||t.collection===$('radio-collection').value).map(o=>o.i);
 function applyVolume(){const t=tracks[index],db=$('radio-normalize').checked?Math.max(-24,Math.min(12,t?.normalizationGainDb||0)):0,target=userVolume*Math.pow(10,db/20);if(gain){audio.volume=1;gain.gain.setTargetAtTime(target,context.currentTime,.08);}else audio.volume=Math.min(1,target);text('radio-gain-note',$('radio-normalize').checked?'按整曲响度平滑补偿，音量旋钮统一控制。':'使用录音原始响度，切换曲目时音量可能不同。');}
 async function ensureAudio(){if(!context){try{const AC=window.AudioContext||window.webkitAudioContext;if(AC){context=new AC();gain=context.createGain();const source=context.createMediaElementSource(audio);source.connect(gain);gain.connect(context.destination);gain.gain.value=0;}}catch{context=null;gain=null;}}if(context?.state==='suspended')await context.resume();applyVolume();}
 function renderList(){select.replaceChildren();const indices=visibleIndices();for(const category of Object.keys(groupNames)){const ids=indices.filter(i=>(tracks[i].collection||'local')===category);if(!ids.length)continue;const group=document.createElement('optgroup');group.label=tr(groupNames[category]);for(const i of ids){const t=tracks[i],o=document.createElement('option');o.value=i;o.dataset.noI18n='';o.textContent=`${t.title} · ${t.artist}${t.aiAssisted?' '+tr('[AI参与]'):''}`;group.append(o);}select.append(group);}select.disabled=!indices.length;select.value=indices.includes(index)?index:indices[0]??'';if(!indices.length){const o=document.createElement('option');o.textContent='尚未导入本地音频';select.append(o);}}
 function info(){const t=tracks[index];if(!t)return;text('radio-title',t.title);text('radio-artist',t.artist);text('radio-license',t.recordingLicense||t.license);credits.textContent=t.attribution||'本地文件，仅在本机播放';text('radio-note',t.aiAssisted?'中文原创演唱 · 作者披露使用 AI 参与创作':t.collection==='classical'?(t.composer||'古典作品')+' · 器乐录音':t.instrumental?'器乐 / 无人声':`${t.language==='zh'?'中文':t.language==='local'?'本地音频':'英文'}演唱`);const link=$('radio-source');link.href=t.sourceUrl||'#';link.hidden=!t.sourceUrl;text('radio-chip',`${audio.paused?tr('♫ 已暂停'):'♫'} ${t.title}${t.aiAssisted?' '+tr('[AI参与]'):''} · ${t.artist} · ${t.license}`);text('radio-play',audio.paused?'播放':'暂停');$('radio-chip').classList.toggle('hidden',!loaded);}
 async function load(i,play=false){index=(i+tracks.length)%tracks.length;const t=tracks[index];audio.src=t.src;loaded=true;select.value=index;applyVolume();info();if(play)try{await ensureAudio();await audio.play();info();}catch(error){text('radio-status','无法播放：'+error.message);}}
 async function toggle(){if(!loaded)return load(index,true);if(audio.paused){try{await ensureAudio();await audio.play();}catch(e){toast('当前音频无法播放：'+e.message);}}else audio.pause();info();}
 const step=direction=>{const ids=visibleIndices();if(!ids.length){text('radio-status','请先导入本地音频。');return;}const at=ids.indexOf(index);return load(ids[(at+direction+ids.length)%ids.length],!audio.paused);};
 const next=()=>step(1),previous=()=>step(-1);
 $('radio-play').onclick=toggle;$('radio-next').onclick=next;$('radio-prev').onclick=previous;select.onchange=()=>load(+select.value,!audio.paused);
 $('radio-collection').onchange=()=>{const ids=visibleIndices(),wasPlaying=!audio.paused;renderList();if(ids.length&&!ids.includes(index))load(ids[0],wasPlaying);else if(!ids.length){audio.pause();info();text('radio-status','选择本机音频后，会加入此分类。');}};
 $('radio-volume').oninput=e=>{userVolume=+e.target.value/100;applyVolume();text('radio-volume-label',e.target.value+'%');};$('radio-normalize').onchange=applyVolume;
 $('radio-muted').onchange=e=>{audio.muted=e.target.checked;};
 $('radio-seek').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*(+e.target.value/100);};
 $('radio-import').onchange=e=>{const wasPlaying=!audio.paused,start=tracks.length;for(const f of e.target.files||[]){const url=URL.createObjectURL(f);localUrls.push(url);tracks.push({id:'local-'+tracks.length,title:f.name.replace(/\.[^.]+$/,''),artist:'本地导入',license:'用户本地文件',src:url,language:'local',collection:'local',instrumental:false});}$('radio-collection').value='local';renderList();if(tracks.length>start)load(start,wasPlaying);e.target.value='';};
 const clock=t=>`${Math.floor((t||0)/60)}:${Math.floor((t||0)%60).toString().padStart(2,'0')}`;
 audio.ontimeupdate=()=>{$('radio-status').dataset.playback=JSON.stringify({paused:audio.paused,muted:audio.muted,currentTime:audio.currentTime,duration:audio.duration,readyState:audio.readyState,track:tracks[index]?.id});text('radio-time',clock(audio.currentTime)+' / '+clock(audio.duration));if(document.activeElement!==$('radio-seek'))$('radio-seek').value=audio.duration?audio.currentTime/audio.duration*100:0;};
 audio.onloadedmetadata=()=>{text('radio-status','本地音频已就绪');audio.ontimeupdate();};audio.onplay=info;audio.onpause=info;audio.onended=()=>{const ids=visibleIndices();if(ids.length)load(ids[(ids.indexOf(index)+1)%ids.length],true);};audio.onerror=()=>text('radio-status','音频加载失败，可切换曲目或导入本地文件。');
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&!audio.paused)audio.pause();});
 onLanguageChange(()=>{renderList();info();applyVolume();});
 renderList();info();applyVolume();
 return{toggle,next,previous,audio,tracks};
}
