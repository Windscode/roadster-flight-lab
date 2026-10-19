import {registerTranslations,observeTranslations,bindLanguageSelectors} from './i18n.js';
import {entries as mainEntries,patterns as mainPatterns} from './i18n-main-en.js';
import {entries as researchEntries,patterns as researchPatterns} from './i18n-research-en.js';
import {entries as visualEntries,patterns as visualPatterns} from './i18n-visual-en.js';
registerTranslations(mainEntries,mainPatterns);
registerTranslations(researchEntries,researchPatterns);
registerTranslations(visualEntries,visualPatterns);
observeTranslations();
bindLanguageSelectors();
