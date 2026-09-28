import { LoopOnce, type AnimationAction } from 'three/webgpu';
import type { ClassStats } from '../sim/classes';
import { FULL_BODY, type ActionSlot, type CharacterRig, type LocoSlot } from './character';

/**
 * 캐릭터 애니메이션 컨트롤러 (렌더 전용). 시뮬레이션 상태만 보고 포즈를 정한다.
 *
 * 이동 레이어
 *  - 1D 블렌드: 속도에 따라 대기 → 걷기 → 조깅 → 질주 (웅크리면 웅크린 대기 → 웅크려 걷기)
 *  - 무미끄럼: 각 클립 재생 배속 = 실제 속도 / 그 클립의 무미끄럼 속도(로드할 때 실측)
 *  - 발 위상 동기화: 모든 보행 클립을 하나의 공유 위상 φ로 돌리고, 클립마다 왼발 접지 시점을 맞춘다
 *  - 낙하(0.12초 이상 공중) · 착지(0.3초 이상 떨어졌을 때) · 기울임(가속·선회)
 * 행동 레이어 (전투)
 *  - 시뮬레이션이 정한 행동 슬롯과 클립 시간을 그대로 받는다 (시간 왜곡은 main의 actionTime)
 *  - 행동 가중치만큼 이동 레이어를 누르고, 전신 동작(구르기·피격·사망)이면 횃불 팔 레이어도 내린다
 */

const LOCO_ORDER: readonly LocoSlot[] = ['idle', 'walk', 'jog', 'sprint'];
const CROUCH_ORDER: readonly LocoSlot[] = ['crouchIdle', 'crouchWalk'];
const CYCLE_SLOTS: readonly LocoSlot[] = ['walk', 'jog', 'sprint', 'crouchWalk'];
const FADE_RATE = 9; // 이동 가중치 수렴 속도 (1/s) — 약 0.2초 크로스페이드
const ACTION_FADE_RATE = 30; // 행동은 빠르게 (약 0.07초) — 입력 반응이 먼저다
const MIN_RATE = 0.55;
const MAX_RATE = 1.75; // 이보다 빠르게 돌리면 다리가 파닥거린다 → 약간의 미끄럼을 허용
const FALL_DELAY = 0.12; // s — 계단 한 칸 내려갈 때는 낙하 포즈를 쓰지 않는다
const LAND_MIN_AIR = 0.3; // s
const MAX_LEAN = 0.14; // rad ≈ 8°
const MAX_BANK = 0.16;

export type LocoInput = {
  /** 수평 속력 m/s */
  speed: number;
  grounded: boolean;
  crouching: boolean;
  airTime: number;
  /** 이번 프레임에 착지했다면 체공 시간(s), 아니면 0 */
  landedAir: number;
  /** 몸 앞 방향 가속 (m/s²) */
  forwardAccel: number;
  /** 몸 회전 속도 (rad/s, 왼쪽 +) */
  turnRate: number;
};

export type ActionPose = { slot: ActionSlot; time: number } | null;

