import {
  AnimationMixer, Box3, Color, ConeGeometry, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  TorusGeometry, Vector3,
  type AnimationAction, type AnimationClip, type Camera, type Material, type Object3D,
} from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { angleDiff, angleToRad } from '../core/trig';
import { GOBLIN_ATTACK } from '../sim/combat';
import { GOBLIN_CAPSULE } from '../sim/enemy';
import { CAPTAIN_CAPSULE, CAPTAIN_COMBO, CHARGE_WINDUP } from '../sim/captain';
import type { Enemy, Sim } from '../sim/types';
import { analyzeLoco, findBone, findImpact, loadGltf, makeSocket } from './character';
import { warpAttack } from './actionTime';

/**
 * 고블린 외형 (렌더 전용). 플레이어와 같은 UAL 마네킹 파일을 캐시에서 복제해 쓴다 — 추가 다운로드 없음.
 * 모리아 고블린: 키 1.4m, 구부정하고 녹회색 피부, 뾰족한 귀, 조잡한 칼. 최종 아트가 오면 이 파일만 바꾼다.
 * 애니메이션은 시뮬레이션 상태(ai, aiTick, swingTick)만 보고 고른다.
 */
const URL = `${import.meta.env.BASE_URL}assets/characters/ual/AnimationLibrary_Godot_Standard.gltf`;
const HEIGHT = 2 * (GOBLIN_CAPSULE.half + GOBLIN_CAPSULE.radius); // 1.4
const MODEL_YAW_OFFSET = Math.PI;
const KCC_OFFSET = 0.02;

type Slot = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'parried' | 'death' | 'aim';
const CLIPS: Record<Slot, string> = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', attack: 'Sword_Attack', aim: 'Pistol_Aim_Neutral',
  hit: 'Hit_Chest', parried: 'Hit_Head', death: 'Death01',
};

/** 스키닝으로 그릴 최대 수 (나머지는 인스턴싱) */
export const SKINNED_MAX = 8;
/** 인스턴싱으로 대신 그릴 고블린 (발밑 위치) */
export type Impostor = { key: number; x: number; y: number; z: number; facing: number; speed: number };

type One = {
  e: Enemy;
  /** 발밑까지 내림 (종류마다 캡슐이 다르다) */
  drop: number;
  /** 대장 돌진 예고 띠 */
  strip: Mesh | null;
  root: Group;
  model: Object3D;
  mixer: AnimationMixer;
  acts: Record<Slot, AnimationAction>;
  w: Record<Slot, number>;
  mats: MeshStandardMaterial[];
  prev: { x: number; y: number; z: number; f: number };
  curr: { x: number; y: number; z: number; f: number };
  flash: number;
  revealed: boolean;
  mark: HTMLDivElement;
  alertUntil: number;
};

