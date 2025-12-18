import * as PIXI from 'pixi.js';

export interface TileAtlasEntry {
  id: string;
  texture: PIXI.Texture;
}

const TILE_SIZE = 64;
const COLS = 24;

const texture = PIXI.Texture.from('/textures.png');

function region(idx: number): PIXI.Texture {
  const x = (idx % COLS) * TILE_SIZE;
  const y = Math.floor(idx / COLS) * TILE_SIZE;
  return new PIXI.Texture(texture.baseTexture, new PIXI.Rectangle(x, y, TILE_SIZE, TILE_SIZE));
}

// These indices are approximations; adjust if art mapping differs.
export const tileAtlas: Record<string, PIXI.Texture> = {
  plain: region(25),
  road: region(31),
  forest: region(27),
  urban: region(30),
  hill: region(28),
  water: region(26),
  swamp: region(34),
  structure: region(33)
};
