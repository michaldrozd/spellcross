/**
 * Visual Effects Component for Spellcross
 * Handles explosions, muzzle flashes, hit effects, and other visual feedback
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Graphics, Container } from '@pixi/react';
import type { HexCoordinate } from '@spellcross/core';

interface Effect {
  id: string;
  type: 'explosion' | 'muzzleFlash' | 'hit' | 'smoke';
  position: { x: number; y: number };
  startTime: number;
  duration: number;
}

interface VisualEffectsProps {
  hexToPixel: (coord: HexCoordinate) => { x: number; y: number };
  tileSize: number;
}

// Global effect queue - accessible from outside React
let effectQueue: Effect[] = [];
let effectIdCounter = 0;

export function triggerEffect(
  type: Effect['type'],
  coord: HexCoordinate,
  hexToPixel: (c: HexCoordinate) => { x: number; y: number }
) {
  const pos = hexToPixel(coord);
  effectQueue.push({
    id: `effect_${effectIdCounter++}`,
    type,
    position: pos,
    startTime: Date.now(),
    duration: type === 'explosion' ? 600 : type === 'muzzleFlash' ? 150 : 400
  });
}

export const VisualEffects: React.FC<VisualEffectsProps> = ({ tileSize }) => {
  const [effects, setEffects] = useState<Effect[]>([]);

  // Process effect queue
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      // Add new effects from queue
      if (effectQueue.length > 0) {
        setEffects(prev => [...prev, ...effectQueue]);
        effectQueue = [];
      }
      // Remove expired effects
      setEffects(prev => prev.filter(e => now - e.startTime < e.duration));
    }, 16); // ~60fps

    return () => clearInterval(interval);
  }, []);

  const drawExplosion = useCallback((g: any, effect: Effect) => {
    const elapsed = Date.now() - effect.startTime;
    const progress = elapsed / effect.duration;
    const size = tileSize * (0.3 + progress * 0.7);
    const alpha = 1 - progress;

    g.clear();
    // Outer glow
    g.beginFill(0xff6600, alpha * 0.3);
    g.drawCircle(effect.position.x, effect.position.y, size * 1.5);
    g.endFill();
    // Main explosion
    g.beginFill(0xff4400, alpha * 0.6);
    g.drawCircle(effect.position.x, effect.position.y, size);
    g.endFill();
    // Core
    g.beginFill(0xffff00, alpha * 0.8);
    g.drawCircle(effect.position.x, effect.position.y, size * 0.4);
    g.endFill();
  }, [tileSize]);

  const drawMuzzleFlash = useCallback((g: any, effect: Effect) => {
    const elapsed = Date.now() - effect.startTime;
    const progress = elapsed / effect.duration;
    const alpha = 1 - progress;

    g.clear();
    g.beginFill(0xffff88, alpha);
    g.drawCircle(effect.position.x, effect.position.y, tileSize * 0.15);
    g.endFill();
    g.beginFill(0xffffcc, alpha * 0.8);
    g.drawCircle(effect.position.x, effect.position.y, tileSize * 0.08);
    g.endFill();
  }, [tileSize]);

  const drawHit = useCallback((g: any, effect: Effect) => {
    const elapsed = Date.now() - effect.startTime;
    const progress = elapsed / effect.duration;
    const alpha = 1 - progress;
    const offset = progress * tileSize * 0.3;

    g.clear();
    // Sparks
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const x = effect.position.x + Math.cos(angle) * offset;
      const y = effect.position.y + Math.sin(angle) * offset;
      g.beginFill(0xffaa00, alpha);
      g.drawCircle(x, y, 2);
      g.endFill();
    }
    // Impact point
    g.beginFill(0xff4400, alpha * 0.6);
    g.drawCircle(effect.position.x, effect.position.y, tileSize * 0.1);
    g.endFill();
  }, [tileSize]);

  const drawSmoke = useCallback((g: any, effect: Effect) => {
    const elapsed = Date.now() - effect.startTime;
    const progress = elapsed / effect.duration;
    const alpha = (1 - progress) * 0.4;
    const yOffset = -progress * tileSize * 0.5;
    const size = tileSize * (0.2 + progress * 0.3);

    g.clear();
    g.beginFill(0x666666, alpha);
    g.drawCircle(effect.position.x, effect.position.y + yOffset, size);
    g.endFill();
  }, [tileSize]);

  return (
    <Container zIndex={1000}>
      {effects.map(effect => (
        <Graphics
          key={effect.id}
          draw={g => {
            switch (effect.type) {
              case 'explosion': drawExplosion(g, effect); break;
              case 'muzzleFlash': drawMuzzleFlash(g, effect); break;
              case 'hit': drawHit(g, effect); break;
              case 'smoke': drawSmoke(g, effect); break;
            }
          }}
        />
      ))}
    </Container>
  );
};

export default VisualEffects;

