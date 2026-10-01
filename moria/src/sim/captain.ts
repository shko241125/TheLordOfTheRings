import { DT } from '../core/loop';
import { angleDiff, dAtan2Angle, dcos, dsin } from '../core/trig';
import { RIPOSTE_TICKS, inArc, isActive, attackLength } from './combat';
import { accelTo, alert, followPath, perceive, setAI, steerTo, turnTo } from './enemy';
import { spawnHorde } from './horde';
import { moveMover } from './move';
import { hitPlayer } from './player';
import type { AttackDef, Enemy, Sim, SimLight } from './types';

/**
 * 고블린 대장 (계획서 7장 구역 2 보스). 21번째 홀 북문 앞을 지킨다 — 북문 출구는 등불 셋 + 대장 처치.
 *   3연타: 막을 수 있다 — 패링하면 연타가 끊기고 휘청인다 (반격 기회).
 *   돌진: 0.8초 예고(바닥에 붉은 띠) 뒤 11m/s로 들이받는다. 패링 불가, 옆으로 피한다. 벽이나 기둥에 박히면 1초 휘청인다.
 *   휘파람: 체력이 절반이 되면 한 번, 홀 양쪽 구석에서 무리를 부른다.
 * 결정성: 난수는 sim.rng, 각도는 정수 표, 진행은 틱.
 */
export const CAPTAIN_HP = 260;
export const CAPTAIN_CAPSULE = { half: 0.6, radius: 0.4 }; // 키 2.0m
const deg = (d: number) => Math.round((d / 360) * 4096);
export const CAPTAIN_COMBO: readonly AttackDef[] = [
  { id: 'c1', windup: 22, active: 5, recovery: 12, damage: 14, reach: 1.9, halfArc: deg(60), stamina: 0, lunge: 2.4, hitstop: 5 },
  { id: 'c2', windup: 14, active: 5, recovery: 12, damage: 14, reach: 1.9, halfArc: deg(60), stamina: 0, lunge: 2.4, hitstop: 5 },
  { id: 'c3', windup: 18, active: 6, recovery: 28, damage: 18, reach: 2.1, halfArc: deg(70), stamina: 0, lunge: 3.2, hitstop: 7 },
];
export const CHARGE_WINDUP = 48;
const CHARGE_LOCK = 34; // 이 틱 이후로 방향이 고정된다
// 11m/s × 50틱 ≈ 9.2m. 처음 30틱(5.5m)은 5~13m에서 고른 돌진이 대부분 닿지 않았다 (테스트로 발견) → 거리를 맞췄다
const CHARGE_TICKS = 50;
const CHARGE_SPEED = 11;
const CHARGE_DAMAGE = 26;
const CHARGE_RECOVER = 40;
const WALL_STUN = 60;
const PARRIED = 60;
const SPEED = 3.8;
const TURN = 70;
/** used 비트: 휘파람을 불었다 */
const WHISTLED = 1;

export function captainDamaged(sim: Sim, e: Enemy) {
  if (e.ai === 'patrol' || e.ai === 'suspicious') {
    alert(sim, e);
    setAI(e, 'chase');
  }
  if (!(e.used & WHISTLED) && e.hp <= CAPTAIN_HP / 2) {
    e.used |= WHISTLED;
    // 홀 양쪽 끝 구석 두 곳에서 12마리씩 (레벨 스폰 자리 앞 둘)
    for (const at of sim.spawnPoints.slice(0, 2)) spawnHorde(sim, at, 12);
    sim.events.push({ type: 'whistle', tick: sim.tick, enemy: e.id });
  }
}

function startMove(sim: Sim, e: Enemy, move: 'combo' | 'charge') {
  setAI(e, 'attack');
  e.move = move;
  e.step = 0;
  e.swingTick = 0;
  e.hitSet.clear();
  sim.events.push({ type: 'swing', tick: sim.tick, actor: e.id, attack: move === 'combo' ? 'c1' : 'charge' });
}

