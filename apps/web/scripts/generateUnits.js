#!/usr/bin/env node
/**
 * Generate Spellcross-style unit sprites
 * Run with: node scripts/generateUnits.js
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

const W = 64, H = 64;
const seed = (s) => () => { s = Math.sin(s) * 10000; return s - Math.floor(s); };

// Draw infantry soldier (isometric)
function drawInfantry(ctx, colors, isEnemy = false) {
  const { body, helmet, weapon } = colors;
  const rnd = seed(isEnemy ? 99 : 42);
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 8, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Body
  ctx.fillStyle = body;
  ctx.fillRect(W/2 - 6, H - 40, 12, 25);
  
  // Legs
  ctx.fillRect(W/2 - 6, H - 18, 5, 12);
  ctx.fillRect(W/2 + 1, H - 18, 5, 12);
  
  // Helmet
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.ellipse(W/2, H - 45, 7, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Weapon (rifle)
  ctx.fillStyle = weapon;
  ctx.save();
  ctx.translate(W/2 + 8, H - 35);
  ctx.rotate(-0.3);
  ctx.fillRect(0, 0, 4, 20);
  ctx.restore();
  
  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(W/2 - 4, H - 38, 4, 10);
}

// Draw tank/vehicle (isometric)
function drawTank(ctx, colors, isEnemy = false) {
  const { hull, turret, tracks } = colors;
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 6, 22, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Tracks
  ctx.fillStyle = tracks;
  ctx.fillRect(W/2 - 22, H - 22, 8, 18);
  ctx.fillRect(W/2 + 14, H - 22, 8, 18);
  
  // Hull (isometric box)
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(W/2 - 18, H - 20);
  ctx.lineTo(W/2, H - 30);
  ctx.lineTo(W/2 + 18, H - 20);
  ctx.lineTo(W/2, H - 10);
  ctx.closePath();
  ctx.fill();
  
  // Hull top
  ctx.fillStyle = shadeColor(hull, 20);
  ctx.beginPath();
  ctx.moveTo(W/2 - 14, H - 28);
  ctx.lineTo(W/2, H - 35);
  ctx.lineTo(W/2 + 14, H - 28);
  ctx.lineTo(W/2, H - 22);
  ctx.closePath();
  ctx.fill();
  
  // Turret
  ctx.fillStyle = turret;
  ctx.beginPath();
  ctx.ellipse(W/2, H - 32, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Gun barrel
  ctx.fillRect(W/2, H - 34, 18, 3);
}

// Draw skeleton/undead
function drawSkeleton(ctx) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 8, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Bones (off-white)
  const bone = '#e8e0d0';
  
  // Ribcage/body
  ctx.fillStyle = bone;
  ctx.fillRect(W/2 - 5, H - 38, 10, 20);
  
  // Ribs detail
  ctx.fillStyle = '#555';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(W/2 - 4, H - 36 + i * 4, 8, 1);
  }
  
  // Legs
  ctx.fillStyle = bone;
  ctx.fillRect(W/2 - 5, H - 18, 3, 12);
  ctx.fillRect(W/2 + 2, H - 18, 3, 12);
  
  // Skull
  ctx.beginPath();
  ctx.ellipse(W/2, H - 43, 6, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Eye sockets
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.ellipse(W/2 - 2, H - 44, 2, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(W/2 + 2, H - 44, 2, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Weapon (sword)
  ctx.fillStyle = '#888';
  ctx.save();
  ctx.translate(W/2 + 8, H - 35);
  ctx.rotate(-0.4);
  ctx.fillRect(0, 0, 3, 22);
  ctx.fillStyle = '#666';
  ctx.fillRect(-2, 20, 7, 4);
  ctx.restore();
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return `rgb(${R},${G},${B})`;
}

const units = {
  'infantry_ally': { draw: drawInfantry, colors: { body: '#3a5a3a', helmet: '#4a6a4a', weapon: '#333' } },
  'infantry_enemy': { draw: (ctx, c) => drawInfantry(ctx, c, true), colors: { body: '#5a3a3a', helmet: '#6a4a4a', weapon: '#333' } },
  'tank_ally': { draw: drawTank, colors: { hull: '#4a5a3a', turret: '#3a4a2a', tracks: '#222' } },
  'tank_enemy': { draw: (ctx, c) => drawTank(ctx, c, true), colors: { hull: '#5a4a3a', turret: '#4a3a2a', tracks: '#222' } },
  'skeleton': { draw: drawSkeleton },
};

const outDir = path.join(process.cwd(), 'apps/web/public/units/generated');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, cfg] of Object.entries(units)) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  cfg.draw(ctx, cfg.colors);
  fs.writeFileSync(path.join(outDir, `${name}.png`), canvas.toBuffer('image/png'));
  console.log(`✓ ${name}.png`);
}
console.log('Done!');

