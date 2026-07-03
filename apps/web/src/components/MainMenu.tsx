import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setAppLanguage, SUPPORTED_LANGUAGES } from '../i18n/index.js';

export interface SaveSlot {
  slot: number;
  turn: number;
  money: number;
  research: number;
  strategic: number;
  territories: number;
  updated: number;
  activeBattle: boolean;
}

interface MainMenuProps {
  onNewGame: (slot: number) => void;
  onContinue: (slot: number) => void;
  savedSlots: (SaveSlot | null)[];
  currentSlot: number;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  onNewGame,
  onContinue,
  savedSlots,
  currentSlot,
}) => {
  const { t, i18n } = useTranslation('mainmenu');
  const [selectedSlot, setSelectedSlot] = useState(currentSlot);
  const [showSlots, setShowSlots] = useState(false);

  const hasAnySave = savedSlots.some(s => s !== null);
  const currentSave = savedSlots[currentSlot - 1];
  const activeSlots = savedSlots.filter(Boolean).length;

  return (
    <div className="main-menu">
      <div className="menu-backdrop" />
      <div className="menu-lang-switch">
        {SUPPORTED_LANGUAGES.map(lang => (
          <button
            key={lang}
            className={`menu-lang-btn ${i18n.language === lang ? 'active' : ''}`}
            onClick={() => setAppLanguage(lang)}
          >
            {t(`language.${lang}`)}
          </button>
        ))}
      </div>
      <div className="menu-container">
        <div className="menu-logo">
          <h1>{t('title')}</h1>
          <p className="menu-subtitle">{t('subtitle')}</p>
        </div>

        <div className="menu-intel-panel">
          <span>{t('intel.campaignLink')}</span>
          <strong>{hasAnySave ? t('intel.slotReady', { slot: currentSlot }) : t('intel.noActiveCampaign')}</strong>
          <small>
            {currentSave
              ? t('intel.statusLine', {
                  turn: currentSave.turn,
                  territories: currentSave.territories,
                  battleStatus: currentSave.activeBattle ? t('intel.battlePending') : t('intel.fieldHq'),
                })
              : t('intel.savedSlotsDetected', { count: activeSlots })}
          </small>
        </div>

        <div className="menu-buttons">
          {hasAnySave && (
            <button 
              className="menu-btn menu-btn-primary"
              onClick={() => onContinue(currentSlot)}
            >
              <span className="btn-icon">▶</span>
              {t('buttons.continue')}
              {savedSlots[currentSlot - 1] && (
                <span className="btn-detail">{t('buttons.turnDetail', { turn: savedSlots[currentSlot - 1]!.turn })}</span>
              )}
            </button>
          )}

          <button
            className="menu-btn"
            onClick={() => setShowSlots(true)}
          >
            <span className="btn-icon">📋</span>
            {hasAnySave ? t('buttons.loadGame') : t('buttons.newGame')}
          </button>

          <button className="menu-btn" disabled>
            <span className="btn-icon">⚙</span>
            {t('buttons.settings')}
          </button>

          <button className="menu-btn" disabled>
            <span className="btn-icon">📖</span>
            {t('buttons.manual')}
          </button>
        </div>

        <div className="menu-footer">
          <p>{t('footer.copyright')}</p>
          <p className="version">{t('footer.version')}</p>
        </div>
      </div>

      {showSlots && (
        <div className="slot-modal">
          <div className="slot-modal-content">
            <h2>{t('slotModal.title')}</h2>
            <div className="slot-list">
              {[1, 2, 3].map((slotNum) => {
                const save = savedSlots[slotNum - 1];
                return (
                  <button
                    key={slotNum}
                    className={`slot-item ${selectedSlot === slotNum ? 'selected' : ''}`}
                    onClick={() => setSelectedSlot(slotNum)}
                  >
                    <span className="slot-number">{t('slotModal.slotLabel', { slot: slotNum })}</span>
                    {save ? (
                      <div className="slot-info">
                        <span>{t('slotModal.turnLabel', { turn: save.turn })}</span>
                        <span>{t('slotModal.moneyLine', { money: save.money, territories: save.territories })}</span>
                        <span className="slot-date">{new Date(save.updated).toLocaleDateString(i18n.language)}</span>
                      </div>
                    ) : (
                      <span className="slot-empty">{t('slotModal.empty')}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="slot-actions">
              <button
                className="menu-btn menu-btn-primary"
                onClick={() => {
                  const save = savedSlots[selectedSlot - 1];
                  if (save) {
                    onContinue(selectedSlot);
                  } else {
                    onNewGame(selectedSlot);
                  }
                }}
              >
                {savedSlots[selectedSlot - 1] ? t('slotModal.load') : t('slotModal.newGame')}
              </button>
              <button
                className="menu-btn menu-btn-secondary"
                onClick={() => setShowSlots(false)}
              >
                {t('slotModal.back')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