export function stepCaptain(sim: Sim, e: Enemy, lights: readonly SimLight[]) {
  const p = sim.player;
  const me = e.body.translation();
  const pt = p.body.translation();
  const dx = pt.x - me.x, dz = pt.z - me.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const toPlayer = dAtan2Angle(-dx, -dz);

  switch (e.ai) {
    case 'patrol':
      accelTo(e, 0, 0);
      e.awareness = Math.max(0, e.awareness + perceive(sim, e, lights) - 0.004);
      if (e.awareness >= 1) {
        alert(sim, e);
        setAI(e, 'chase');
      }
      break;
    case 'chase':
    case 'engage': {
      if (p.action === 'dead') {
        setAI(e, 'patrol');
        e.awareness = 0;
        break;
      }
      turnTo(e, toPlayer, TURN);
      const facing = Math.abs(angleDiff(e.facing, toPlayer)) < deg(30);
      if (sim.tick >= e.cooldownUntil && facing) {
        if (d < 2.4) {
          startMove(sim, e, 'combo');
          break;
        }
        // 거리가 벌어지면 1초에 한 번쯤 돌진을 고른다
        if (d > 5 && d < 10 && sim.tick % 30 === 0 && sim.rng.int(100) < 45) {
          startMove(sim, e, 'charge');
          break;
        }
      }
      if (d > 1.8) followPath(sim, e, [pt.x, pt.y, pt.z], SPEED);
      else accelTo(e, 0, 0);
      break;
    }
    case 'attack': {
      e.swingTick++;
      const t = e.swingTick;
      if (e.move === 'combo') {
        const a = CAPTAIN_COMBO[e.step]!;
        if (t < (a.windup * 2) / 3) turnTo(e, toPlayer, TURN / 2);
        const lunge = t >= a.windup - 6 && t < a.windup + a.active ? a.lunge : 0;
        e.vx = -dsin(e.facing) * lunge;
        e.vz = -dcos(e.facing) * lunge;
        if (isActive(a, t) && !e.hitSet.has(0) && p.action !== 'dead') {
          if (inArc(me.x, me.y, me.z, e.facing, pt.x, pt.y, pt.z, p.stats.capsuleRadius, a.reach, a.halfArc)) {
            e.hitSet.add(0);
            const r = hitPlayer(sim, a.damage, me.x, me.z, e.facing, { knockback: 3.5 });
            if (r === 'parry') {
              // 패링: 연타가 끊기고 오래 휘청인다
              e.move = '';
              setAI(e, 'stagger');
              e.staggerLen = PARRIED;
              p.riposteUntil = sim.tick + RIPOSTE_TICKS;
              sim.hitstop = Math.max(sim.hitstop, 8);
              sim.events.push({ type: 'parry', tick: sim.tick, enemy: e.id });
              break;
            }
            if (r === 'hit') sim.hitstop = Math.max(sim.hitstop, a.hitstop);
          }
        }
        if (t >= attackLength(a)) {
          if (e.step < CAPTAIN_COMBO.length - 1) {
            e.step++;
            e.swingTick = 0;
            e.hitSet.clear();
            sim.events.push({ type: 'swing', tick: sim.tick, actor: e.id, attack: CAPTAIN_COMBO[e.step]!.id });
          } else {
            e.move = '';
            e.cooldownUntil = sim.tick + 45 + sim.rng.int(30);
            setAI(e, 'chase');
          }
        }
      } else if (e.move === 'charge') {
        if (t <= CHARGE_WINDUP) {
          // 예고: 제자리에서 겨눈다. 앞부분은 플레이어를 따라가고 CHARGE_LOCK 이후 고정 (바닥 띠도 고정된다)
          accelTo(e, 0, 0);
          if (t < CHARGE_LOCK) {
            turnTo(e, toPlayer, TURN);
            e.aimX = -dsin(e.facing);
            e.aimZ = -dcos(e.facing);
          }
        } else if (t <= CHARGE_WINDUP + CHARGE_TICKS) {
          e.vx = e.aimX * CHARGE_SPEED;
          e.vz = e.aimZ * CHARGE_SPEED;
          if (!e.hitSet.has(0) && p.action !== 'dead' && dx * dx + dz * dz < 1.2 * 1.2 && Math.abs(pt.y - me.y) < 1.5) {
            e.hitSet.add(0);
            const r = hitPlayer(sim, CHARGE_DAMAGE, me.x, me.z, e.facing, { unparryable: true, knockback: 7 });
            if (r === 'hit') sim.hitstop = Math.max(sim.hitstop, 8);
          }
          // 벽·기둥에 박힘: 바라던 속도의 절반도 못 움직였다 → 휘청 (반격 기회).
          // 실제 이동량은 moveMover가 속도에 다시 적어 둔 값으로 본다 — 키네마틱 바디 위치는 물리 스텝 뒤에야 바뀐다
          // (처음엔 직후 위치를 다시 읽어 '안 움직임'으로 판정 → 돌진이 시작하자마자 멈췄다, 테스트로 발견)
          moveMover(e, sim.enemyController);
          const moved = Math.sqrt(e.vx * e.vx + e.vz * e.vz) * DT;
          if (t > CHARGE_WINDUP + 3 && moved < CHARGE_SPEED * DT * 0.5) {
            if (e.hitSet.has(0)) {
              // 플레이어를 들이받아 막혔다 → 휘청이지 않고 돌진만 끝낸다 (회복 구간으로)
              e.swingTick = CHARGE_WINDUP + CHARGE_TICKS;
            } else {
              e.move = '';
              setAI(e, 'stagger');
              e.staggerLen = WALL_STUN;
              sim.events.push({ type: 'slam', tick: sim.tick, enemy: e.id, x: me.x, y: me.y, z: me.z });
            }
          }
          return;
        } else {
          accelTo(e, 0, 0);
          if (t >= CHARGE_WINDUP + CHARGE_TICKS + CHARGE_RECOVER) {
            e.move = '';
            e.cooldownUntil = sim.tick + 40 + sim.rng.int(40);
            setAI(e, 'chase');
          }
        }
      }
      break;
    }
    case 'stagger':
      accelTo(e, 0, 0);
      if (e.aiTick >= e.staggerLen) setAI(e, 'chase');
      break;
    case 'suspicious':
      steerTo(e, e.home[0], e.home[2], SPEED, true);
      break;
  }
  moveMover(e, sim.enemyController);
}
