import { angleDiff, dAtan2Angle, dcos, dsin } from '../core/trig';
import { RIPOSTE_TICKS, inArc, isActive } from './combat';
import { accelTo, followPath, lineOfSight, perceive, setAI, steerTo, turnTo } from './enemy';
import { moveMover } from './move';
import { emitNoise } from './perception';
import { hitPlayer } from './player';
import { damageCollapse } from './collapse';
import { killHordeIn } from './horde';
import { removeTorch } from './torch';
import type { AttackDef, Enemy, Sim, SimLight } from './types';

/**
 * 동굴 트롤 (중간 보스, 계획서 9장 적 표: 내리찍기 예고 1초, 휘두르기, 기둥 부수기).
 *   잠 (patrol) → 추격 (chase) ⇄ 공격 (attack: slam | sweep) → 휘청 (stagger) / 귀환 (suspicious) → 죽음
 * 규칙 세 가지가 싸움을 만든다:
 *  1. 내려찍기는 1초 예고 뒤 원형 범위 — 패링 불가, 옆으로 피해야 한다. 기둥을 치면 기둥이 부서지고 몽둥이가 박혀 2.5초 휘청인다(반격 기회).
 *  2. 휘두르기는 넓은 부채꼴 — 기둥 뒤에 있으면 막히고, 패링하면 휘청인다.
 *  3. 빛에 끌린다 — 트롤보다 플레이어가 멀면, 바닥·공중의 횃불로 가서 내려찍어 끈다 (횃불 던지기로 유인).
 * 수치는 초안 (M3에서 JSON으로 옮기며 조정).
 */
export const TROLL_HP = 360;
export const TROLL_CAPSULE = { half: 0.9, radius: 0.75 }; // 키 3.3m
const deg = (d: number) => Math.round((d / 360) * 4096);
export const TROLL_SLAM: AttackDef = { id: 'slam', windup: 60, active: 1, recovery: 50, damage: 40, reach: 2.4, halfArc: 0, stamina: 0, lunge: 0, hitstop: 8 };
export const TROLL_SWEEP: AttackDef = { id: 'sweep', windup: 38, active: 8, recovery: 42, damage: 26, reach: 4.0, halfArc: deg(75), stamina: 0, lunge: 0, hitstop: 6 };
/** 내려찍기 충격 반경 (m) — 겨냥점 둘레 */
export const SLAM_RADIUS = 2.0;
const SPEED = 2.6; // 플레이어 조깅(4.2)으로 떨어질 수 있다
const TURN = 36; // ≈ 190°/s — 느린 회전이 '옆으로 도는' 공략을 만든다
const PILLAR_STUCK = 150;
const PARRIED = 70;
const LEASH = 24;
const LURE_RANGE = 10;

const attackOf = (e: Enemy) => (e.move === 'slam' ? TROLL_SLAM : TROLL_SWEEP);

/** 트롤이 지금 노리는 곳: 자기보다 플레이어가 멀면 가까운 떨어진 횃불(빛에 끌린다), 아니면 플레이어 */
function pickTarget(sim: Sim, e: Enemy): { x: number; z: number; torch: boolean } {
  const me = e.body.translation();
  const pt = sim.player.body.translation();
  const dp = (pt.x - me.x) ** 2 + (pt.z - me.z) ** 2;
  let best = -1;
  let bestD = LURE_RANGE * LURE_RANGE;
  for (let i = 0; i < sim.torches.length; i++) {
    const t = sim.torches[i]!;
    if (t.state === 'held') continue;
    const d = (t.x - me.x) ** 2 + (t.z - me.z) ** 2;
    if (d < bestD && d < dp) {
      bestD = d;
      best = i;
    }
  }
  if (best >= 0 && dp > 25) {
    const t = sim.torches[best]!;
    return { x: t.x, z: t.z, torch: true };
  }
  return { x: pt.x, z: pt.z, torch: false };
}

function wake(sim: Sim, e: Enemy) {
  setAI(e, 'chase');
  e.awareness = 1;
  sim.events.push({ type: 'alert', tick: sim.tick, enemy: e.id });
}

/** 플레이어에게 맞았을 때 (enemy.damageEnemy가 부른다) */
export function trollDamaged(sim: Sim, e: Enemy) {
  if (e.ai === 'patrol' || e.ai === 'suspicious') wake(sim, e);
}

