import RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import { dAtan2Angle } from '../core/trig';
import { accelTo, alert, followPath, lineOfSight, perceive, setAI, steerTo, turnTo } from './enemy';
import { moveMover } from './move';
import { hitPlayer } from './player';
import { G_LEVEL, groups, type Enemy, type Sim, type SimLight } from './types';

/**
 * 고블린 궁수 (계획서 7장 구역 2: '모리아 고블린 무리, 궁수'). 기둥 홀에서 엄폐를 가르치는 적.
 *   거리 9~14m를 지키며 0.8초 동안 활을 당긴 뒤 쏜다 (당기는 동안이 예고) → 기둥 뒤로 숨거나, 회피 무적으로 피한다.
 *   화살은 패링할 수 없다. 5m 안으로 붙으면 물러난다 (근접은 약하다 — 체력 20).
 *   한 번에 활을 당기는 궁수는 둘까지 (공격권과 같은 뜻 — 사방에서 동시에 쏘지 않는다).
 * 화살은 시뮬레이션 투사체: 틱마다 직선으로 날고, 레벨 도형에 레이로 부딪히면 박힌다. 결정적.
 */
export const ARCHER_HP = 20;
export const DRAW_TICKS = 48;
export const ARROW_SPEED = 20;
export const ARROW_DAMAGE = 10;
const ARROW_TTL = 90;
const MAX_DRAWING = 2;
const NEAR = 5;
const FAR = 14;
const SPEED = 3.2;
const TURN = 90;

export type Arrow = { readonly id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; ttl: number };

export function stepArcher(sim: Sim, e: Enemy, lights: readonly SimLight[]) {
  const p = sim.player;
  const me = e.body.translation();
  const pt = p.body.translation();
  const dx = pt.x - me.x, dz = pt.z - me.z;
  const d = Math.sqrt(dx * dx + dz * dz);

  if (e.ai === 'patrol' || e.ai === 'suspicious') {
    e.awareness = Math.max(0, Math.min(1.2, e.awareness + perceive(sim, e, lights) - 0.004));
    if (e.awareness >= 1) {
      alert(sim, e);
      setAI(e, 'engage');
    }
  }

  switch (e.ai) {
    case 'patrol': {
      const wp = e.patrol[e.patrolIdx]!;
      if ((wp[0] - me.x) ** 2 + (wp[2] - me.z) ** 2 < 0.25) e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
      followPath(sim, e, e.patrol[e.patrolIdx]!, 1.4);
      break;
    }
    case 'suspicious':
      followPath(sim, e, e.lastSeen, 1.2);
      break;
    case 'chase':
    case 'engage': {
      if (p.action === 'dead') {
        setAI(e, 'patrol');
        e.awareness = 0;
        break;
      }
      const seen = lineOfSight(sim, me.x, me.y + 0.4, me.z, pt.x, pt.y + 0.3, pt.z);
      if (d < NEAR) {
        // 물러난다: 플레이어 반대쪽 4m
        steerTo(e, me.x - (dx / d) * 4, me.z - (dz / d) * 4, SPEED, true);
      } else if (d > FAR || !seen) {
        followPath(sim, e, [pt.x, pt.y, pt.z], SPEED);
      } else {
        accelTo(e, 0, 0);
        turnTo(e, dAtan2Angle(-dx, -dz), TURN);
        const drawing = sim.enemies.filter((x) => x.kind === 'archer' && x.ai === 'attack').length;
        if (sim.tick >= e.cooldownUntil && drawing < MAX_DRAWING) {
          setAI(e, 'attack');
          e.move = 'shoot';
          e.swingTick = 0;
          sim.events.push({ type: 'swing', tick: sim.tick, actor: e.id, attack: 'draw' });
        }
      }
      break;
    }
    case 'attack': {
      // 활 당기기: 제자리에서 플레이어를 따라 돈다. 끝나는 틱에 그 순간의 가슴을 향해 쏜다 (앞을 내다보지 않는다 → 옆으로 움직이면 빗나간다)
      accelTo(e, 0, 0);
      turnTo(e, dAtan2Angle(-dx, -dz), TURN);
      e.swingTick++;
      if (e.swingTick >= DRAW_TICKS) {
        const sy = me.y + 0.5;
        const tx = pt.x - me.x, ty = pt.y + 0.3 - sy, tz = pt.z - me.z;
        const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        sim.arrows.push({ id: sim.nextArrowId++, x: me.x, y: sy, z: me.z, vx: (tx / l) * ARROW_SPEED, vy: (ty / l) * ARROW_SPEED, vz: (tz / l) * ARROW_SPEED, ttl: ARROW_TTL });
        sim.events.push({ type: 'shoot', tick: sim.tick, enemy: e.id });
        e.move = '';
        e.cooldownUntil = sim.tick + 90 + sim.rng.int(60);
        setAI(e, 'engage');
      }
      break;
    }
    case 'stagger':
      accelTo(e, 0, 0);
      if (e.aiTick >= e.staggerLen) setAI(e, 'engage');
      break;
  }
  moveMover(e, sim.enemyController);
}

/** 화살: 레벨에 부딪히면 박히고(사라진다), 플레이어 캡슐에 닿으면 맞힌다 */
export function stepArrows(sim: Sim) {
  if (sim.arrows.length === 0) return;
  const p = sim.player;
  const pt = p.body.translation();
  const r = p.stats.capsuleRadius + 0.12;
  const half = p.stats.capsuleHalf + p.stats.capsuleRadius;
  sim.arrows = sim.arrows.filter((a) => {
    const step = ARROW_SPEED * DT;
    const hit = sim.world.castRay(new RAPIER.Ray({ x: a.x, y: a.y, z: a.z }, { x: a.vx / ARROW_SPEED, y: a.vy / ARROW_SPEED, z: a.vz / ARROW_SPEED }), step, true, undefined, groups(0xffff, G_LEVEL));
    const t = hit ? hit.timeOfImpact / step : 1;
    const nx = a.x + a.vx * DT * t, ny = a.y + a.vy * DT * t, nz = a.z + a.vz * DT * t;
    // 플레이어: 이번 틱 구간의 끝점만 본다 (한 틱 0.33m < 캡슐 지름이라 건너뛰지 않는다)
    if (p.action !== 'dead' && (nx - pt.x) ** 2 + (nz - pt.z) ** 2 < r * r && Math.abs(ny - pt.y) < half) {
      const res = hitPlayer(sim, ARROW_DAMAGE, a.x, a.z, dAtan2Angle(-a.vx, -a.vz), { unparryable: true, knockback: 1.5, source: 'goblin' });
      if (res !== 'iframe') return false; // 회피 무적이면 뚫고 지나간다
    }
    if (hit || --a.ttl <= 0) {
      if (hit) sim.events.push({ type: 'arrowStuck', tick: sim.tick, x: nx, y: ny, z: nz });
      return false;
    }
    a.x = nx;
    a.y = ny;
    a.z = nz;
    return true;
  });
}
