import type { CampaignDifficulty } from '@spellcross/core';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setAppLanguage, SUPPORTED_LANGUAGES } from '../i18n/index.js';
import { AudioManager } from '../services/AudioManager.js';

export interface SaveSlot {
  slot: number;
  difficulty: CampaignDifficulty;
  turn: number;
  money: number;
  research: number;
  strategic: number;
  territories: number;
  updated: number;
  activeBattle: boolean;
}

interface MainMenuProps {
  onNewGame: (slot: number, difficulty: CampaignDifficulty) => void;
  onContinue: (slot: number) => void;
  onDeleteSave: (slot: number) => void;
  savedSlots: (SaveSlot | null)[];
  currentSlot: number;
  persistenceWarning?: React.ReactNode;
}

interface AudioPreferences {
  enabled: boolean;
  master: number;
  effects: number;
  ambience: number;
}

type MenuPanel = 'slots' | 'settings' | 'manual';

const AUDIO_PREFERENCES_KEY = 'spellcross:audio';
const CAMPAIGN_DIFFICULTIES = ['story', 'commander', 'veteran'] as const;
const MODAL_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  enabled: true,
  master: 0.7,
  effects: 0.8,
  ambience: 0.5,
};

function loadAudioPreferences(): AudioPreferences {
  if (typeof window === 'undefined') return DEFAULT_AUDIO_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(AUDIO_PREFERENCES_KEY);
    if (!stored) return DEFAULT_AUDIO_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<AudioPreferences>;
    return {
      enabled: parsed.enabled ?? DEFAULT_AUDIO_PREFERENCES.enabled,
      master: typeof parsed.master === 'number' ? parsed.master : DEFAULT_AUDIO_PREFERENCES.master,
      effects: typeof parsed.effects === 'number' ? parsed.effects : DEFAULT_AUDIO_PREFERENCES.effects,
      ambience: typeof parsed.ambience === 'number' ? parsed.ambience : DEFAULT_AUDIO_PREFERENCES.ambience,
    };
  } catch {
    return DEFAULT_AUDIO_PREFERENCES;
  }
}

