import React, { useState, useEffect } from 'react';

interface SaveSlot {
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
  const [selectedSlot, setSelectedSlot] = useState(currentSlot);
  const [showSlots, setShowSlots] = useState(false);

  const hasAnySave = savedSlots.some(s => s !== null);

  return (
    <div className="main-menu">
      <div className="menu-backdrop" />
      <div className="menu-container">
        <div className="menu-logo">
          <h1>SPELLCROSS</h1>
          <p className="menu-subtitle">THE LAST BATTLE</p>
        </div>

        <div className="menu-buttons">
          {hasAnySave && (
            <button 
              className="menu-btn menu-btn-primary"
              onClick={() => onContinue(currentSlot)}
            >
              <span className="btn-icon">▶</span>
              CONTINUE
              {savedSlots[currentSlot - 1] && (
                <span className="btn-detail">Turn {savedSlots[currentSlot - 1]!.turn}</span>
              )}
            </button>
          )}

          <button 
            className="menu-btn"
            onClick={() => setShowSlots(true)}
          >
            <span className="btn-icon">📋</span>
            {hasAnySave ? 'LOAD GAME' : 'NEW GAME'}
          </button>

          <button className="menu-btn" disabled>
            <span className="btn-icon">⚙</span>
            SETTINGS
          </button>

          <button className="menu-btn" disabled>
            <span className="btn-icon">📖</span>
            MANUAL
          </button>
        </div>

        <div className="menu-footer">
          <p>Spellcross Remake © 2025</p>
          <p className="version">v0.1.0 Alpha</p>
        </div>
      </div>

      {showSlots && (
        <div className="slot-modal">
          <div className="slot-modal-content">
            <h2>SELECT SLOT</h2>
            <div className="slot-list">
              {[1, 2, 3].map((slotNum) => {
                const save = savedSlots[slotNum - 1];
                return (
                  <button
                    key={slotNum}
                    className={`slot-item ${selectedSlot === slotNum ? 'selected' : ''}`}
                    onClick={() => setSelectedSlot(slotNum)}
                  >
                    <span className="slot-number">Slot {slotNum}</span>
                    {save ? (
                      <div className="slot-info">
                        <span>Turn {save.turn}</span>
                        <span>${save.money} | {save.territories} territories</span>
                        <span className="slot-date">{new Date(save.updated).toLocaleDateString()}</span>
                      </div>
                    ) : (
                      <span className="slot-empty">- Empty -</span>
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
                {savedSlots[selectedSlot - 1] ? 'LOAD' : 'NEW GAME'}
              </button>
              <button 
                className="menu-btn menu-btn-secondary"
                onClick={() => setShowSlots(false)}
              >
                BACK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

