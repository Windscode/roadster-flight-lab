// Display values come from retained 20 Hz integrated states. The fixed-window
// statistics remain the all-step 120 Hz summary, never reconstructed from pixels.
export function windResponseChartData(baseline,candidate){
  const records=[baseline,candidate].filter(Boolean),endS=Math.max(8,...records.map(r=>r.durationS));
  return{width:900,height:610,endS,window:{startS:2,endS:6},curves:records.map((r,i)=>({role:i?'B':'A',name:r.algorithm.algorithm.name,
    values:r.samples.map(s=>({timeS:s.timeS,heightErrorM:s.heightM-s.targetHeightM,
      windMps:s.windVelocity?Math.hypot(s.windVelocity.x,s.windVelocity.y,s.windVelocity.z):null,
      lateralM:Math.hypot(s.x,s.z)}))}))};
}

export function drawWindResponseChart(canvas,baseline,candidate,{english=false}={}){
  const g=canvas.getContext('2d');if(!g)return null;
  const data=windResponseChartData(baseline,candidate),{width:w,height:h,endS,window:win,curves}=data;
  canvas.width=w;canvas.height=h;g.clearRect(0,0,w,h);g.fillStyle='#0b1821';g.fillRect(0,0,w,h);
  const left=94,right=876,x=t=>left+t/endS*(right-left),L=(zh,en)=>english?en:zh;
  const colors=['#b6ebd6','#f3bb78'];g.font='19px system-ui, sans-serif';
  g.fillStyle=colors[0];g.fillText('A  '+L('原高度控制器','Original height law'),left,27);
  g.fillStyle=colors[1];g.fillText('B  '+L('已声明候选','Declared candidate'),left+310,27);
  const panels=[
    {top:100,bottom:288,key:'heightErrorM',title:L('高度误差 = 实际 − 目标 / m','Height error = actual − target / m'),floor:.02,signed:true},
    {top:350,bottom:425,key:'windMps',title:L('实际规定风速 / m/s','Actual prescribed wind / m/s'),floor:1},
    {top:490,bottom:565,key:'lateralM',title:L('水平偏移 / m（内环相同）','Lateral displacement / m (same inner loop)'),floor:.005}
  ];
  for(const p of panels){
    const numbers=curves.flatMap(c=>c.values.map(v=>v[p.key])).filter(Number.isFinite);
    let low=p.signed?Math.min(-p.floor,...numbers):0,high=Math.max(p.floor,...numbers);
    if(p.signed){const pad=(high-low)*.06;low-=pad;high+=pad;}else high*=1.08;
    const y=value=>p.bottom-(value-low)/(high-low)*(p.bottom-p.top);
    g.fillStyle='rgba(100,171,162,0.14)';g.fillRect(x(win.startS),p.top,x(win.endS)-x(win.startS),p.bottom-p.top);
    g.fillStyle='#d5e5e8';g.font='19px system-ui, sans-serif';g.fillText(p.title,left,p.top-18);
    g.font='17px Consolas, monospace';g.lineWidth=1;
    const ticks=p.signed?4:2;
    for(let i=0;i<=ticks;i++){const value=low+(high-low)*i/ticks,py=y(value);g.strokeStyle='#314955';g.beginPath();g.moveTo(left,py);g.lineTo(right,py);g.stroke();g.fillStyle='#b0c6ce';g.fillText(value.toFixed(p.key==='windMps'?1:3),5,py+6);}
    if(p.signed){g.strokeStyle='#cbd5d688';g.setLineDash?.([5,5]);g.beginPath();g.moveTo(left,y(0));g.lineTo(right,y(0));g.stroke();g.setLineDash?.([]);}
    // A/B share the identical wind sequence. One labelled wind curve avoids
    // implying a different forcing where coincident lines would hide each other.
    const shown=p.key==='windMps'?curves.slice(0,1):curves;
    for(const [index,c]of shown.entries()){g.strokeStyle=p.key==='windMps'?'#92c9f0':colors[index];g.lineWidth=p.key==='heightErrorM'?3:2.3;g.setLineDash?.(index?[8,4]:[]);g.beginPath();let started=false;for(const v of c.values){if(!Number.isFinite(v[p.key]))continue;const px=x(v.timeS),py=y(v[p.key]);if(started)g.lineTo(px,py);else{g.moveTo(px,py);started=true;}}g.stroke();g.setLineDash?.([]);}
    for(const time of [2,6]){g.strokeStyle='#a4d3c999';g.lineWidth=1;g.setLineDash?.([4,5]);g.beginPath();g.moveTo(x(time),p.top);g.lineTo(x(time),p.bottom);g.stroke();g.setLineDash?.([]);}
  }
  g.fillStyle='#bedfd4';g.font='17px system-ui, sans-serif';g.fillText(L('阴影：共同统计窗口 2–6 s','Shaded: common metric window 2–6 s'),left,55);
  g.fillStyle='#b0c6ce';g.font='17px Consolas, monospace';for(let t=0;t<=endS;t+=2)g.fillText(t+' s',x(t)-8,h-18);
  return data;
}
