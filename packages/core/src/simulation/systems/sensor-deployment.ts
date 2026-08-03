import type { UnitInstance } from '../types.js';

export function isDeployableSensor(unit: UnitInstance): boolean {
  return unit.stats.sensorDeployment != null;
}

export function sensorVisionRange(unit: UnitInstance): number {
  const deployment = unit.stats.sensorDeployment;
  if (!deployment || unit.sensorDeployed) return unit.stats.vision;
  return Math.min(unit.stats.vision, deployment.mobileVision);
}
