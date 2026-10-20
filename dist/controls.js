// Vehicle coordinates: +Z forward, +Y up. Driver's right is -X.
// Keep the force model's positive steer toward +X; convert every user device here.
// Keyboard 1 / 2 and controller shoulders request bounded nose-up / nose-down
// rates. Raw nozzle valves are a separate research API, never a pilot shortcut.
export function driverAxes(keys,pad){
  const down=(...codes)=>Number(codes.some(k=>keys.has(k)));
  const i={throttle:down('KeyW','ArrowUp')-down('KeyS','ArrowDown'),
    steer:down('KeyA','ArrowLeft')-down('KeyD','ArrowRight'),brake:down('Space'),
    lift:down('KeyE')-down('KeyQ'),roll:down('KeyZ')-down('KeyB'),
    pitch:down('Digit1','Numpad1')-down('Digit2','Numpad2'),
    boost:!!down('ShiftLeft','ShiftRight'),frontJets:0,rearJets:0};
  if(pad?.connected){
    // Remove the centre deadzone continuously. The former branch jumped
    // straight from zero to 13% command when a stick barely crossed its edge.
    const dead=v=>{const axis=Math.max(-1,Math.min(1,Number.isFinite(v)?v:0));return Math.sign(axis)*Math.max(0,(Math.abs(axis)-.13)/.87);};
    i.steer||=-dead(pad.axes[0]||0);i.roll||=-dead(pad.axes[2]||0);
    i.throttle||=(pad.buttons[7]?.value||0)-(pad.buttons[6]?.value||0);
    i.lift||=-dead(pad.axes[1]||0);i.brake=Math.max(i.brake,pad.buttons[0]?.pressed?1:0);
    i.boost||=!!pad.buttons[1]?.pressed;
    i.pitch||=Math.max(-1,Math.min(1,(pad.buttons[4]?.value||0)-(pad.buttons[5]?.value||0)));
  }
  return i;
}
