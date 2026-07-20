import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enActions from './locales/en/actions.json' with { type: 'json' };
import enBattle from './locales/en/battle.json' with { type: 'json' };
import enBattlefield from './locales/en/battlefield.json' with { type: 'json' };
import enCampaign from './locales/en/campaign.json' with { type: 'json' };
import enCommon from './locales/en/common.json' with { type: 'json' };
import enErrors from './locales/en/errors.json' with { type: 'json' };
import enHq from './locales/en/hq.json' with { type: 'json' };
import enLog from './locales/en/log.json' with { type: 'json' };
import enMainmenu from './locales/en/mainmenu.json' with { type: 'json' };
import enResearch from './locales/en/research.json' with { type: 'json' };
import enScenarios from './locales/en/scenarios.json' with { type: 'json' };
import enTerritories from './locales/en/territories.json' with { type: 'json' };
import enUnits from './locales/en/units.json' with { type: 'json' };
import skActions from './locales/sk/actions.json' with { type: 'json' };
import skBattle from './locales/sk/battle.json' with { type: 'json' };
import skBattlefield from './locales/sk/battlefield.json' with { type: 'json' };
import skCampaign from './locales/sk/campaign.json' with { type: 'json' };
import skCommon from './locales/sk/common.json' with { type: 'json' };
import skErrors from './locales/sk/errors.json' with { type: 'json' };
import skHq from './locales/sk/hq.json' with { type: 'json' };
import skLog from './locales/sk/log.json' with { type: 'json' };
import skMainmenu from './locales/sk/mainmenu.json' with { type: 'json' };
import skResearch from './locales/sk/research.json' with { type: 'json' };
import skScenarios from './locales/sk/scenarios.json' with { type: 'json' };
import skTerritories from './locales/sk/territories.json' with { type: 'json' };
import skUnits from './locales/sk/units.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'sk'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
const LANGUAGE_STORAGE_KEY = 'spellcross:lang';

function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'en' || stored === 'sk') return stored;
  const nav = window.navigator?.language?.toLowerCase() ?? '';
  return nav.startsWith('sk') ? 'sk' : 'en';
}

export function setAppLanguage(lang: SupportedLanguage) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'mainmenu', 'hq', 'battle', 'battlefield', 'log', 'campaign', 'units', 'research', 'territories', 'scenarios', 'actions', 'errors'],
  resources: {
    en: {
      common: enCommon, mainmenu: enMainmenu, hq: enHq, battle: enBattle, battlefield: enBattlefield,
      log: enLog, campaign: enCampaign, units: enUnits, research: enResearch, territories: enTerritories, scenarios: enScenarios,
      actions: enActions, errors: enErrors
    },
    sk: {
      common: skCommon, mainmenu: skMainmenu, hq: skHq, battle: skBattle, battlefield: skBattlefield,
      log: skLog, campaign: skCampaign, units: skUnits, research: skResearch, territories: skTerritories, scenarios: skScenarios,
      actions: skActions, errors: skErrors
    }
  },
  interpolation: { escapeValue: false },
  returnNull: false,
  // A missing key otherwise renders as the raw key with no trace in the console;
  // saveMissing must be on for i18next to invoke the handler at all.
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (_lngs, ns, key) => {
    console.warn(`Missing translation: ${ns}:${key}`);
  }
});

export default i18n;
