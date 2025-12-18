#!/usr/bin/env node
/**
 * Generate Spellcross-style tree sprites
 * Run with: node scripts/generateTrees.js
 */

import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';

const W = 64, H = 80;
const seed = (s) => () => { s = Math.sin(s) * 10000; return s - Math.floor(s); };

// Draw deciduous tree
function drawTree(ctx, leafColor = '#3a6a2a', trunkColor = '#5a4030', seedVal = 42) {
  const rnd = seed(seedVal);
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 6, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Trunk
  ctx.fillStyle = trunkColor;
  ctx.fillRect(W/2 - 4, H - 35, 8, 30);
  
  // Trunk detail
  ctx.fillStyle = shadeColor(trunkColor, -20);
  ctx.fillRect(W/2 - 2, H - 32, 2, 25);
  
  // Foliage layers (bottom to top)
  for (let layer = 0; layer < 3; layer++) {
    const y = H - 40 - layer * 12;
    const size = 18 - layer * 3;
    
    // Main foliage blob
    ctx.fillStyle = shadeColor(leafColor, layer * 10);
    ctx.beginPath();
    ctx.ellipse(W/2, y, size, size * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Leaf detail
    for (let i = 0; i < 5; i++) {
      const lx = W/2 - size + rnd() * size * 2;
      const ly = y - size * 0.5 + rnd() * size;
      ctx.fillStyle = shadeColor(leafColor, -10 + rnd() * 30);
      ctx.beginPath();
      ctx.ellipse(lx, ly, 4 + rnd() * 4, 3 + rnd() * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Highlight
  ctx.fillStyle = 'rgba(255,255,200,0.15)';
  ctx.beginPath();
  ctx.ellipse(W/2 - 5, H - 55, 8, 10, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

// Draw pine/conifer tree
function drawPine(ctx, color = '#2a5a2a', seedVal = 55) {
  const rnd = seed(seedVal);
  
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 6, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Trunk
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(W/2 - 3, H - 25, 6, 20);
  
  // Pine layers (triangular)
  for (let layer = 0; layer < 4; layer++) {
    const y = H - 25 - layer * 12;
    const width = 22 - layer * 4;
    
    ctx.fillStyle = shadeColor(color, layer * 8);
    ctx.beginPath();
    ctx.moveTo(W/2, y - 15);
    ctx.lineTo(W/2 - width, y);
    ctx.lineTo(W/2 + width, y);
    ctx.closePath();
    ctx.fill();
    
    // Snow/highlight on top
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(W/2, y - 14);
    ctx.lineTo(W/2 - width * 0.3, y - 5);
    ctx.lineTo(W/2 + width * 0.1, y - 5);
    ctx.closePath();
    ctx.fill();
  }
}

// Draw dead/burnt tree
function drawDeadTree(ctx) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(W/2, H - 6, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Dead trunk
  ctx.fillStyle = '#3a3030';
  ctx.fillRect(W/2 - 3, H - 50, 6, 45);
  
  // Branches
  ctx.strokeStyle = '#3a3030';
  ctx.lineWidth = 3;
  
  ctx.beginPath();
  ctx.moveTo(W/2, H - 40);
  ctx.lineTo(W/2 - 15, H - 55);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(W/2, H - 35);
  ctx.lineTo(W/2 + 12, H - 48);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(W/2, H - 25);
  ctx.lineTo(W/2 - 10, H - 35);
  ctx.stroke();
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return `rgb(${R},${G},${B})`;
}

const trees = {
  'tree1': { draw: drawTree, args: ['#3a6a2a', '#5a4030', 42] },
  'tree2': { draw: drawTree, args: ['#4a7a3a', '#6a5040', 77] },
  'tree3': { draw: drawTree, args: ['#2a5a1a', '#4a3020', 99] },
  'pine1': { draw: drawPine, args: ['#2a5a2a', 55] },
  'pine2': { draw: drawPine, args: ['#1a4a1a', 88] },
  'dead_tree': { draw: drawDeadTree, args: [] },
};

const outDir = path.join(process.cwd(), 'apps/web/public/props');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, cfg] of Object.entries(trees)) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  cfg.draw(ctx, ...cfg.args);
  fs.writeFileSync(path.join(outDir, `${name}.png`), canvas.toBuffer('image/png'));
  console.log(`✓ ${name}.png`);
}
console.log('Done!');

