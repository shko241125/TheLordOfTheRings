import {
  AnimationMixer, Box3, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry,
  SphereGeometry, Vector3, type AnimationAction, type Camera, type AnimationClip, type Material, type Object3D,
} from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { angleDiff, angleToRad } from '../core/trig';
import { SLAM_RADIUS, TROLL_CAPSULE, TROLL_HP, TROLL_SLAM, TROLL_SWEEP } from '../sim/troll';
import type { Enemy, Sim } from '../sim/types';
import { warpAttack } from './actionTime';
import { findBone, loadGltf, makeSocket, type ActionInfo } from './character';

/**
 * 동굴 트롤 외형 (렌더 전용). 플레이어·고블린과 같은 UAL 마네킹을 키 3.3m·어깨 1.35배로 키우고 몽둥이를 쥐여 준다.
 * 기술 애니메이션은 플레이어용으로 이미 UAL 골격에 리타게팅한 클립을 빌린다 — 강공격(KayKit 2H 내려찍기) = 내려찍기,
 * 수평 베기 = 휘두르기. 추가 다운로드 없음. 잠은 UAL의 앉아 있기.
 * 예고: 내려찍기 예비 동작(1초) 동안 겨냥점 바닥에 붉은 고리가 차오른다 — 어디로 피할지 읽히게.
 */
const URL = `${import.meta.env.BASE_URL}assets/characters/ual/AnimationLibrary_Godot_Standard.gltf`;
const HEIGHT = 2 * (TROLL_CAPSULE.half + TROLL_CAPSULE.radius);
const MODEL_YAW_OFFSET = Math.PI;
const KCC_OFFSET = 0.02;

type Slot = 'sleep' | 'idle' | 'walk' | 'slam' | 'sweep' | 'hit' | 'death';