export const MainMenu: React.FC<MainMenuProps> = ({
  onNewGame,
  onContinue,
  onDeleteSave,
  savedSlots,
  currentSlot,
  persistenceWarning,
}) => {
  const { t, i18n } = useTranslation('mainmenu');
  const [selectedSlot, setSelectedSlot] = useState(currentSlot);
  const [selectedDifficulty, setSelectedDifficulty] = useState<CampaignDifficulty>('commander');
  const [pendingDeleteSlot, setPendingDeleteSlot] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<MenuPanel | null>(null);
  const [audioPreferences, setAudioPreferences] = useState(loadAudioPreferences);
  const activeDialogRef = useRef<HTMLDivElement>(null);
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const deleteFocusTargetRef = useRef<'delete' | 'slot' | null>(null);

  useEffect(() => {
    AudioManager.setEnabled(audioPreferences.enabled);
    AudioManager.setMasterVolume(audioPreferences.master);
    AudioManager.setSfxVolume(audioPreferences.effects);
    AudioManager.setMusicVolume(audioPreferences.ambience);
  }, [audioPreferences]);

  useEffect(() => {
    if (!activePanel) return;
    const dialog = activeDialogRef.current;
    if (!dialog) return;

    const focusableControls = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
    );
    focusableControls()[0]?.focus();

    const handlePanelKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setActivePanel(null);
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = focusableControls();
      const firstControl = controls[0];
      const lastControl = controls.at(-1);
      if (!firstControl || !lastControl) return;

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstControl || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && (activeElement === lastControl || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstControl.focus();
      }
    };
    window.addEventListener('keydown', handlePanelKeyDown);
    return () => {
      window.removeEventListener('keydown', handlePanelKeyDown);
      if (panelTriggerRef.current?.isConnected) panelTriggerRef.current.focus();
      panelTriggerRef.current = null;
    };
  }, [activePanel]);

  useEffect(() => {
    if (pendingDeleteSlot !== null) {
      deleteConfirmRef.current?.focus();
      return;
    }

    if (deleteFocusTargetRef.current === 'delete') {
      activeDialogRef.current
        ?.querySelector<HTMLButtonElement>('.slot-actions > .menu-btn-danger')
        ?.focus();
    } else if (deleteFocusTargetRef.current === 'slot') {
      activeDialogRef.current
        ?.querySelectorAll<HTMLButtonElement>('.slot-item')[selectedSlot - 1]
        ?.focus();
    }
    deleteFocusTargetRef.current = null;
  }, [pendingDeleteSlot, selectedSlot]);

  const openPanel = (
    panel: MenuPanel,
    trigger: HTMLButtonElement,
  ) => {
    panelTriggerRef.current = trigger;
    setActivePanel(panel);
  };

  const updateAudioPreferences = (next: AudioPreferences) => {
    setAudioPreferences(next);
    window.localStorage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(next));
  };

  const handleDifficultyKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    difficulty: CampaignDifficulty,
  ) => {
    const currentIndex = CAMPAIGN_DIFFICULTIES.indexOf(difficulty);
    let nextIndex: number;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % CAMPAIGN_DIFFICULTIES.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + CAMPAIGN_DIFFICULTIES.length) % CAMPAIGN_DIFFICULTIES.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = CAMPAIGN_DIFFICULTIES.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setSelectedDifficulty(CAMPAIGN_DIFFICULTIES[nextIndex]);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]
      ?.focus();
  };

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

        {persistenceWarning ? <div className="persistence-warning-slot menu-persistence-slot">{persistenceWarning}</div> : null}

        <div className="menu-intel-panel">
          <span>{t('intel.campaignLink')}</span>
          <strong>{currentSave ? t('intel.slotReady', { slot: currentSlot }) : t('intel.noActiveCampaign')}</strong>
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
          {currentSave && (
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
            onClick={(event) => openPanel('slots', event.currentTarget)}
          >
            <span className="btn-icon">📋</span>
            {hasAnySave ? t('buttons.loadGame') : t('buttons.newGame')}
          </button>

          <button className="menu-btn" onClick={(event) => openPanel('settings', event.currentTarget)}>
            <span className="btn-icon">⚙</span>
            {t('buttons.settings')}
          </button>

          <button className="menu-btn" onClick={(event) => openPanel('manual', event.currentTarget)}>
            <span className="btn-icon">📖</span>
            {t('buttons.manual')}
          </button>
        </div>

        <div className="menu-footer">
          <p>{t('footer.copyright')}</p>
          <p className="version">{t('footer.version')}</p>
        </div>
      </div>

      {activePanel === 'slots' && (
        <div ref={activeDialogRef} className="slot-modal" role="dialog" aria-modal="true" aria-labelledby="slot-modal-title">
          <div className="slot-modal-content slot-campaign-content">
            <h2 id="slot-modal-title">{t('slotModal.title')}</h2>
            <div className="slot-list">
              {[1, 2, 3].map((slotNum) => {
                const save = savedSlots[slotNum - 1];
                return (
                  <button
                    key={slotNum}
                    className={`slot-item ${selectedSlot === slotNum ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedSlot(slotNum);
                      setPendingDeleteSlot(null);
                    }}
                  >
                    <span className="slot-number">{t('slotModal.slotLabel', { slot: slotNum })}</span>
                    {save ? (
                      <div className="slot-info">
                        <span>{t('slotModal.turnLabel', { turn: save.turn })}</span>
                        <span>{t('slotModal.moneyLine', { money: save.money, territories: save.territories })}</span>
                        <span className={`slot-difficulty ${save.difficulty}`}>{t(`difficulty.${save.difficulty}.name`)}</span>
                        <span className="slot-date">{new Date(save.updated).toLocaleDateString(i18n.language)}</span>
                      </div>
                    ) : (
                      <span className="slot-empty">{t('slotModal.empty')}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {!savedSlots[selectedSlot - 1] && (
              <div className="difficulty-select" role="radiogroup" aria-label={t('difficulty.heading')}>
                <div className="difficulty-heading">
                  <span>{t('difficulty.systemCode')}</span>
                  <h3>{t('difficulty.heading')}</h3>
                  <p>{t('difficulty.description')}</p>
                </div>
                <div className="difficulty-options">
                  {CAMPAIGN_DIFFICULTIES.map((difficulty) => (
                    <button
                      key={difficulty}
                      type="button"
                      role="radio"
                      aria-checked={selectedDifficulty === difficulty}
                      tabIndex={selectedDifficulty === difficulty ? 0 : -1}
                      className={`difficulty-option ${difficulty} ${selectedDifficulty === difficulty ? 'selected' : ''}`}
                      onClick={() => setSelectedDifficulty(difficulty)}
                      onKeyDown={(event) => handleDifficultyKeyDown(event, difficulty)}
                    >
                      <span>{t(`difficulty.${difficulty}.code`)}</span>
                      <strong>{t(`difficulty.${difficulty}.name`)}</strong>
                      <small>{t(`difficulty.${difficulty}.detail`)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="slot-actions">
              <button
                className="menu-btn menu-btn-primary"
                onClick={() => {
                  const save = savedSlots[selectedSlot - 1];
                  if (save) {
                    onContinue(selectedSlot);
                  } else {
                    onNewGame(selectedSlot, selectedDifficulty);
                  }
                }}
              >
                {savedSlots[selectedSlot - 1] ? t('slotModal.load') : t('slotModal.newGame')}
              </button>
              <button
                className="menu-btn menu-btn-secondary"
                onClick={() => setActivePanel(null)}
              >
                {t('slotModal.back')}
              </button>
              {savedSlots[selectedSlot - 1] && pendingDeleteSlot !== selectedSlot && (
                <button
                  className="menu-btn menu-btn-danger"
                  onClick={() => setPendingDeleteSlot(selectedSlot)}
                >
                  {t('slotModal.delete')}
                </button>
              )}
              {pendingDeleteSlot === selectedSlot && (
                <div className="slot-delete-confirm" role="alert">
                  <span>{t('slotModal.deleteWarning', { slot: selectedSlot })}</span>
                  <button
                    ref={deleteConfirmRef}
                    className="menu-btn menu-btn-danger"
                    onClick={() => {
                      deleteFocusTargetRef.current = 'slot';
                      onDeleteSave(selectedSlot);
                      setPendingDeleteSlot(null);
                    }}
                  >
                    {t('slotModal.confirmDelete')}
                  </button>
                  <button
                    className="menu-btn menu-btn-secondary"
                    onClick={() => {
                      deleteFocusTargetRef.current = 'delete';
                      setPendingDeleteSlot(null);
                    }}
                  >
                    {t('slotModal.cancel')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activePanel === 'settings' && (
        <div ref={activeDialogRef} className="slot-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
          <div className="slot-modal-content menu-modal-content">
            <button className="modal-close" aria-label={t('slotModal.back')} onClick={() => setActivePanel(null)}>×</button>
            <div className="menu-modal-heading">
              <span>{t('settings.systemCode')}</span>
              <h2 id="settings-modal-title">{t('settings.title')}</h2>
              <p>{t('settings.description')}</p>
            </div>
            <div className="audio-toggle">
              <label htmlFor="audio-enabled">
                <strong>{t('settings.audioEnabled')}</strong>
                <small>{t('settings.audioEnabledHint')}</small>
              </label>
              <input
                id="audio-enabled"
                type="checkbox"
                aria-label={t('settings.audioEnabled')}
                checked={audioPreferences.enabled}
                onChange={(event) => updateAudioPreferences({ ...audioPreferences, enabled: event.target.checked })}
              />
            </div>
            <div className={`audio-settings ${audioPreferences.enabled ? '' : 'disabled'}`}>
              {([
                ['master', 'settings.masterVolume'],
                ['effects', 'settings.effectsVolume'],
                ['ambience', 'settings.ambienceVolume'],
              ] as const).map(([field, label]) => (
                <label key={field} className="audio-range">
                  <span>{t(label)} <b>{Math.round(audioPreferences[field] * 100)}%</b></span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(audioPreferences[field] * 100)}
                    disabled={!audioPreferences.enabled}
                    onChange={(event) => updateAudioPreferences({
                      ...audioPreferences,
                      [field]: Number(event.target.value) / 100,
                    })}
                  />
                </label>
              ))}
            </div>
            <button className="menu-btn menu-btn-secondary modal-back" onClick={() => setActivePanel(null)}>
              {t('slotModal.back')}
            </button>
          </div>
        </div>
      )}

      {activePanel === 'manual' && (
        <div ref={activeDialogRef} className="slot-modal" role="dialog" aria-modal="true" aria-labelledby="manual-modal-title">
          <div className="slot-modal-content menu-modal-content manual-content">
            <button className="modal-close" aria-label={t('slotModal.back')} onClick={() => setActivePanel(null)}>×</button>
            <div className="menu-modal-heading">
              <span>{t('manual.fieldGuide')}</span>
              <h2 id="manual-modal-title">{t('manual.title')}</h2>
              <p>{t('manual.intro')}</p>
            </div>
            <div className="manual-sections">
              {(['campaign', 'battle', 'controls', 'survival'] as const).map((section) => (
                <section key={section}>
                  <span>{t(`manual.sections.${section}.code`)}</span>
                  <h3>{t(`manual.sections.${section}.title`)}</h3>
                  <ul>
                    {([0, 1, 2] as const).map((line) => (
                      <li key={line}>{t(`manual.sections.${section}.lines.${line}`)}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <button className="menu-btn menu-btn-secondary modal-back" onClick={() => setActivePanel(null)}>
              {t('slotModal.back')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
