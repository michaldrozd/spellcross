import { describe, expect, it } from 'vitest';

import { prepareMovingUnit } from './App.js';

describe('prepareMovingUnit', () => {
  it('starts the animation clock only after synchronous sound setup finishes', () => {
    const order: string[] = [];
    const movement = {
      unitId: 'm113-1',
      path: [
        { q: 8, r: 8 },
        { q: 7, r: 8 },
        { q: 6, r: 7 }
      ],
      stepDuration: 420,
      preAlignDuration: 320,
      segmentTurnDuration: 320,
      initialOrientation: 0
    };

    const moving = prepareMovingUnit(
      movement,
      (durationMs) => {
        order.push(`sound:${durationMs}`);
      },
      () => {
        order.push('clock');
        return 12_345;
      }
    );

    expect(order).toEqual(['sound:1480', 'clock']);
    expect(moving).toEqual({ ...movement, startTime: 12_345 });
    expect(movement).not.toHaveProperty('startTime');
  });
});
