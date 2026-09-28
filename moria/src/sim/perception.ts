import { dcos, dsin } from '../core/trig';
import type { NoiseEvent, Sim, SimLight } from './types';

/**
 * 감지 필드 (계획서 6장 기둥 1). 모든 적의 인지와 '빛의 도박' 보상이 이 두 함수를 쓴다.
 * 광원 목록은 렌더러와 같은 데이터(level.torches + 횃불 아이템)라 "보이는 빛 = 규칙의 빛"이다.
 */

export function lightAt(x: number, y: number, z: number, lights: Iterable<SimLight>): number {
  let lux = 0;
  for (const l of lights) {
    const dx = l.x - x, dy = l.y - y, dz = l.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const r2 = l.range * l.range;
    if (d2 < r2) lux += l.intensity * (1 - d2 / r2);
  }
  return lux > 1 ? 1 : lux;
}

export function noiseAt(x: number, y: number, z: number, events: readonly NoiseEvent[], tick: number): number {
  let n = 0;
  for (const e of events) {
    const age = tick - e.tick;
    if (age < 0 || age >= e.ttl) continue;
    const dx = e.x - x, dy = e.y - y, dz = e.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const r2 = e.radius * e.radius;
    if (d2 >= r2) continue;
    const v = e.loudness * (1 - age / e.ttl) * (1 - d2 / r2);
    if (v > n) n = v;
  }
  return n;
}

export function emitNoise(sim: Sim, x: number, y: number, z: number, loudness: number, radius: number, ttl = 30) {
  sim.noise.push({ x, y, z, tick: sim.tick, ttl, radius, loudness });
}

/** 오래된 소음 제거 (순서 유지 → 결정적) */
export function pruneNoise(sim: Sim) {
  if (sim.noise.length > 0 && sim.tick - sim.noise[0]!.tick > 120) sim.noise = sim.noise.filter((e) => sim.tick - e.tick < e.ttl);
}

const HELD_TORCH: Omit<SimLight, 'x' | 'y' | 'z'> = { intensity: 1, range: 8 };
const GROUND_TORCH: Omit<SimLight, 'x' | 'y' | 'z'> = { intensity: 0.85, range: 7 };

/** 손에 든 횃불 위치: 몸 왼쪽 앞, 가슴 높이 (렌더의 실제 손 위치와 20cm 이내면 충분하다) */
export function heldTorchPos(px: number, py: number, pz: number, facing: number): [number, number, number] {
  const s = dsin(facing), c = dcos(facing);
  // 앞 = (−s, −c), 왼쪽 = (−c, s)
  return [px - s * 0.35 - c * 0.3, py + 0.45, pz - c * 0.35 + s * 0.3];
}

/** 지금 이 순간 세상의 모든 빛 (정적 횃불 + 들고/놓인/날아가는 횃불) */
export function allLights(sim: Sim): SimLight[] {
  const out: SimLight[] = sim.staticLights.slice();
  for (const t of sim.torches) {
    const kind = t.state === 'held' ? HELD_TORCH : GROUND_TORCH;
    out.push({ x: t.x, y: t.y, z: t.z, ...kind });
  }
  return out;
}
