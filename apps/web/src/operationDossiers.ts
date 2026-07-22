import type { OperationAudioTheme, OperationDossier } from '@spellcross/data';

import i18n from './i18n/index.js';

export interface LocalizedOperationDossier {
  territoryId: string;
  chapter: number | null;
  chapterTitle: string;
  codename: string;
  situation: string;
  threat: string;
  command: string;
  victory: string;
  defeat: string;
  audioTheme: OperationAudioTheme;
}

export function localizeOperationDossier(
  dossier: OperationDossier | undefined,
  territoryId: string,
  territoryBrief: string
): LocalizedOperationDossier {
  if (!dossier) {
    return {
      territoryId,
      chapter: null,
      chapterTitle: i18n.t('dossiers:fallback.chapter'),
      codename: i18n.t('dossiers:fallback.codename'),
      situation: territoryBrief,
      threat: i18n.t('dossiers:fallback.threat'),
      command: i18n.t('dossiers:fallback.command'),
      victory: i18n.t('dossiers:fallback.victory'),
      defeat: i18n.t('dossiers:fallback.defeat'),
      audioTheme: 'frontline'
    };
  }

  const key = `dossiers:${dossier.territoryId}`;
  return {
    territoryId: dossier.territoryId,
    chapter: dossier.chapter,
    chapterTitle: i18n.t(`${key}.chapterTitle`, { defaultValue: dossier.chapterTitle }),
    codename: i18n.t(`${key}.codename`, { defaultValue: dossier.codename }),
    situation: i18n.t(`${key}.situation`, { defaultValue: dossier.situation }),
    threat: i18n.t(`${key}.threat`, { defaultValue: dossier.threat }),
    command: i18n.t(`${key}.command`, { defaultValue: dossier.command }),
    victory: i18n.t(`${key}.victory`, { defaultValue: dossier.victory }),
    defeat: i18n.t(`${key}.defeat`, { defaultValue: dossier.defeat }),
    audioTheme: dossier.audioTheme
  };
}