function startAttack(sim: Sim, e: Enemy, move: 'slam' | 'sweep') {
  setAI(e, 'attack');
  e.move = move;
  e.swingTick = 0;
  e.hitSet.clear();
  sim.events.push({ type: 'swing', tick: sim.tick, actor: e.id, attack: move });
}

/** 내려찍기 충격: 플레이어·기둥·횃불 */
function slamImpact(sim: Sim, e: Enemy) {
  const me = e.body.translation();
  const pt = sim.player.body.translation();
  const x = e.aimX;
  const z = e.aimZ;
  const floorY = me.y - TROLL_CAPSULE.half - TROLL_CAPSULE.radius;
  sim.events.push({ type: 'slam', tick: sim.tick, enemy: e.id, x, y: floorY, z });
  emitNoise(sim, x, floorY, z, 1, 18, 30);
  const r = SLAM_RADIUS + sim.player.stats.capsuleRadius;
  if ((pt.x - x) ** 2 + (pt.z - z) ** 2 < r * r && Math.abs(pt.y - me.y) < 2) {
    const res = hitPlayer(sim, TROLL_SLAM.damage, me.x, me.z, e.facing, { unparryable: true, knockback: 7, source: 'troll' });
    if (res === 'hit') sim.hitstop = Math.max(sim.hitstop, TROLL_SLAM.hitstop);
  }
  for (let i = sim.torches.length - 1; i >= 0; i--) {
    const t = sim.torches[i]!;
    if (t.state !== 'held' && (t.x - x) ** 2 + (t.z - z) ** 2 < SLAM_RADIUS * SLAM_RADIUS) removeTorch(sim, t);
  }
  killHordeIn(sim, x, z, SLAM_RADIUS); // 발밑의 무리도 깔린다
  // 금 간 기둥도 내려찍기 한 번에 무너진다 (트롤을 유인해 물결 쪽으로 쓰러뜨릴 수 있다)
  sim.collapses.forEach((c, i) => {
    const rr = SLAM_RADIUS + c.radius;
    if (c.state === 'standing' && (c.x - x) ** 2 + (c.z - z) ** 2 < rr * rr) damageCollapse(sim, i, 9999);
  });
  let stuck = false;
  for (const p of sim.pillars) {
    if (!p.body) continue;
    const rr = SLAM_RADIUS * 0.6 + p.r; // 기둥은 겨냥점 가까이에 있어야 부서진다
    if ((p.x - x) ** 2 + (p.z - z) ** 2 < rr * rr) {
      sim.world.removeRigidBody(p.body);
      p.body = null;
      stuck = true;
      sim.events.push({ type: 'pillar', tick: sim.tick, solid: p.solid, x: p.x, z: p.z });
    }
  }
  if (stuck) {
    // 몽둥이가 돌기둥에 박혔다 → 긴 휘청임 (반격 기회)
    setAI(e, 'stagger');
    e.staggerLen = PILLAR_STUCK;
    e.move = '';
  }
}

