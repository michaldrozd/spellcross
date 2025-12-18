#!/usr/bin/env node
/**
 * Generate Spellcross-style building sprites
 * Run with: node scripts/generateBuildings.js
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

const W = 96, H = 96;
const seed = (s) => () => { s = Math.sin(s) * 10000; return s - Math.floor(s); };

// Draw isometric house with red/orange roof
function drawHouse(ctx, roofColor = '#a04020', wallColor = '#e0d8c0') {
  const rnd = seed(42);
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(W/2 - 30, H - 10);
  ctx.lineTo(W/2 + 30, H - 10);
  ctx.lineTo(W/2 + 35, H - 5);
  ctx.lineTo(W/2 - 25, H - 5);
  ctx.closePath();
  ctx.fill();
  
  // Left wall (darker)
  ctx.fillStyle = shadeColor(wallColor, -30);
  ctx.beginPath();
  ctx.moveTo(W/2 - 25, H - 15);
  ctx.lineTo(W/2 - 25, H - 50);
  ctx.lineTo(W/2, H - 65);
  ctx.lineTo(W/2, H - 30);
  ctx.closePath();
  ctx.fill();
  
  // Right wall (lighter)
  ctx.fillStyle = wallColor;
  ctx.beginPath();
  ctx.moveTo(W/2, H - 30);
  ctx.lineTo(W/2, H - 65);
  ctx.lineTo(W/2 + 25, H - 50);
  ctx.lineTo(W/2 + 25, H - 15);
  ctx.closePath();
  ctx.fill();
  
  // Window on right wall
  ctx.fillStyle = '#4a6080';
  ctx.fillRect(W/2 + 8, H - 42, 8, 10);
  ctx.fillStyle = 'rgba(255,255,200,0.3)';
  ctx.fillRect(W/2 + 9, H - 41, 3, 4);
  
  // Roof - left side
  ctx.fillStyle = shadeColor(roofColor, -15);
  ctx.beginPath();
  ctx.moveTo(W/2, H - 80);
  ctx.lineTo(W/2 - 30, H - 50);
  ctx.lineTo(W/2, H - 62);
  ctx.closePath();
  ctx.fill();
  
  // Roof - right side
  ctx.fillStyle = roofColor;
  ctx.beginPath();
  ctx.moveTo(W/2, H - 80);
  ctx.lineTo(W/2 + 30, H - 50);
  ctx.lineTo(W/2, H - 62);
  ctx.closePath();
  ctx.fill();
  
  // Roof tiles detail
  ctx.strokeStyle = shadeColor(roofColor, -20);
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = H - 75 + i * 7;
    ctx.beginPath();
    ctx.moveTo(W/2 - 5 - i * 6, y);
    ctx.lineTo(W/2 + 5 + i * 6, y);
    ctx.stroke();
  }
  
  // Chimney
  ctx.fillStyle = '#6a5a4a';
  ctx.fillRect(W/2 + 8, H - 88, 8, 15);
}

// Draw ruined building
function drawRuin(ctx) {
  const rnd = seed(77);
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 8, 25, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Broken walls
  const wallColor = '#7a7060';
  ctx.fillStyle = wallColor;
  
  // Left wall piece
  ctx.beginPath();
  ctx.moveTo(W/2 - 22, H - 12);
  ctx.lineTo(W/2 - 22, H - 35);
  ctx.lineTo(W/2 - 15, H - 42);
  ctx.lineTo(W/2 - 8, H - 30);
  ctx.lineTo(W/2 - 5, H - 12);
  ctx.closePath();
  ctx.fill();
  
  // Right wall piece  
  ctx.fillStyle = shadeColor(wallColor, 15);
  ctx.beginPath();
  ctx.moveTo(W/2 + 5, H - 12);
  ctx.lineTo(W/2 + 8, H - 45);
  ctx.lineTo(W/2 + 18, H - 38);
  ctx.lineTo(W/2 + 22, H - 12);
  ctx.closePath();
  ctx.fill();
  
  // Rubble
  for (let i = 0; i < 8; i++) {
    const x = W/2 - 15 + rnd() * 30;
    const y = H - 15 + rnd() * 8;
    const c = 70 + rnd() * 40;
    ctx.fillStyle = `rgb(${c},${c-5},${c-10})`;
    ctx.fillRect(x, y, 5 + rnd() * 6, 3 + rnd() * 4);
  }
}

// Draw barn/storage
function drawBarn(ctx) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 8, 28, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Walls (wooden)
  const wood = '#6a4a30';
  ctx.fillStyle = shadeColor(wood, -15);
  ctx.beginPath();
  ctx.moveTo(W/2 - 28, H - 15);
  ctx.lineTo(W/2 - 28, H - 45);
  ctx.lineTo(W/2, H - 55);
  ctx.lineTo(W/2, H - 25);
  ctx.closePath();
  ctx.fill();
  
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.moveTo(W/2, H - 25);
  ctx.lineTo(W/2, H - 55);
  ctx.lineTo(W/2 + 28, H - 45);
  ctx.lineTo(W/2 + 28, H - 15);
  ctx.closePath();
  ctx.fill();
  
  // Barn door
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(W/2 + 5, H - 38, 12, 20);
  
  // Roof
  ctx.fillStyle = '#5a4030';
  ctx.beginPath();
  ctx.moveTo(W/2, H - 70);
  ctx.lineTo(W/2 - 32, H - 45);
  ctx.lineTo(W/2, H - 52);
  ctx.closePath();
  ctx.fill();
  
  ctx.fillStyle = '#6a5040';
  ctx.beginPath();
  ctx.moveTo(W/2, H - 70);
  ctx.lineTo(W/2 + 32, H - 45);
  ctx.lineTo(W/2, H - 52);
  ctx.closePath();
  ctx.fill();
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return `rgb(${R},${G},${B})`;
}

const buildings = {
  'house_red': { draw: () => drawHouse, args: ['#a04020', '#e0d8c0'] },
  'house_orange': { draw: () => drawHouse, args: ['#c06020', '#e8e0d0'] },
  'house_grey': { draw: () => drawHouse, args: ['#606060', '#d0d0d0'] },
  'ruin': { draw: () => drawRuin, args: [] },
  'barn': { draw: () => drawBarn, args: [] },
};

const outDir = path.join(process.cwd(), 'apps/web/public/props/buildings');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, cfg] of Object.entries(buildings)) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  cfg.draw()(ctx, ...cfg.args);
  fs.writeFileSync(path.join(outDir, `${name}.png`), canvas.toBuffer('image/png'));
  console.log(`✓ ${name}.png`);
}
console.log('Done!');

