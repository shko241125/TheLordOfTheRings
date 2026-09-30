import { angleDiff, dAtan2Angle } from '../core/trig';
import type { ClassId } from './classes';
import { damageEnemy } from './enemy';
import type { Sim } from './types';

/**
 * 동료 호출 (계획서 M3 7번 — 무리(흐름장 점)를 한꺼번에 쓰러뜨릴 수 있는 유일한 수단, 붕괴 E 말고는).
 * 적을 쓰러뜨려 게이지를 채운다: 진짜 고블린 +8, 무리 +1 (100이면 준비). Q(패드 LT+RT)로 부른다.
 *   인간 → 아라곤: 둘레 6m를 벤다        (고블린 40)
 *   드워프 → 김리: 둘레 4.5m를 내려찍는다 (고블린 70, 좁고 세다)
 *   엘프 → 레골라스: 앞 60° 18m에 화살비   (고블린 45, 멀리)
 * 무리는 범위 안이면 모두 쓰러진다. 트롤에게는 절반만.
 */
export const COMPANION_FULL = 100;
export const KILL_CHARGE = 8;

type Strike = { who: string; line: string; radius: number; halfArc: number; damage: number };
export const COMPANIONS: Record<ClassId, Strike> = {
  human: { who: '아라곤', line: '엘렌딜!', radius: 6, halfArc: 2048, damage: 40 },
  dwarf: { who: '김리', line: '바루크 크하자드!', radius: 4.5, halfArc: 2048, damage: 70 },
  elf: { who: '레골라스', line: '엎드려라!', radius: 18, halfArc: 341, damage: 45 },
};

export function callCompanion(sim: Sim, classId: ClassId): boolean {
  const p = sim.player;
  // 휘청이거나 공격 중이어도 부를 수 있다 — 포위당해 맞고 있을 때가 가장 필요한 순간이다 (브라우저에서 맞는 중 Q가 무시돼 발견).
  // 동료는 플레이어의 동작이 아니라 부르는 것이므로 쓰러졌을 때만 막는다
  if (p.companion < COMPANION_FULL || p.action === 'dead') return false;
  p.companion = 0;
  const s = COMPANIONS[classId];
  const me = p.body.translation();
  const inside = (x: number, z: number) => {
    const dx = x - me.x, dz = z - me.z;
    if (dx * dx + dz * dz > s.radius * s.radius) return false;
    return s.halfArc >= 2048 || Math.abs(angleDiff(p.facing, dAtan2Angle(-dx, -dz))) <= s.halfArc;
  };
  let killed = 0;
  if (sim.horde) {
    const before = sim.horde.agents.length;
    sim.horde.agents = sim.horde.agents.filter((a) => !inside(a.x, a.z));
    killed = before - sim.horde.agents.length;
  }
  for (const e of sim.enemies) {
    if (e.ai === 'dead') continue;
    const t = e.body.translation();
    if (inside(t.x, t.z)) damageEnemy(sim, e, e.kind === 'troll' ? Math.round(s.damage / 2) : s.damage);
  }
  // 동료가 쓰러뜨린 것은 게이지를 채우지 않는다
  p.companion = 0;
  sim.events.push({ type: 'companion', tick: sim.tick, who: s.who, line: s.line, x: me.x, y: me.y, z: me.z, facing: p.facing, radius: s.radius, halfArc: s.halfArc, killed });
  return true;
}
