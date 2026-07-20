import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainMenu } from './MainMenu.js';
import i18n from '../i18n/index.js';

describe('MainMenu', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onNewGame = vi.fn();
  const onDeleteSave = vi.fn();

  beforeEach(async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class {},
    });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    onNewGame.mockReset();
    onDeleteSave.mockReset();
    await i18n.changeLanguage('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <MainMenu
          onNewGame={onNewGame}
          onContinue={() => {}}
          onDeleteSave={onDeleteSave}
          savedSlots={[null, null, null]}
          currentSlot={1}
        />
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const clickButton = (label: string) => {
    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes(label));
    expect(button).toBeDefined();
    act(() => button!.click());
  };

  it('opens the audio settings and persists changes', () => {
    clickButton('Settings');
    expect(container.textContent).toContain('Master output');

    const enabled = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(enabled).not.toBeNull();
    act(() => enabled!.click());

    expect(JSON.parse(window.localStorage.getItem('spellcross:audio') ?? '{}')).toMatchObject({ enabled: false });
  });

  it('opens the commander manual from the main menu', () => {
    clickButton('Manual');
    expect(container.textContent).toContain('Run the campaign');
    expect(container.textContent).toContain('Fight the battle');
    expect(container.querySelectorAll('.manual-sections section')).toHaveLength(4);

    const closeButton = container.querySelector<HTMLButtonElement>('.modal-close');
    expect(closeButton).not.toBeNull();
    act(() => closeButton!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('starts an empty slot with the selected campaign difficulty', () => {
    clickButton('New Game');
    const commander = container.querySelector<HTMLButtonElement>('.difficulty-option.commander');
    const veteran = container.querySelector<HTMLButtonElement>('.difficulty-option.veteran');
    expect(commander?.getAttribute('aria-checked')).toBe('true');
    expect(veteran).not.toBeNull();

    act(() => veteran!.click());
    const launch = container.querySelector<HTMLButtonElement>('.slot-actions .menu-btn-primary');
    expect(launch).not.toBeNull();
    act(() => launch!.click());

    expect(onNewGame).toHaveBeenCalledWith(1, 'veteran');
  });

  it('requires confirmation before deleting an occupied slot', async () => {
    await act(async () => {
      root.render(
        <MainMenu
          onNewGame={onNewGame}
          onContinue={() => {}}
          onDeleteSave={onDeleteSave}
          savedSlots={[{
            slot: 1,
            difficulty: 'commander',
            turn: 4,
            money: 120,
            research: 30,
            strategic: 10,
            territories: 5,
            updated: Date.now(),
            activeBattle: false,
          }, null, null]}
          currentSlot={1}
        />
      );
    });

    clickButton('Load Game');
    clickButton('Delete');
    expect(onDeleteSave).not.toHaveBeenCalled();
    clickButton('Confirm delete');
    expect(onDeleteSave).toHaveBeenCalledWith(1);
  });
});
