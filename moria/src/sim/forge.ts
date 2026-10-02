import { damageEnemy } from './enemy';
import { openDoor } from './interact';
import type { Level } from './level';
import { startAction } from './player';
import type { Sim, SimLight } from './types';

/**
 * 구역 4 — 대장간과 깊은 탄갱 (계획서 7장 구역 표 4번: 용암 강, 압력 발판·간단한 퍼즐, 드워프 모루 재가동).
 *   용암: 상자 안에 들어가면 플레이어는 그 자리에서 쓰러지고, 적도 타 죽는다 (대장의 돌진을 용암 쪽으로 유도할 수 있다).
 *         용암은 빛이다 — 다리를 건너는 동안은 밝은 곳에 서 있게 된다 (감지 필드).
 *   발판 셋: 한 순간에 모두 눌리면 모루가 다시 타오르고 문이 열린다. 누르는 것 = 플레이어 + 바닥의 횃불.
 *         들고 있는 횃불과 예비 횃불 둘이 딱 퍼즐 값이다 — 빛을 내려놓아야 길이 열린다 (빛의 도박).
 */
export const PLATE_R = 1.0;
const LAVA_LIGHT_STEP = 7;

/** 용암 위의 빛 (용암 상자 윗면을 따라 7m 간격) — 시뮬레이션 감지와 렌더 광원이 같은 목록을 쓴다 */
export function lavaLights(level: Level): SimLight[] {
  const out: SimLight[] = [];
  for (const l of level.lava ?? []) {
    const [x0, , z0] = l.min;
    const [x1, y1, z1] = l.max;
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.round(len / LAVA_LIGHT_STEP));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push({
        x: alongX ? x0 + (x1 - x0) * t : (x0 + x1) / 2,
        y: y1 + 1,
        z: alongX ? (z0 + z1) / 2 : z0 + (z1 - z0) * t,
        intensity: 0.8,
        range: 7,
      });
    }
  }
  return out;
}

const inBox = (b: { min: readonly number[]; max: readonly number[] }, x: number, y: number, z: number) =>
  x >= b.min[0]! && x <= b.max[0]! && y >= b.min[1]! && y <= b.max[1]! && z >= b.min[2]! && z <= b.max[2]!;

/** 모루를 지핀다 (퍼즐을 풀었을 때, 저장에서 되살릴 때) */
export function lightForge(sim: Sim, silent: boolean) {
  const f = sim.level.forge;
  if (!f || sim.forge.lit) return;
  sim.forge.lit = true;
  if (!silent) sim.events.push({ type: 'forge', tick: sim.tick });
  for (const i of f.doors) {
    if (sim.doors[i]?.open) continue;
    openDoor(sim, i);
    if (!silent) sim.events.push({ type: 'door', tick: sim.tick, door: i });
  }
}

export function stepForge(sim: Sim) {
  const p = sim.player;
  const t = p.body.translation();
  // 용암: 발(캡슐 아래쪽)이 용암 상자 안
  if (sim.level.lava) {
    const feet = t.y - (p.stats.capsuleHalf + p.stats.capsuleRadius);
    if (p.action !== 'dead' && sim.level.lava.some((l) => inBox(l, t.x, feet, t.z))) {
      const damage = p.hp;
      p.hp = 0;
      startAction(p, 'dead');
      sim.events.push({ type: 'playerHit', tick: sim.tick, damage, source: 'lava' });
    }
    for (const e of sim.enemies) {
      if (e.ai === 'dead') continue;
      const et = e.body.translation();
      if (sim.level.lava.some((l) => inBox(l, et.x, et.y - 0.8, et.z))) damageEnemy(sim, e, 1e6);
    }
  }
  const f = sim.level.forge;
  if (!f || sim.forge.lit) return;
  const feetY = t.y - (p.stats.capsuleHalf + p.stats.capsuleRadius);
  let all = true;
  f.plates.forEach(([px, py, pz], i) => {
    const near = (x: number, y: number, z: number) => (x - px) ** 2 + (z - pz) ** 2 <= PLATE_R * PLATE_R && Math.abs(y - py) < 0.6;
    const down = (p.action !== 'dead' && near(t.x, feetY, t.z)) || sim.torches.some((tr) => tr.state === 'ground' && near(tr.x, tr.y, tr.z));
    if (down !== sim.forge.plates[i]) {
      sim.forge.plates[i] = down;
      sim.events.push({ type: 'plate', tick: sim.tick, index: i, down });
    }
    all &&= down;
  });
  if (all) lightForge(sim, false);
}