export async function createTrolls(sim: Sim, parent: Object3D, borrowed: { slam: ActionInfo; sweep: ActionInfo } | null) {
  const gltf = await loadGltf(URL);
  const clip = (n: string): AnimationClip => {
    const c = gltf.animations.find((x) => x.name === n);
    if (!c) throw new Error(`UAL에 ${n} 애니메이션이 없다`);
    const k = c.clone();
    k.tracks = k.tracks.filter((t) => !(t.name.startsWith('root.') && t.name.endsWith('.position')));
    return k;
  };
  // 플레이어 리그가 UAL이 아니면(?rig=kaykit) 골격이 달라 빌릴 수 없다 → UAL 검 공격으로 대신
  const fallback: ActionInfo = { clip: clip('Sword_Attack'), impact: 0.45 };
  const slamInfo = borrowed?.slam ?? fallback;
  const sweepInfo = borrowed?.sweep ?? fallback;
  const clips: Record<Slot, AnimationClip> = {
    sleep: clip('Sitting_Idle_Loop'), idle: clip('Idle_Loop'), walk: clip('Walk_Loop'),
    slam: slamInfo.clip, sweep: sweepInfo.clip, hit: clip('Hit_Chest'), death: clip('Death01'),
  };

  const skin = new MeshStandardMaterial({ color: 0x24321d, roughness: 0.95, emissive: new Color(0, 0, 0) });
  const hide = new MeshStandardMaterial({ color: 0x2b2118, roughness: 1 });
  const clubMat = new MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  const clubGeo = new CylinderGeometry(0.11, 0.24, 1.7, 8);
  const knobGeo = new SphereGeometry(0.3, 10, 8);
  const ringGeo = new RingGeometry(SLAM_RADIUS - 0.18, SLAM_RADIUS, 48);
  const ringFill = new RingGeometry(0, SLAM_RADIUS, 48);
  const ringMat = new MeshBasicMaterial({ color: 0xff4a1a, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });
  const fillMat = new MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0, side: DoubleSide, depthWrite: false });

  type One = {
    e: Enemy; root: Group; model: Object3D; mixer: AnimationMixer; acts: Record<Slot, AnimationAction>; w: Record<Slot, number>;
    prev: { x: number; y: number; z: number; f: number }; curr: { x: number; y: number; z: number; f: number };
    ring: Group; flash: number; bones: [Object3D, number][];
  };
  /**
   * 트롤 체형: 클립에 뼈 크기 트랙이 있어 믹서가 매 프레임 덮어쓴다 → mixer.update 뒤에 다시 준다.
   * 배 1.25 × 가슴 1.1 (팔·머리가 물려받아 굵고 길어진다), 머리 0.6 (물려받은 1.375배를 되돌려 작은 머리).
   */
  const BODY: [string, number][] = [['DEF-spine.001', 1.25], ['DEF-spine.002', 1.1], ['DEF-head', 0.6]];

  const build = (e: Enemy): One => {
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      const m = o as Object3D & { isMesh?: boolean; material?: Material };
      if (!m.isMesh || !m.material) return;
      m.material = m.material.name === 'M_Main' ? skin : hide;
      o.castShadow = true;
      o.frustumCulled = false;
    });
    const mixer = new AnimationMixer(model);
    const pivot = new Group();
    pivot.add(model);
    const root = new Group();
    root.add(pivot);
    const idle = mixer.clipAction(clips.idle).play();
    mixer.update(0);
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model, true);
    const s = HEIGHT / (box.max.y - box.min.y);
    model.scale.set(s * 1.2, s, s * 1.2); // 떡 벌어진 몸 (가슴·배는 뼈 크기로 더 키운다)
    pivot.rotation.x = 0.18; // 구부정하게
    root.updateMatrixWorld(true);
    const hand = makeSocket({ root }, findBone(model, 'DEF-hand.R'));
    const club = new Group();
    club.rotation.x = 2.2;
    const shaft = new Mesh(clubGeo, clubMat);
    shaft.position.y = 0.7;
    const knob = new Mesh(knobGeo, clubMat);
    knob.position.y = 1.5;
    shaft.castShadow = knob.castShadow = true;
    club.add(shaft, knob);
    hand.add(club);
    idle.stop();

    const acts = {} as Record<Slot, AnimationAction>;
    const w = {} as Record<Slot, number>;
    for (const k of Object.keys(clips) as Slot[]) {
      const a = mixer.clipAction(clips[k]);
      a.enabled = true;
      a.setEffectiveWeight(0);
      if (k === 'slam' || k === 'sweep' || k === 'hit' || k === 'death') a.timeScale = 0; // 시간을 직접 넣는다
      if (k === 'walk') a.timeScale = 0.75; // 큰 몸의 느린 걸음
      a.play();
      acts[k] = a;
      w[k] = 0;
    }
    // 예고 고리 (바닥에 눕힌다)
    const ring = new Group();
    const edge = new Mesh(ringGeo, ringMat);
    const fill = new Mesh(ringFill, fillMat);
    for (const m of [edge, fill]) {
      m.rotation.x = -Math.PI / 2;
      ring.add(m);
    }
    ring.visible = false;
    parent.add(root, ring);
    const t = e.body.translation();
    const snap = { x: t.x, y: t.y, z: t.z, f: e.facing };
    const bones = BODY.map(([n, k]) => [findBone(model, n), k] as [Object3D, number]);
    return { e, root, model, mixer, acts, w, prev: { ...snap }, curr: { ...snap }, ring, flash: 0, bones };
  };

  const list = sim.enemies.filter((e) => e.kind === 'troll').map(build);
  const drop = TROLL_CAPSULE.half + TROLL_CAPSULE.radius + KCC_OFFSET;
  const v = new Vector3();

  return {
    /** 틱마다: 보간 스냅샷 */
    capture() {
      for (const g of list) {
        g.prev = g.curr;
        const t = g.e.body.translation();
        g.curr = { x: t.x, y: t.y, z: t.z, f: g.e.facing };
      }
    },
    onEvent(ev: Sim['events'][number]) {
      if (ev.type === 'hit') {
        const g = list.find((x) => x.e.id === ev.target);
        if (g) g.flash = 1;
      }
    },
    update(dt: number, alpha: number, seen: (x: number, y: number, z: number) => boolean) {
      for (const g of list) {
        const e = g.e;
        const x = g.prev.x + (g.curr.x - g.prev.x) * alpha;
        const y = g.prev.y + (g.curr.y - g.prev.y) * alpha;
        const z = g.prev.z + (g.curr.z - g.prev.z) * alpha;
        g.root.visible = seen(x, y, z);
        g.ring.visible = false;
        if (!g.root.visible) continue;
        g.root.position.set(x, y - drop, z);
        g.root.rotation.y = angleToRad(g.prev.f + angleDiff(g.prev.f, g.curr.f) * alpha) + MODEL_YAW_OFFSET;

        const target: Partial<Record<Slot, number>> = {};
        const speed = Math.hypot(e.vx, e.vz);
        if (e.ai === 'dead') {
          target.death = 1;
          g.acts.death.time = Math.min(e.aiTick / 90, 1) * (clips.death.duration - 1e-3);
        } else if (e.ai === 'patrol') target.sleep = 1;
        else if (e.ai === 'stagger') {
          target.hit = 1;
          // 기둥에 박힌 긴 휘청임은 클립을 천천히 되감듯 끝까지 늘린다
          g.acts.hit.time = Math.min(e.aiTick / e.staggerLen, 1) * (clips.hit.duration - 1e-3);
        } else if (e.ai === 'attack' && (e.move === 'slam' || e.move === 'sweep')) {
          const a = e.move === 'slam' ? TROLL_SLAM : TROLL_SWEEP;
          target[e.move] = 1;
          g.acts[e.move].time = Math.min(warpAttack(e.swingTick + alpha, a, e.move === 'slam' ? slamInfo : sweepInfo), clips[e.move].duration - 1e-3);
          if (e.move === 'slam' && e.swingTick < a.windup) {
            // 예고 고리: 겨냥점에서 1초 동안 차오른다
            const k = (e.swingTick + alpha) / a.windup;
            g.ring.visible = true;
            g.ring.position.set(e.aimX, y - drop + 0.04, e.aimZ);
            ringMat.opacity = 0.35 + 0.55 * k;
            fillMat.opacity = 0.25 * k * k;
            g.ring.children[1]!.scale.setScalar(Math.max(0.01, k));
          }
        } else if (speed < 0.2) target.idle = 1;
        else target.walk = 1;

        const k = dt > 0 ? 1 - Math.exp(-10 * dt) : 0;
        for (const s of Object.keys(g.acts) as Slot[]) {
          g.w[s] += ((target[s] ?? 0) - g.w[s]) * k;
          if ((target[s] ?? 0) === 1 && g.w[s] < 0.05) g.w[s] = 0.05;
          g.acts[s].setEffectiveWeight(g.w[s]);
        }
        g.mixer.update(dt);
        for (const [b, k] of g.bones) b.scale.setScalar(k);
        if (g.flash > 0) {
          g.flash = Math.max(0, g.flash - dt * 6);
          skin.emissive.setRGB(g.flash * 0.6, g.flash * 0.25, g.flash * 0.1);
        }
      }
    },
    /** 색각 보정: 빨강 예고 고리 → 노랑 (적록 색약에서 어두운 바닥의 빨강은 잘 안 보인다) */
    setPalette(colorSafe: boolean) {
      ringMat.color.set(colorSafe ? 0xffe14a : 0xff4a1a);
      fillMat.color.set(colorSafe ? 0xffd21a : 0xff3a10);
    },
    /** 락온 표식 위치 (가슴 높이) */
    screenPos(id: number, camera: Camera): { x: number; y: number } | null {
      const g = list.find((x) => x.e.id === id);
      if (!g) return null;
      v.set(g.root.position.x, g.root.position.y + HEIGHT * 0.6, g.root.position.z).project(camera);
      if (v.z >= 1) return null;
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    },
    /** HUD 보스 체력바용 */
    boss(): { name: string; hp: number; max: number; awake: boolean } | null {
      const g = list[0];
      if (!g) return null;
      const e = g.e;
      return { name: '동굴 트롤', hp: e.hp, max: TROLL_HP, awake: e.ai !== 'patrol' && e.ai !== 'dead' && e.ai !== 'suspicious' };
    },
  };
}