export async function createGoblins(sim: Sim, parent: Object3D) {
  const gltf = await loadGltf(URL);
  const clipOf = (n: string): AnimationClip => {
    const c = gltf.animations.find((x) => x.name === n);
    if (!c) throw new Error(`UAL에 ${n} 애니메이션이 없다`);
    return c;
  };
  // 루트 위치 트랙 제거 (몸은 시뮬레이션이 옮긴다)
  const clips = Object.fromEntries(
    (Object.keys(CLIPS) as Slot[]).map((s) => {
      const src = clipOf(CLIPS[s]);
      return [s, src.clone()] as const;
    }),
  ) as Record<Slot, AnimationClip>;
  for (const c of Object.values(clips)) c.tracks = c.tracks.filter((t) => !(t.name.startsWith('root.') && t.name.endsWith('.position')));

  const geos = [new ConeGeometry(0.035, 0.14, 6), new BoxGeometry(0.035, 0.5, 0.012), new CylinderGeometry(0.016, 0.016, 0.14, 6)];
  const earMat = new MeshStandardMaterial({ color: 0x4f5d3c, roughness: 0.9 });
  const bowGeo = new TorusGeometry(0.42, 0.018, 4, 18, Math.PI * 0.85);
  const stringGeo = new BoxGeometry(0.004, 0.78, 0.004);
  const stringMat = new MeshBasicMaterial({ color: 0x9a9080 });
  // 대장 돌진 예고: 바닥의 붉은 띠 (폭 1.6m, 길이 9m — 돌진 거리)
  const stripGeo = new PlaneGeometry(1.6, 9);
  stripGeo.translate(0, 4.5, 0);
  stripGeo.rotateX(-Math.PI / 2); // 눕힌다: 로컬 −Z 방향으로 뻗는다
  const stripMat = new MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0, depthWrite: false });
  const bladeMat = new MeshStandardMaterial({ color: 0x6c6760, roughness: 0.6, metalness: 0.6 });
  const gripMat = new MeshStandardMaterial({ color: 0x2a1d12, roughness: 1 });

  let scale = 1;
  let walkNoSlip = 0.75;
  let runNoSlip = 4.4;
  let impact = 0.4;
  const container = document.body;

  let measured = false;
  /** 고블린 하나의 외형을 만든다. 첫 고블린에서 키·보폭·타격 순간을 재고 나머지는 같은 값을 쓴다 */
  const build = (e: Enemy): One => {
    const first = !measured;
    measured = true;
    const model = cloneSkinned(gltf.scene);
    const mats: MeshStandardMaterial[] = [];
    model.traverse((o) => {
      const m = o as Object3D & { isMesh?: boolean; material?: Material };
      if (!m.isMesh || !m.material) return;
      // 몸(주 재질)은 녹회색 피부, 관절 재질은 해진 가죽
      const skin = m.material.name === 'M_Main';
      // 올리브색(0x4d5a3a)은 주황 횃불빛 아래서 노랗게 보였다(스크린샷) → 더 짙고 채도 높은 녹색
      // 대장: 짙은 피부 + 붉은 천 / 궁수: 조금 밝은 피부 + 가죽
      const color = e.kind === 'captain' ? (skin ? 0x2a3320 : 0x3a100c) : e.kind === 'archer' ? (skin ? 0x34502b : 0x2e2418) : skin ? 0x2c4526 : 0x221a12;
      const mat = new MeshStandardMaterial({ color, roughness: 0.85, emissive: new Color(0, 0, 0) });
      mats.push(mat);
      m.material = mat;
      o.castShadow = true;
      o.frustumCulled = false;
    });
    const mixer = new AnimationMixer(model);
    const pivot = new Group();
    pivot.add(model);
    const root = new Group();
    root.add(pivot);

    // 키 맞추기 + 구부정한 자세(앞으로 8°) — 첫 고블린에서 재고 나머지는 같은 값을 쓴다
    const idle = mixer.clipAction(clips.idle).play();
    mixer.update(0);
    model.updateMatrixWorld(true);
    if (first) {
      const box = new Box3().setFromObject(model, true);
      scale = HEIGHT / (box.max.y - box.min.y);
    }
    // 대장은 키 2.0m (고블린 1.4m의 1.43배), 어깨도 넓게
    const k = e.kind === 'captain' ? (2 * (CAPTAIN_CAPSULE.half + CAPTAIN_CAPSULE.radius)) / HEIGHT : 1;
    model.scale.set(scale * k * (e.kind === 'captain' ? 1.15 : 1.08), scale * k, scale * k * (e.kind === 'captain' ? 1.15 : 1.08));
    pivot.rotation.x = 0.14;
    root.updateMatrixWorld(true);

    // 소품: 뾰족한 귀, 조잡한 칼 (대기 포즈 기준 소켓)
    const head = makeSocket({ root }, findBone(model, 'DEF-head'));
    for (const s of [-1, 1]) {
      const ear = new Mesh(geos[0], earMat);
      ear.position.set(0.1 * s, 0.05, -0.02);
      ear.rotation.set(0, 0, -1.2 * s);
      head.add(ear);
    }
    if (e.kind === 'archer') {
      // 활: 왼손에 휘어진 활대 + 시위
      const handL = makeSocket({ root }, findBone(model, 'DEF-hand.L'));
      const bow = new Group();
      const limb = new Mesh(bowGeo, gripMat);
      limb.rotation.z = Math.PI / 2 + 0.28;
      const string = new Mesh(stringGeo, stringMat);
      string.position.x = -0.14;
      bow.add(limb, string);
      bow.rotation.set(0, Math.PI / 2, 0);
      handL.add(bow);
    } else {
      const hand = makeSocket({ root }, findBone(model, 'DEF-hand.R'));
      const weapon = new Group();
      weapon.rotation.x = 2.3;
      const blade = new Mesh(geos[1], bladeMat);
      blade.position.y = 0.32;
      const grip = new Mesh(geos[2], gripMat);
      weapon.add(blade, grip);
      if (e.kind === 'captain') weapon.scale.setScalar(1.7); // 큰 칼
      hand.add(weapon);
    }
    idle.stop();

    if (first) {
      const feet = ['DEF-foot.L', 'DEF-foot.R'].map((f) => findBone(model, f));
      walkNoSlip = analyzeLoco(model, mixer, clips.walk, feet).noSlip || walkNoSlip;
      runNoSlip = analyzeLoco(model, mixer, clips.run, feet).noSlip || runNoSlip;
      impact = findImpact(model, mixer, clips.attack, findBone(model, 'DEF-hand.R'));
    }

    const acts = {} as Record<Slot, AnimationAction>;
    const w = {} as Record<Slot, number>;
    for (const s of Object.keys(clips) as Slot[]) {
      const a = mixer.clipAction(clips[s]);
      a.enabled = true;
      a.setEffectiveWeight(s === 'idle' ? 1 : 0);
      if (s === 'attack' || s === 'hit' || s === 'parried' || s === 'death') a.timeScale = 0; // 시간을 직접 넣는다
      if (s === 'aim') a.timeScale = 0; // 조준 자세 한 장면 (활을 당긴 모습)
      a.play();
      acts[s] = a;
      w[s] = s === 'idle' ? 1 : 0;
    }

    const mark = document.createElement('div');
    mark.className = 'gob-mark';
    container.appendChild(mark);

    parent.add(root);
    const t = e.body.translation();
    const snap = { x: t.x, y: t.y, z: t.z, f: e.facing };
    const cap = e.kind === 'captain' ? CAPTAIN_CAPSULE : GOBLIN_CAPSULE;
    let strip: Mesh | null = null;
    if (e.kind === 'captain') {
      strip = new Mesh(stripGeo, stripMat.clone());
      strip.visible = false;
      parent.add(strip);
    }
    return { e, drop: cap.half + cap.radius + KCC_OFFSET, strip, root, model, mixer, acts, w, mats, prev: { ...snap }, curr: { ...snap }, flash: 0, revealed: false, mark, alertUntil: 0 };
  };

  const list: One[] = [];
  const byId = new Map<number, One>();
  /**
   * 시뮬레이션의 적 목록과 맞춘다: 디렉터가 새로 부른 고블린은 만들고, 치워진 시체는 지운다.
   * (처음 만든 목록만 쓰면 물결 고블린이 안 보이고 치운 시체가 남는다)
   */
  const sync = () => {
    for (const e of sim.enemies) {
      if (e.kind === 'troll' || byId.has(e.id)) continue; // 트롤은 render/troll.ts (고블린·궁수·대장은 여기)
      const g = build(e);
      list.push(g);
      byId.set(e.id, g);
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i]!;
      if (sim.enemies.includes(g.e)) continue; // (고블린만 목록에 있다)
      g.mixer.stopAllAction();
      g.mixer.uncacheRoot(g.model);
      g.root.removeFromParent();
      g.mark.remove();
      for (const m of g.mats) m.dispose();
      list.splice(i, 1);
      byId.delete(g.e.id);
    }
  };
  sync();
  const v = new Vector3();
  const near: One[] = [];
  let clock = 0;

  return {
    /** 시뮬레이션 한 틱 뒤에 호출 — 보간용 스냅샷 */
    capture() {
      sync();
      for (const g of list) {
        g.prev = g.curr;
        const t = g.e.body.translation();
        g.curr = { x: t.x, y: t.y, z: t.z, f: g.e.facing };
      }
    },
    /** 시뮬레이션 사건 반영 (피격 번쩍임, 경계 표시) */
    onEvent(ev: Sim['events'][number]) {
      if (ev.type === 'hit') {
        const g = byId.get(ev.target);
        if (g) g.flash = 1;
      } else if (ev.type === 'alert') {
        const g = byId.get(ev.enemy);
        if (g) g.alertUntil = clock + 1.6;
      }
    },
    /** 돌의 감각: 음파가 지나간 반경 안에서 움직이는 고블린을 청백색으로 드러낸다 (멈춰 있으면 안 보인다) */
    sense: { x: 0, z: 0, radius: 0, strength: 0 },
    /**
     * seen: 그 자리가 지금 보이는 방인가 (포털 컬링 결과). 안 보이면 그리지도, 애니메이션을 돌리지도 않는다.
     * impostors: 렌더 LOD — 가까운 SKINNED_MAX마리만 스키닝으로 그리고, 나머지 살아 있는 고블린은 이 목록에 넣어
     * 무리와 같은 인스턴싱 메시(VAT)로 그린다 (물결 때 승격한 수십 마리가 draw call을 폭증시키지 않게). 멀리 있는 시체는 숨긴다.
     */
    update(
      dt: number, alpha: number, camera: Camera, seen: (x: number, y: number, z: number) => boolean = () => true,
      impostors: Impostor[] | null = null,
      maxSkinned = SKINNED_MAX,
    ) {
      clock += dt;
      // 가까운 순서 (카메라 기준) — 앞 SKINNED_MAX마리만 스키닝
      near.length = 0;
      for (const g of list) near.push(g);
      const cx = camera.position.x, cz = camera.position.z;
      const d2 = (g: One) => (g.curr.x - cx) ** 2 + (g.curr.z - cz) ** 2;
      if (impostors && list.length > maxSkinned) near.sort((a, b) => d2(a) - d2(b));
      const skinned = new Set(impostors ? near.slice(0, maxSkinned) : near);
      for (const g of list) if (g.e.kind === 'captain') skinned.add(g); // 보스는 늘 제 모습으로
      for (const g of list) {
        const e = g.e;
        // 위치·방향 보간
        const x = g.prev.x + (g.curr.x - g.prev.x) * alpha;
        const y = g.prev.y + (g.curr.y - g.prev.y) * alpha;
        const z = g.prev.z + (g.curr.z - g.prev.z) * alpha;
        g.root.visible = seen(x, y, z) && skinned.has(g);
        if (!g.root.visible) {
          g.mark.style.display = 'none';
          if (impostors && e.ai !== 'dead' && seen(x, y, z)) {
            impostors.push({ key: -1 - e.id, x, y: y - g.drop, z, facing: g.prev.f + angleDiff(g.prev.f, g.curr.f) * alpha, speed: Math.hypot(e.vx, e.vz) });
          }
          continue;
        }
        g.root.position.set(x, y - g.drop, z);
        // 대장 돌진 예고: 겨누는 동안 띠가 차오르고, 방향이 고정되면 가장 진하다
        if (g.strip) {
          const on = e.ai === 'attack' && e.move === 'charge' && e.swingTick < CHARGE_WINDUP;
          g.strip.visible = on;
          if (on) {
            g.strip.position.set(x, y - g.drop + 0.05, z);
            g.strip.rotation.y = Math.atan2(-e.aimX, -e.aimZ);
            (g.strip.material as MeshBasicMaterial).opacity = 0.25 + 0.5 * Math.min(1, (e.swingTick + alpha) / CHARGE_WINDUP);
          }
        }
        g.root.rotation.y = angleToRad(g.prev.f + angleDiff(g.prev.f, g.curr.f) * alpha) + MODEL_YAW_OFFSET;

        // 애니메이션 슬롯 선택
        const target: Partial<Record<Slot, number>> = {};
        const speed = Math.hypot(e.vx, e.vz);
        if (e.ai === 'dead') {
          target.death = 1;
          g.acts.death.time = Math.min(e.aiTick / 70, 1) * (clips.death.duration - 1e-3);
        } else if (e.ai === 'stagger') {
          const s: Slot = e.staggerLen > 20 ? 'parried' : 'hit';
          target[s] = 1;
          g.acts[s].time = Math.min(e.aiTick / e.staggerLen, 1) * (clips[s].duration - 1e-3);
        } else if (e.kind === 'archer' && e.ai === 'attack') {
          // 활 당기기: 조준 자세
          target.aim = 1;
          g.acts.aim.time = Math.min(0.2, clips.aim.duration - 1e-3);
        } else if (e.kind === 'captain' && e.ai === 'attack' && e.move === 'charge') {
          // 돌진: 겨누는 동안 칼을 치켜든 자세 → 달리기 → 회복
          if (e.swingTick < CHARGE_WINDUP) {
            target.attack = 1;
            g.acts.attack.time = impact * 0.45;
          } else if (speed > 2) target.run = 1;
          else target.idle = 1;
        } else if (e.ai === 'attack' && e.swingTick >= 0) {
          target.attack = 1;
          const def = e.kind === 'captain' ? CAPTAIN_COMBO[e.step] ?? GOBLIN_ATTACK : GOBLIN_ATTACK;
          g.acts.attack.time = Math.min(warpAttack(e.swingTick + alpha, def, { clip: clips.attack, impact }), clips.attack.duration - 1e-3);
        } else if (speed < 0.2) target.idle = 1;
        else if (speed < 2.2) {
          const k = Math.min(1, speed / 1.6);
          target.idle = 1 - k;
          target.walk = k;
        } else {
          const k = Math.min(1, (speed - 2.2) / 1.6);
          target.walk = 1 - k;
          target.run = k;
        }
        g.acts.walk.timeScale = Math.min(1.8, Math.max(0.5, speed / walkNoSlip));
        g.acts.run.timeScale = Math.min(1.6, Math.max(0.6, speed / runNoSlip));

        const k = dt > 0 ? 1 - Math.exp(-14 * dt) : 0;
        for (const s of Object.keys(g.acts) as Slot[]) {
          g.w[s] += ((target[s] ?? 0) - g.w[s]) * k;
          if ((target[s] ?? 0) === 1 && g.w[s] < 0.05) g.w[s] = 0.05;
          g.acts[s].setEffectiveWeight(g.w[s]);
        }
        g.mixer.update(dt);

        // 피격 번쩍임(주황) + 돌의 감각 드러남(청백)
        const sv = this.sense;
        const inWave = sv.strength > 0 && e.ai !== 'dead' && speed > 0.5 && (x - sv.x) ** 2 + (z - sv.z) ** 2 < sv.radius * sv.radius;
        const reveal = inWave ? sv.strength * 0.6 : 0;
        if (g.flash > 0 || reveal > 0 || g.revealed) {
          g.flash = Math.max(0, g.flash - dt * 7);
          for (const m of g.mats) m.emissive.setRGB(g.flash * 0.9 + reveal * 0.35, g.flash * 0.35 + reveal * 0.55, g.flash * 0.2 + reveal * 0.8);
          g.revealed = reveal > 0;
        }

        // 머리 위 표시: ? (의심) / ! (경계 직후) — 죽거나 화면 밖이면 숨긴다
        const suspicious = e.ai === 'suspicious' || (e.ai === 'patrol' && e.awareness > 0.2);
        const text = e.ai === 'dead' ? '' : clock < g.alertUntil ? '!' : suspicious ? '?' : '';
        if (text) {
          v.set(x, y + HEIGHT * 0.65, z).project(camera);
          const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
          g.mark.style.display = on ? 'block' : 'none';
          if (on) {
            g.mark.textContent = text;
            g.mark.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
            g.mark.style.opacity = text === '?' ? String(0.35 + Math.min(1, e.awareness) * 0.65) : '1';
          }
        } else g.mark.style.display = 'none';
      }
    },
    /** 락온 표시용: 적 id → 화면 좌표 (없으면 null) */
    screenPos(id: number, camera: Camera): { x: number; y: number } | null {
      const g = byId.get(id);
      if (!g) return null;
      v.set(g.root.position.x, g.root.position.y + HEIGHT * 0.55, g.root.position.z).project(camera);
      if (v.z >= 1) return null;
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    },
  };
}