export function stepTroll(sim: Sim, e: Enemy, lights: readonly SimLight[]) {
  const p = sim.player;
  const me = e.body.translation();
  const pt = p.body.translation();
  const dist = Math.sqrt((pt.x - me.x) ** 2 + (pt.z - me.z) ** 2);
  const fromHome = Math.sqrt((me.x - e.home[0]) ** 2 + (me.z - e.home[2]) ** 2);

  switch (e.ai) {
    case 'patrol': {
      // 잠: 제자리에서 기척(빛·소리)이 쌓이면 깬다
      accelTo(e, 0, 0);
      e.awareness = Math.max(0, e.awareness + perceive(sim, e, lights) - 0.004);
      if (e.awareness >= 1) wake(sim, e);
      break;
    }
    case 'suspicious': {
      // 귀환: 집으로 걸어가 체력을 되찾는다. 가는 길에 다시 보이면 쫓는다
      followPath(sim, e, e.home, SPEED);
      if (fromHome < 1) {
        e.hp = TROLL_HP;
        e.awareness = 0;
        setAI(e, 'patrol');
      } else if (dist < 8 && p.action !== 'dead' && perceive(sim, e, lights) > 0.02) wake(sim, e);
      break;
    }
    case 'chase': {
      if (p.action === 'dead' || (fromHome > LEASH && dist > 6)) {
        setAI(e, 'suspicious');
        break;
      }
      const tg = pickTarget(sim, e);
      const dx = tg.x - me.x;
      const dz = tg.z - me.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const want = dAtan2Angle(-dx, -dz);
      turnTo(e, want, TURN);
      const facingOk = Math.abs(angleDiff(e.facing, want)) < deg(35);
      if (sim.tick >= e.cooldownUntil && facingOk) {
        if (tg.torch && d < TROLL_SLAM.reach + 0.6) {
          startAttack(sim, e, 'slam');
          break;
        }
        if (!tg.torch && d < TROLL_SWEEP.reach + 0.2) {
          // 가까우면 휘두르기가 잦고, 거리가 있으면 내려찍기
          startAttack(sim, e, d < 2.2 || sim.rng.int(100) < 40 ? 'sweep' : 'slam');
          break;
        }
      }
      // 시선이 트이면 곧장, 아니면 내비메시 경로 (몸이 커서 모퉁이에 걸리기 쉽다)
      if (d > 1.6) {
        if (lineOfSight(sim, me.x, me.y + 0.5, me.z, tg.x, me.y + 0.5, tg.z)) steerTo(e, tg.x, tg.z, SPEED, false);
        else followPath(sim, e, [tg.x, pt.y, tg.z], SPEED);
      } else accelTo(e, 0, 0);
      break;
    }
    case 'attack': {
      const a = attackOf(e);
      e.swingTick++;
      const t = e.swingTick;
      accelTo(e, 0, 0);
      // 예비 동작 앞 2/3는 목표를 따라 돌고 겨냥점을 옮긴다. 이후 고정 → 마지막 1/3초에 옆으로 피하면 빗나간다
      if (t < (a.windup * 2) / 3) {
        const tg = pickTarget(sim, e);
        turnTo(e, dAtan2Angle(-(tg.x - me.x), -(tg.z - me.z)), TURN / 2);
        const reach = Math.min(a.reach, Math.sqrt((tg.x - me.x) ** 2 + (tg.z - me.z) ** 2));
        e.aimX = me.x - dsin(e.facing) * Math.max(1.2, reach);
        e.aimZ = me.z - dcos(e.facing) * Math.max(1.2, reach);
      }
      if (e.move === 'slam' && t === a.windup) {
        slamImpact(sim, e);
        if (e.ai !== 'attack') break; // 기둥에 박혀 휘청
      }
      if (e.move === 'sweep' && isActive(a, t) && !e.hitSet.has(0) && p.action !== 'dead') {
        const inReach = inArc(me.x, me.y, me.z, e.facing, pt.x, pt.y, pt.z, p.stats.capsuleRadius, a.reach, a.halfArc);
        // 기둥 뒤에 숨으면 몽둥이가 기둥에 막힌다 (허리 높이 시선)
        if (inReach && lineOfSight(sim, me.x, me.y, me.z, pt.x, pt.y + 0.2, pt.z)) {
          e.hitSet.add(0);
          const r = hitPlayer(sim, a.damage, me.x, me.z, e.facing, { knockback: 5, source: 'troll' });
          if (r === 'parry') {
            setAI(e, 'stagger');
            e.staggerLen = PARRIED;
            e.move = '';
            p.riposteUntil = sim.tick + RIPOSTE_TICKS;
            sim.hitstop = Math.max(sim.hitstop, 10);
            sim.events.push({ type: 'parry', tick: sim.tick, enemy: e.id });
            break;
          }
          if (r === 'hit') sim.hitstop = Math.max(sim.hitstop, a.hitstop);
        }
      }
      if (t >= a.windup + a.active + a.recovery) {
        e.move = '';
        e.cooldownUntil = sim.tick + 40 + sim.rng.int(40);
        setAI(e, 'chase');
      }
      break;
    }
    case 'stagger':
      accelTo(e, 0, 0);
      if (e.aiTick >= e.staggerLen) setAI(e, 'chase');
      break;
  }
  moveMover(e, sim.enemyController);
}

/** 보스전 중인가 (깨어 있고 살아 있음) — 이때는 디렉터가 물결을 부르지 않는다 */
export function bossAwake(sim: Sim): boolean {
  for (const id of sim.bosses) {
    const e = sim.enemies.find((x) => x.id === id);
    if (e && e.ai !== 'dead' && e.ai !== 'patrol' && e.ai !== 'suspicious') return true;
  }
  return false;
}
