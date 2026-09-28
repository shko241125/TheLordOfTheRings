import {
  DODGE_TICKS, HEAVY, HEAVY_CHARGE_MAX, LIGHT_COMBO, PARRY_TICKS, PLAYER_STAGGER_TICKS, attackLength,
} from '../sim/combat';
import type { AttackDef, PlayerState } from '../sim/types';
import type { ActionPose } from './locomotion';
import type { ActionInfo, ActionSlot } from './character';

/**
 * 시뮬레이션 틱 → 애니메이션 클립 시간. 시간 왜곡(time warp)으로 클립의 타격 순간을 판정 시작 틱에 맞춘다.
 *   [0, windup] → [0, impact] ,  [windup, 끝] → [impact, duration]
 * 판정(피해)이 들어가는 틱에 화면에서도 칼이 가장 빠르게 지나간다 — 맞았는데 칼이 아직 머리 위에 있는 어긋남이 없다.
 */
export function warpAttack(t: number, a: AttackDef, info: ActionInfo): number {
  const D = info.clip.duration;
  if (t <= a.windup) return (t / a.windup) * info.impact;
  const rest = attackLength(a) - a.windup;
  return info.impact + ((t - a.windup) / rest) * (D - info.impact);
}

export function playerPose(p: PlayerState, actions: Record<ActionSlot, ActionInfo>, tickFrac: number): ActionPose {
  const t = p.actionTick + tickFrac;
  switch (p.action) {
    case 'attack': {
      if (p.charging) {
        // 차지: 강공격 클립의 예비 동작 앞부분에서 멈춰 힘을 모으는 자세
        const info = actions.heavy;
        return { slot: 'heavy', time: info.impact * 0.55 * Math.min(1, p.heavyCharge / (HEAVY_CHARGE_MAX * 0.5)) };
      }
      const a = p.attack;
      if (!a) return null;
      const slot = (a.id === 'heavy' ? 'heavy' : a.id) as ActionSlot;
      const def = a.id === 'heavy' ? HEAVY : LIGHT_COMBO.find((x) => x.id === a.id)!;
      // 강공격은 차지 자세(impact×0.55)에서 이어서 시작한다
      const info = actions[slot];
      if (slot === 'heavy') {
        const from = info.impact * 0.55;
        if (t <= def.windup) return { slot, time: from + (t / def.windup) * (info.impact - from) };
      }
      return { slot, time: warpAttack(t, def, info) };
    }
    case 'dodge':
      return { slot: 'dodge', time: (t / DODGE_TICKS) * actions.dodge.clip.duration };
    case 'parry':
      // 방어 자세: 클립 앞 1/3에서 들어 올리고 유지
      return { slot: 'parry', time: Math.min(t / PARRY_TICKS, 1) * actions.parry.clip.duration * 0.35 };
    case 'stagger':
      return { slot: 'stagger', time: (t / PLAYER_STAGGER_TICKS) * actions.stagger.clip.duration };
    case 'dead':
      return { slot: 'dead', time: Math.min(t / 60, 1) * actions.dead.clip.duration };
    default:
      return null;
  }
}
