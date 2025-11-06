import { useMemo, type JSX } from 'react';

import type { FactionId, HexCoordinate, TacticalBattleState } from '@spellcross/core';
import { Container, Graphics, Stage, Text } from '@pixi/react';
import { TextStyle } from 'pixi.js';

const tileSize = 56;
const hexWidth = tileSize;
const hexHeight = tileSize * 0.866; // sin(60deg)

const terrainPalette: Record<string, number> = {
  plain: 0x2f4f4f,
  road: 0x566573,
  forest: 0x145214,
  urban: 0x5e5b70,
  hill: 0x4f614f,
  water: 0x143464,
  swamp: 0x3d5e4a,
  structure: 0x6f5f4f
};

export interface BattlefieldStageProps {
  battleState: TacticalBattleState;
  onSelectUnit?: (unitId: string) => void;
  onSelectTile?: (coordinate: HexCoordinate) => void;
  plannedPath?: HexCoordinate[];
  plannedDestination?: HexCoordinate;
  targetUnitId?: string;
  selectedUnitId?: string;
  viewerFaction?: FactionId;
}

const axialToPixel = ({ q, r }: { q: number; r: number }) => {
  const x = (hexWidth * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r)) / Math.sqrt(3);
  const y = hexHeight * (1.5 * r);
  return { x, y };
};

export function BattlefieldStage({
  battleState,
  onSelectUnit,
  onSelectTile,
  plannedPath,
  plannedDestination,
  targetUnitId,
  selectedUnitId,
  viewerFaction = 'alliance'
}: BattlefieldStageProps) {
  const map = battleState.map;
  const viewerVision = battleState.vision[viewerFaction];
  const visibleTiles = viewerVision?.visibleTiles ?? new Set<number>();
  const exploredTiles = viewerVision?.exploredTiles ?? new Set<number>();
  const stageDimensions = useMemo(() => {
    const width = map.width * hexWidth + hexWidth;
    const height = map.height * hexHeight + hexHeight;
    return { width, height };
  }, [map.height, map.width]);

  const tileGraphics = useMemo(() => {
    return map.tiles.map((tile, index) => {
      const q = index % map.width;
      const r = Math.floor(index / map.width);
      const pos = axialToPixel({ q, r });
      const isVisible = visibleTiles.has(index);
      const isExplored = exploredTiles.has(index);

      return (
        <Graphics
          key={`tile-${index}`}
          x={pos.x}
          y={pos.y}
          interactive={isExplored}
          cursor={isExplored ? 'pointer' : 'not-allowed'}
          pointerdown={() => isExplored && onSelectTile?.({ q, r })}
          draw={(g) => {
            g.clear();
            const baseColor = terrainPalette[tile.terrain] ?? terrainPalette.plain;
            if (!isExplored) {
              g.beginFill(0x030509, 0.95);
            } else {
              g.beginFill(baseColor, isVisible ? 0.95 : 0.35);
            }
            const size = tileSize / 2;
            const points = [
              { x: 0, y: -size },
              { x: hexWidth / 2, y: -size / 2 },
              { x: hexWidth / 2, y: size / 2 },
              { x: 0, y: size },
              { x: -hexWidth / 2, y: size / 2 },
              { x: -hexWidth / 2, y: -size / 2 }
            ];
            g.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
              g.lineTo(points[i].x, points[i].y);
            }
            g.closePath();
            g.endFill();

            if (isExplored && !isVisible) {
              g.lineStyle(1, 0x0a1a2c, 0.45);
              g.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
              }
              g.closePath();
            }
          }}
        />
      );
    });
  }, [exploredTiles, map, onSelectTile, visibleTiles]);

  const plannedHighlights = useMemo(() => {
    if ((!plannedPath || plannedPath.length === 0) && !plannedDestination) {
      return null;
    }

    const steps: HexCoordinate[] = [...(plannedPath ?? [])];
    if (
      plannedDestination &&
      !steps.some((step) => step.q === plannedDestination.q && step.r === plannedDestination.r)
    ) {
      steps.push(plannedDestination);
    }

    return steps.map((step, index) => {
      const { x, y } = axialToPixel(step);
      const isDestination =
        plannedDestination && plannedDestination.q === step.q && plannedDestination.r === step.r;
      const tileIdx = step.r * map.width + step.q;
      if (!exploredTiles.has(tileIdx)) {
        return null;
      }
      return (
        <Graphics
          key={`planned-${step.q}-${step.r}-${index}`}
          x={x}
          y={y}
          draw={(g) => {
            g.clear();
            g.beginFill(isDestination ? 0xffc107 : 0x4a90e2, isDestination ? 0.4 : 0.3);
            g.drawCircle(0, 0, isDestination ? tileSize * 0.32 : tileSize * 0.22);
            g.endFill();
          }}
        />
      );
    }).filter((value): value is JSX.Element => Boolean(value));
  }, [exploredTiles, map.width, plannedDestination, plannedPath]);

  const units = useMemo(() => {
    return Object.values(battleState.sides).flatMap((side) =>
      Array.from(side.units.values()).flatMap((unit) => {
        const { x, y } = axialToPixel(unit.coordinate);
        const color = unit.faction === 'alliance' ? 0x5dade2 : 0xe74c3c;
        const isSelected = unit.id === selectedUnitId;
        const isTarget = unit.id === targetUnitId;
        const tileIndex = unit.coordinate.r * map.width + unit.coordinate.q;
        const isVisible = visibleTiles.has(tileIndex);
        const isFriendly = unit.faction === viewerFaction;

        if (!isFriendly && !isVisible) {
          return [];
        }

        return (
          <Container
            key={unit.id}
            x={x}
            y={y}
            interactive={true}
            pointerdown={() => onSelectUnit?.(unit.id)}
          >
            {isSelected && (
              <Graphics
                draw={(g) => {
                  g.clear();
                  g.beginFill(0xffff00, 0.18);
                  g.drawCircle(0, 0, tileSize * 0.32);
                  g.endFill();
                }}
              />
            )}
            {isTarget && (
              <Graphics
                draw={(g) => {
                  g.clear();
                  g.lineStyle(2, 0xff2d55, 0.85);
                  g.drawCircle(0, 0, tileSize * 0.34);
                  g.moveTo(-tileSize * 0.18, 0);
                  g.lineTo(tileSize * 0.18, 0);
                  g.moveTo(0, -tileSize * 0.18);
                  g.lineTo(0, tileSize * 0.18);
                }}
              />
            )}
            <Graphics
              draw={(g) => {
                g.clear();
                g.beginFill(color, 1);
                g.drawCircle(0, 0, tileSize * 0.25);
                g.endFill();
              }}
            />
            <Text
              text={unit.definitionId}
              anchor={0.5}
              y={tileSize * 0.35}
              style={new TextStyle({
                fill: 0xfefefe,
                fontSize: 12
              })}
            />
          </Container>
        );
      })
    );
  }, [
    battleState.sides,
    map.width,
    selectedUnitId,
    targetUnitId,
    viewerFaction,
    visibleTiles
  ]);

  return (
    <Stage
      width={stageDimensions.width}
      height={stageDimensions.height}
      options={{
        backgroundColor: 0x061639,
        resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        antialias: true
      }}
    >
      <Container x={hexWidth} y={hexHeight}>
        {tileGraphics}
        {plannedHighlights}
        {units}
      </Container>
    </Stage>
  );
}
