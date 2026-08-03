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

  it('contains modal focus and returns it to the opening control', () => {
    const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    const settings = buttons().find(button => button.textContent?.includes('Settings'))!;
    settings.focus();
    act(() => settings.click());

    let dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const settingsClose = dialog.querySelector<HTMLButtonElement>('.modal-close')!;
    const settingsBack = dialog.querySelector<HTMLButtonElement>('.modal-back')!;
    expect(document.activeElement).toBe(settingsClose);

    settingsBack.focus();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    expect(document.activeElement).toBe(settingsClose);

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(settings);

    const manual = buttons().find(button => button.textContent?.includes('Manual'))!;
    act(() => manual.click());
    dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const manualClose = dialog.querySelector<HTMLButtonElement>('.modal-close')!;
    expect(document.activeElement).toBe(manualClose);
    act(() => manualClose.click());
    expect(document.activeElement).toBe(manual);

    const newGame = buttons().find(button => button.textContent?.includes('New Game'))!;
    act(() => newGame.click());
    dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const firstSlot = dialog.querySelector<HTMLButtonElement>('.slot-item')!;
    const slotBack = dialog.querySelector<HTMLButtonElement>('.slot-actions .menu-btn-secondary')!;
    expect(document.activeElement).toBe(firstSlot);

    slotBack.focus();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    expect(document.activeElement).toBe(firstSlot);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.activeElement).toBe(newGame);
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

  it('uses arrow keys and a single tab stop for campaign difficulty', () => {
    clickButton('New Game');
    const story = container.querySelector<HTMLButtonElement>('.difficulty-option.story')!;
    const commander = container.querySelector<HTMLButtonElement>('.difficulty-option.commander')!;
    const veteran = container.querySelector<HTMLButtonElement>('.difficulty-option.veteran')!;

    expect([story, commander, veteran].filter(option => option.tabIndex === 0)).toEqual([commander]);
    commander.focus();

    act(() => commander.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(veteran.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(veteran);
    expect([story, commander, veteran].filter(option => option.tabIndex === 0)).toEqual([veteran]);

    act(() => veteran.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(story.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(story);

    act(() => story.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(veteran.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(veteran);
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
    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Delete'))!;
    act(() => deleteButton.click());
    expect(onDeleteSave).not.toHaveBeenCalled();
    const confirmDelete = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Confirm delete'))!;
    const cancelDelete = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Cancel'))!;
    expect(document.activeElement).toBe(confirmDelete);

    act(() => cancelDelete.click());
    const restoredDelete = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Delete'))!;
    expect(document.activeElement).toBe(restoredDelete);
    act(() => restoredDelete.click());
    const restoredConfirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Confirm delete'))!;
    expect(document.activeElement).toBe(restoredConfirm);
    act(() => restoredConfirm.click());
    expect(onDeleteSave).toHaveBeenCalledWith(1);
    expect(document.activeElement).toBe(container.querySelector('.slot-item'));
  });
});
