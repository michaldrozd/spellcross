#!/usr/bin/env node
/**
 * Generate Spellcross-style isometric terrain tiles
 * Run with: node scripts/generateTiles.js
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

const W = 128, H = 64;

// Seeded random for consistent results
const seed = (s) => () => { s = Math.sin(s) * 10000; return s - Math.floor(s); };

function drawTile(ctx, baseColors, opts = {}) {
  const { grass, trees, road, water, cobbles, rubble } = opts;
  const rnd = seed(42);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(W/2, 0); ctx.lineTo(W, H/2); ctx.lineTo(W/2, H); ctx.lineTo(0, H/2);
  ctx.closePath();
  ctx.clip();

  // Base gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, baseColors[0]);
  grad.addColorStop(1, baseColors[1] || baseColors[0]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Noise texture
  for (let i = 0; i < 300; i++) {
    const x = rnd() * W, y = rnd() * H;
    const a = rnd() * 0.15;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Grass tufts
  if (grass) {
    for (let i = 0; i < 25; i++) {
      const x = rnd() * W, y = rnd() * H;
      const g = 60 + rnd() * 80;
      ctx.fillStyle = `rgb(30,${g},20)`;
      ctx.fillRect(x, y, 3, 1);
      ctx.fillRect(x+1, y-1, 1, 3);
    }
  }

  // Small trees/bushes for forest
  if (trees) {
    for (let i = 0; i < 3; i++) {
      const cx = 20 + rnd() * (W-40), cy = 15 + rnd() * (H-30);
      ctx.fillStyle = `rgb(${20+rnd()*20},${50+rnd()*40},${15+rnd()*15})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 8+rnd()*6, 6+rnd()*4, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = `rgb(${30+rnd()*20},${70+rnd()*50},${20+rnd()*20})`;
      ctx.beginPath();
      ctx.ellipse(cx-2, cy-2, 5+rnd()*4, 4+rnd()*3, 0, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Road surface
  if (road) {
    ctx.fillStyle = 'rgba(60,55,50,0.6)';
    ctx.beginPath();
    ctx.moveTo(W/2-20, 0); ctx.lineTo(W/2+20, 0);
    ctx.lineTo(W/2+10, H); ctx.lineTo(W/2-10, H);
    ctx.closePath(); ctx.fill();
    // Dashed line
    ctx.strokeStyle = 'rgba(255,255,200,0.3)';
    ctx.setLineDash([4,8]);
    ctx.beginPath(); ctx.moveTo(W/2, 5); ctx.lineTo(W/2, H-5); ctx.stroke();
  }

  // Water ripples
  if (water) {
    ctx.strokeStyle = 'rgba(100,150,200,0.4)';
    for (let i = 0; i < 4; i++) {
      const y = 10 + i * 15;
      ctx.beginPath();
      ctx.moveTo(10, y); ctx.quadraticCurveTo(W/2, y + 5, W-10, y);
      ctx.stroke();
    }
  }

  // Cobblestones for urban
  if (cobbles) {
    ctx.fillStyle = 'rgba(80,75,70,0.5)';
    for (let i = 0; i < 20; i++) {
      const x = rnd() * W, y = rnd() * H;
      ctx.fillRect(x, y, 6+rnd()*4, 4+rnd()*3);
    }
  }

  // Rubble for structure
  if (rubble) {
    for (let i = 0; i < 10; i++) {
      const x = rnd() * W, y = rnd() * H;
      const c = 60 + rnd() * 40;
      ctx.fillStyle = `rgb(${c},${c-10},${c-20})`;
      ctx.fillRect(x, y, 8+rnd()*8, 5+rnd()*5);
    }
  }

  ctx.restore();

  // Border
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W/2, 0); ctx.lineTo(W, H/2); ctx.lineTo(W/2, H); ctx.lineTo(0, H/2);
  ctx.closePath(); ctx.stroke();
}

const tiles = {
  plain:  { colors: ['#5a9a4a','#4a8a3a'], opts: { grass: true } },
  forest: { colors: ['#3a6a2a','#2a5a1a'], opts: { grass: true, trees: true } },
  road:   { colors: ['#6a6a5a','#5a5a4a'], opts: { road: true } },
  urban:  { colors: ['#8a8070','#7a7060'], opts: { cobbles: true } },
  water:  { colors: ['#3a5a8a','#2a4a7a'], opts: { water: true } },
  swamp:  { colors: ['#4a6a3a','#3a5a2a'], opts: { grass: true, water: true } },
  hill:   { colors: ['#7a9a5a','#6a8a4a'], opts: { grass: true } },
  structure: { colors: ['#6a6060','#5a5050'], opts: { rubble: true } },
};

const outDir = path.join(process.cwd(), 'apps/web/public/textures/terrain');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, cfg] of Object.entries(tiles)) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  drawTile(ctx, cfg.colors, cfg.opts);
  fs.writeFileSync(path.join(outDir, `${name}.png`), canvas.toBuffer('image/png'));
  console.log(`✓ ${name}.png`);
}
console.log('Done!');

