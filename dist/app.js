import './locale-bootstrap.js';
import {readVerticalResponse} from './ui-preferences.js';
import {RoadsterSim} from './physics.js';
import {createApplicationShell} from './app-shell.js';

// The physics/records shell survives a graphics-module or renderer failure.
const shell=createApplicationShell({initialSim:new RoadsterSim({climbRateMps:readVerticalResponse()})});
import('./main.js').then(module=>module.boot(shell)).catch(error=>{
  console.error(error);
  shell.graphicsUnavailable(error.message||String(error));
});