export function createLocomotion(rig: CharacterRig, stats: ClassStats) {
  const actions = {} as Record<LocoSlot, AnimationAction>;
  const weight = {} as Record<LocoSlot, number>;
  for (const slot of Object.keys(rig.loco) as LocoSlot[]) {
    const a = rig.mixer.clipAction(rig.loco[slot].clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    if (CYCLE_SLOTS.includes(slot)) a.timeScale = 0; // 시간을 직접 넣는다 (위상 동기화)
    if (slot === 'land') {
      a.setLoop(LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.play();
    actions[slot] = a;
    weight[slot] = slot === 'idle' ? 1 : 0;
  }
  actions.idle.setEffectiveWeight(1);

  // 행동 레이어: 모든 클립을 미리 재생해 두고 가중치·시간만 바꾼다
  const acts = {} as Record<ActionSlot, AnimationAction>;
  const actW = {} as Record<ActionSlot, number>;
  for (const slot of Object.keys(rig.actions) as ActionSlot[]) {
    const a = rig.mixer.clipAction(rig.actions[slot].clip);
    a.enabled = true;
    a.timeScale = 0;
    a.setEffectiveWeight(0);
    a.play();
    acts[slot] = a;
    actW[slot] = 0;
  }
  const torch = rig.torchLayer ? rig.mixer.clipAction(rig.torchLayer) : null;
  torch?.play();

  let phase = 0;
  let landWeight = 0;
  /** 무기를 쓰는 동작(공격·패링)의 합계 가중치 — 검 쥔 방향을 섞을 때 */
  let weaponActW = 0;
  let lean = 0;
  let bank = 0;

  /** 속도 v를 슬롯 순서 [s0, s1, …]의 기준 속도 사이에서 선형 보간한 목표 가중치 */
  function blend(order: readonly LocoSlot[], speeds: readonly number[], v: number, out: Partial<Record<LocoSlot, number>>) {
    if (v <= speeds[0]!) {
      out[order[0]!] = 1;
      return;
    }
    for (let i = 1; i < order.length; i++) {
      if (v <= speeds[i]! || i === order.length - 1) {
        const t = Math.min(1, (v - speeds[i - 1]!) / (speeds[i]! - speeds[i - 1]!));
        out[order[i - 1]!] = 1 - t;
        out[order[i]!] = t;
        return;
      }
    }
  }

  return {
    update(dt: number, s: LocoInput, action: ActionPose = null) {
      // --- 행동 레이어 ---
      const ka = 1 - Math.exp(-ACTION_FADE_RATE * dt);
      let actTotal = 0;
      let fullBody = 0;
      for (const slot of Object.keys(acts) as ActionSlot[]) {
        const target = action?.slot === slot ? 1 : 0;
        actW[slot] += (target - actW[slot]) * (dt > 0 ? ka : 0);
        if (target === 1 && actW[slot] < 0.05) actW[slot] = 0.05; // 시작 프레임부터 조금은 보이게
        if (action?.slot === slot) acts[slot].time = Math.min(action.time, rig.actions[slot].clip.duration - 1e-3);
        actTotal += actW[slot];
        if (FULL_BODY.has(slot)) fullBody += actW[slot];
      }
      actTotal = Math.min(1, actTotal);
      weaponActW = Math.min(1, actTotal - fullBody);
      for (const slot of Object.keys(acts) as ActionSlot[]) acts[slot].setEffectiveWeight(actW[slot]);
      torch?.setEffectiveWeight(1 - Math.min(1, fullBody));

      // --- 이동 레이어 ---
      const target: Partial<Record<LocoSlot, number>> = {};
      const inAir = !s.grounded && s.airTime > FALL_DELAY;
      if (inAir) target.fall = 1;
      else if (s.crouching) blend(CROUCH_ORDER, [0.1, stats.crouchSpeed], s.speed, target);
      else blend(LOCO_ORDER, [0.15, stats.walkSpeed, stats.jogSpeed, stats.sprintSpeed], s.speed, target);

      if (s.landedAir >= LAND_MIN_AIR) {
        actions.land.reset().play();
        landWeight = Math.min(1, 0.4 + s.landedAir);
      }
      landWeight = Math.max(0, landWeight - dt * 2.5);

      const k = 1 - Math.exp(-FADE_RATE * dt);
      let cycleRate = 0;
      let cycleW = 0;
      for (const slot of Object.keys(actions) as LocoSlot[]) {
        if (slot === 'land') continue;
        weight[slot] += ((target[slot] ?? 0) - weight[slot]) * k;
        const info = rig.loco[slot];
        if (CYCLE_SLOTS.includes(slot) && weight[slot] > 0.001 && info.noSlip > 0) {
          const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, s.speed / info.noSlip));
          cycleRate += weight[slot] * (rate / info.clip.duration);
          cycleW += weight[slot];
        }
      }
      if (cycleW > 0) phase = (phase + (cycleRate / cycleW) * dt) % 1;
      for (const slot of CYCLE_SLOTS) {
        const info = rig.loco[slot];
        actions[slot].time = (((phase + info.footPhase) % 1) + 1) % 1 * info.clip.duration;
      }

      const rest = (1 - landWeight) * (1 - actTotal);
      for (const slot of Object.keys(actions) as LocoSlot[]) {
        actions[slot].setEffectiveWeight(slot === 'land' ? landWeight * (1 - actTotal) : weight[slot] * rest);
      }

      // 기울임: 행동 중에는 줄인다 (공격 동작 자체가 몸을 쓴다)
      const leanT = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, s.forwardAccel * 0.012)) * (1 - actTotal);
      const bankT = Math.max(-MAX_BANK, Math.min(MAX_BANK, -s.turnRate * s.speed * 0.012)) * (1 - actTotal);
      const kl = 1 - Math.exp(-8 * dt);
      lean += (leanT - lean) * kl;
      bank += (bankT - bank) * kl;
      rig.pivot.rotation.set(lean, 0, bank);

      rig.mixer.update(dt);
    },
    weaponActionWeight: () => Math.max(0, weaponActW),
    /** 디버그 표시용 */
    debug: () => ({
      phase: +phase.toFixed(2),
      // 착지 가중치는 weight 표가 아니라 landWeight에 있다 (별도 원샷 레이어)
      w: { ...Object.fromEntries(Object.entries(weight).map(([k2, v]) => [k2, +v.toFixed(2)])), land: +landWeight.toFixed(2) },
      act: Object.fromEntries(Object.entries(actW).filter(([, v]) => v > 0.01).map(([k2, v]) => [k2, +v.toFixed(2)])),
    }),
  };
}
