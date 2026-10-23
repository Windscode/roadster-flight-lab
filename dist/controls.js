// Vehicle axes remain +Z forward, +Y up, driver's right -X.
// Physical bindings and gamepad calibration live in the same action registry.
import {sharedInputs} from './semantic-input.js';
export function driverAxes(keys,pad){return sharedInputs.axes(keys,pad);}
