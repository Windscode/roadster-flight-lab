import {MODEL_VERSION} from '../dist/vehicle-models.js';

// Re-running a legacy regression checks the current model. Its output must not
// overwrite the evidence collected for the release that introduced that test.
export const REPORT_VERSION = MODEL_VERSION.split('.').slice(0, 2).join('.');
