import { starterUnits } from '@spellcross/data';
import { createCanvas, loadImage } from 'canvas';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SHARED_UNIT_PORTRAIT_VARIANTS,
  battlefieldDirectionalSprite,
  deathMarkerVisualClass,
  leavesMechanicalWreck,
  rasterUnitOverride,
  unitPortrait,
  unitVisualHeight,
  vehicleRunningGearKind
} from './unitVisuals.js';

const portraitFor = (definitionId: string) => {
  const definition = starterUnits.find((unit) => unit.id === definitionId);
  if (!definition) throw new Error(`Unknown unit definition: ${definitionId}`);
  return unitPortrait(definition.type, definition.id, definition.faction === 'alliance');
};

describe('unit portraits', () => {
  it('uses distinct family art for the reported infantry cards', () => {
    expect(portraitFor('light-infantry')).toBe('/assets/generated/light_infantry_idle_s.png');
    expect(portraitFor('heavy-infantry')).toBe('/assets/generated/heavy_infantry_portrait.png');
    expect(portraitFor('rangers')).toBe('/assets/generated/rangers_portrait.png');
    expect(portraitFor('light-infantry')).not.toBe(portraitFor('heavy-infantry'));
  });

  it('resolves every canonical unit to a shipped portrait asset', () => {
    for (const definition of starterUnits) {
      const portrait = unitPortrait(
        definition.type,
        definition.id,
        definition.faction === 'alliance'
      );
      expect(
        existsSync(path.resolve(process.cwd(), 'public', portrait.slice(1))),
        `${definition.id} resolves to missing ${portrait}`
      ).toBe(true);
    }
  });

  it('gives every advanced Alliance vehicle its own full-resolution portrait', async () => {
    const expectedPortraits = {
      'gepard-aa': '/assets/generated/gepard_aa_portrait.png',
      'leopard-2': '/assets/generated/leopard_2_portrait.png',
      'paladin-acs': '/assets/generated/paladin_acs_portrait.png',
      'sky-lance': '/assets/generated/sky_lance_portrait.png',
      'spg-m109': '/assets/generated/spg_m109_portrait.png'
    };
    const pixelSignatures = new Set<string>();
    const canvas = createCanvas(256, 256);
    const ctx = canvas.getContext('2d');

    for (const [definitionId, portrait] of Object.entries(expectedPortraits)) {
      expect(portraitFor(definitionId)).toBe(portrait);
      const image = await loadImage(path.resolve(process.cwd(), 'public', portrait.slice(1)));
      expect(image.width, definitionId).toBe(256);
      expect(image.height, definitionId).toBe(256);
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(image, 0, 0);
      pixelSignatures.add(Buffer.from(ctx.getImageData(0, 0, 256, 256).data).toString('base64'));
    }

    expect(pixelSignatures.size).toBe(Object.keys(expectedPortraits).length);
  });

  it('rejects new shared portraits outside the explicit vehicle-family debt', () => {
    const definitionsByPortrait = new Map<string, string[]>();
    for (const definition of starterUnits) {
      const portrait = unitPortrait(
        definition.type,
        definition.id,
        definition.faction === 'alliance'
      );
      const definitions = definitionsByPortrait.get(portrait) ?? [];
      definitions.push(definition.id);
      definitionsByPortrait.set(portrait, definitions);
    }

    const duplicateGroups = [...definitionsByPortrait.values()]
      .filter((definitions) => definitions.length > 1)
      .map((definitions) => definitions.sort())
      .sort((a, b) => a[0].localeCompare(b[0]));
    const allowedGroups = SHARED_UNIT_PORTRAIT_VARIANTS
      .map((definitions) => [...definitions].sort())
      .sort((a, b) => a[0].localeCompare(b[0]));

    expect(duplicateGroups).toEqual(allowedGroups);
  });

  it('routes the Ogre through its creature art instead of the APC renderer', () => {
    expect(rasterUnitOverride('ogre-brute')).toBe('/assets/generated/ogre_brute.png');
    expect(portraitFor('ogre-brute')).toBe('/assets/generated/ogre_brute.png');
    expect(battlefieldDirectionalSprite('vehicle', 'ogre-brute')).toBeUndefined();
  });

  it('keeps the Ogre larger than infantry without turning it into a machine', () => {
    const tileSize = 56;
    expect(unitVisualHeight(tileSize, 'vehicle', 'ogre-brute')).toBe(tileSize * 0.74);
    expect(unitVisualHeight(tileSize, 'vehicle', 'ogre-brute'))
      .toBeGreaterThan(unitVisualHeight(tileSize, 'infantry', 'war-orc'));
    expect(vehicleRunningGearKind('vehicle', 'ogre-brute')).toBeNull();
    expect(leavesMechanicalWreck('vehicle', 'ogre-brute')).toBe(false);
    expect(deathMarkerVisualClass('vehicle', 'ogre-brute')).toBe('heavy');
  });
});
