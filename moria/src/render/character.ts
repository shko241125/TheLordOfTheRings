import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  PropertyBinding,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { KAYKIT_TO_UAL, UAL_KEEP, retargetClip } from './retarget';
import type { ClassId } from '../sim/classes';

/**
 * 플레이어 캐릭터 외형 (렌더 전용 — 시뮬레이션은 이 파일을 모른다).
 *
 * 리그 두 가지 (둘 다 CC0):
 *  - ual: Quaternius Universal Animation Library 마네킹. 사실적 비율 → 게임 이동 속도와 애니메이션 보폭이 맞는다(기본값).
 *  - kaykit: KayKit Adventurers 1.0. 완성된 의상·무기, 전투 동작이 많지만 SD 비율이라 보폭이 짧다(비교용, ?rig=kaykit).
 * 두 리그 실측(1.8m 환산, 접지 구간 발 속도): UAL 걷기 0.94·조깅 5.6·질주 5.9 m/s, KayKit 걷기 0.62·달리기 2.65 m/s.
 */
export type RigId = 'ual' | 'kaykit';

/** 이동 애니메이션 슬롯 → 클립 이름 */
export type LocoSlot = 'idle' | 'walk' | 'jog' | 'sprint' | 'crouchIdle' | 'crouchWalk' | 'fall' | 'land';
/** 행동(전투) 슬롯. 시뮬레이션의 action/attack id와 1:1 */
export type ActionSlot = 'light1' | 'light2' | 'light3' | 'light4' | 'heavy' | 'dodge' | 'parry' | 'stagger' | 'dead';
/** 전신 동작 — 횃불 팔 레이어를 끄고 클립 전체를 쓴다 (구르기·피격·사망) */
export const FULL_BODY: ReadonlySet<ActionSlot> = new Set<ActionSlot>(['dodge', 'stagger', 'dead']);

type RigDef = {
  /** 클래스별 파일 (UAL은 한 파일을 공유하고 복장으로 구분) */
  url: (c: ClassId) => string;
  feet: readonly [string, string];
  torchHand: string;
  weaponHand: string;
  head: string;
  chest: string;
  clips: Record<LocoSlot, string>;
  /**
   * 전투 동작 클립. UAL 무료판에는 무기 공격이 Sword_Attack 하나뿐이라(실측: 휘두르기 1회, 0.40초) 4타 모두 같은 클립을 쓴다
   * — 자리표시. KayKit은 4종(내려찍기·대각·수평·찌르기)이 있다.
   */
  actions: Record<ActionSlot, string | { kaykit: string; mirror?: boolean }>;
  /** 타격 순간(손이 가장 빠른 때)을 잴 무기 손 */
  weaponHandForImpact: string;
  /** 횃불 든 팔 자세를 가져올 클립과 그 팔의 뼈 이름 접두사. 이동 클립에서는 이 뼈들의 트랙을 뺀다. */
  torchPose?: { clip: string; bonePrefixes: readonly string[] };
  /** 클래스별로 보일 부착 메시 (KayKit 전용) */
  keep?: (c: ClassId) => readonly string[];
};

const BASE = import.meta.env.BASE_URL;

export const RIGS: Record<RigId, RigDef> = {
  ual: {
    url: () => `${BASE}assets/characters/ual/AnimationLibrary_Godot_Standard.gltf`,
    feet: ['DEF-foot.L', 'DEF-foot.R'],
    torchHand: 'DEF-hand.L',
    weaponHand: 'DEF-hand.R',
    head: 'DEF-head',
    chest: 'DEF-spine.003',
    clips: {
      idle: 'Idle_Torch_Loop',
      walk: 'Walk_Loop',
      jog: 'Jog_Fwd_Loop',
      sprint: 'Sprint_Loop',
      crouchIdle: 'Crouch_Idle_Loop',
      crouchWalk: 'Crouch_Fwd_Loop',
      fall: 'Jump_Loop',
      land: 'Jump_Land',
    },
    // 무료판에는 무기 공격이 Sword_Attack 하나뿐(실측) → 전투 동작은 KayKit에서 리타게팅해 온다 (render/retarget.ts)
    actions: {
      light1: { kaykit: '1H_Melee_Attack_Chop' },
      light2: { kaykit: '1H_Melee_Attack_Slice_Diagonal' },
      light3: { kaykit: '1H_Melee_Attack_Slice_Horizontal' },
      light4: { kaykit: '1H_Melee_Attack_Stab' },
      heavy: { kaykit: '2H_Melee_Attack_Chop' },
      dodge: { kaykit: 'Dodge_Forward' },
      parry: { kaykit: 'Block', mirror: true }, // 방패 막기(왼팔) → 좌우 반전해 검 막기(오른팔)
      stagger: 'Hit_Chest',
      dead: 'Death01',
    },
    weaponHandForImpact: 'DEF-hand.R',
    torchPose: {
      clip: 'Idle_Torch_Loop',
      bonePrefixes: ['DEF-shoulder.L', 'DEF-upper_arm.L', 'DEF-forearm.L', 'DEF-hand.L', 'DEF-f_', 'DEF-thumb'].map((n) => n),
    },
  },
  kaykit: {
    url: (c) => `${BASE}assets/characters/${{ human: 'Knight', dwarf: 'Barbarian', elf: 'Rogue_Hooded' }[c]}.glb`,
    feet: ['foot.l', 'foot.r'],
    torchHand: 'handslot.l',
    weaponHand: 'handslot.r',
    head: 'head',
    chest: 'chest',
    clips: {
      idle: 'Idle',
      walk: 'Walking_A',
      jog: 'Running_A',
      sprint: 'Running_A',
      crouchIdle: 'Idle',
      crouchWalk: 'Walking_C',
      fall: 'Jump_Idle',
      land: 'Jump_Land',
    },
    actions: {
      light1: '1H_Melee_Attack_Chop', light2: '1H_Melee_Attack_Slice_Diagonal', light3: '1H_Melee_Attack_Slice_Horizontal',
      light4: '1H_Melee_Attack_Stab', heavy: '2H_Melee_Attack_Chop', dodge: 'Dodge_Forward', parry: 'Blocking',
      stagger: 'Hit_A', dead: 'Death_A',
    },
    weaponHandForImpact: 'hand.r',
    keep: (c) =>
      ({
        human: ['Knight_Helmet', 'Knight_Cape', '1H_Sword'],
        dwarf: ['Barbarian_Hat', 'Barbarian_Cape', '1H_Axe'],
        elf: ['Rogue_Cape', 'Knife'],
      })[c],
  },
};

/** 목표 키 (m). 원작 설정: 인간 ~1.8, 드워프 ~1.4, 엘프 ~1.9. 시뮬레이션 캡슐(classes.ts)과 같다. */
export const CLASS_HEIGHT: Record<ClassId, number> = { human: 1.8, dwarf: 1.4, elf: 1.88 };
/** 체형: 가로(x·z) 배율. 드워프는 단단하고 넓게, 엘프는 가늘게. */
const CLASS_BUILD: Record<ClassId, number> = { human: 1, dwarf: 1.2, elf: 0.92 };

export type LocoInfo = {
  clip: AnimationClip;
  /** 발이 미끄러지지 않는 이동 속도 (m/s, 게임 스케일). 제자리 동작이면 0 */
  noSlip: number;
  /** 왼발이 땅에 닿는 순간의 정규화 시간 (0..1). 클립끼리 발 위상을 맞출 때 쓴다 */
  footPhase: number;
};

export type ActionInfo = {
  clip: AnimationClip;
  /** 타격 순간 (s) — 무기 손 속도가 최대인 시점. 시뮬레이션 판정 시작 틱에 맞춘다 */
  impact: number;
};

export type CharacterRig = {
  rigId: RigId;
  /** 리타게팅 원본(KayKit)에서 검을 쥔 방향 — 소켓(모델 공간) 기준 회전. 없으면 null */
  weaponRef: Quaternion | null;
  actions: Record<ActionSlot, ActionInfo>;
  /** 게임이 위치·회전을 넣는 노드 */
  root: Group;
  /** 기울임(lean)용 중간 노드 — 발밑을 축으로 기운다 */
  pivot: Group;
  model: Object3D;
  mixer: AnimationMixer;
  loco: Record<LocoSlot, LocoInfo>;
  /** 횃불 팔 자세 레이어 (해당 리그에 있을 때) */
  torchLayer: AnimationClip | null;
  bones: { torchHand: Object3D; weaponHand: Object3D; head: Object3D; chest: Object3D };
  /** 모델 원점 → 게임 미터 배율 (세로) */
  scale: number;
  /** 대기 포즈를 잠시 적용한 채 fn을 실행한다 — 소품 소켓의 기준 자세 */
  withIdlePose(fn: () => void): void;
  dispose(): void;
};

const loader = new GLTFLoader();
const gltfCache = new Map<string, ReturnType<GLTFLoader['loadAsync']>>();
/** 같은 파일은 한 번만 내려받는다 (플레이어 마네킹과 고블린이 같은 UAL 파일을 쓴다) */
export function loadGltf(url: string) {
  let p = gltfCache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
}

/**
 * glTF 원본 이름(예: 'handslot.l')으로 노드를 찾는다. GLTFLoader는 이름에서 '.', ':', '/', '[', ']'를
 * 지우므로('handslot.l' → 'handslotl') 같은 규칙(PropertyBinding.sanitizeNodeName)으로 변환해 찾는다.
 */
export function findBone(model: Object3D, gltfName: string, file = 'model'): Object3D {
  const o = model.getObjectByName(PropertyBinding.sanitizeNodeName(gltfName));
  if (!o) throw new Error(`${file}에 ${gltfName} 노드가 없다`);
  return o;
}

/** 트랙 이름('노드.속성')의 노드 부분이 접두사 목록 중 하나로 시작하는지 */
function trackBone(trackName: string): string {
  const i = trackName.lastIndexOf('.');
  return i < 0 ? trackName : trackName.slice(0, i);
}

function filterClip(clip: AnimationClip, keep: (bone: string) => boolean, name: string): AnimationClip {
  return new AnimationClip(name, clip.duration, clip.tracks.filter((t) => keep(trackBone(t.name))));
}

/**
 * 이동 클립 분석: 접지 구간(발 높이 최저점 +1.5cm 이내가 4샘플 이상 이어지는 구간)마다
 * (첫 접지 위치 − 마지막 접지 위치) / 접지 시간 = 몸 이동 속도. 달리기의 체공 구간은 자동으로 빠진다.
 * 순간 속도 중앙값이나 '발 앞뒤 폭×2' 방식은 달리기를 크게 틀리게 재는 것을 실측으로 확인했다.
 */
export function analyzeLoco(model: Object3D, mixer: AnimationMixer, clip: AnimationClip, feet: readonly Object3D[], samples = 180) {
  mixer.stopAllAction();
  const action = mixer.clipAction(clip).play();
  const p = new Vector3();
  const tracks = feet.map(() => [] as { y: number; z: number }[]);
  for (let i = 0; i < samples; i++) {
    action.time = (clip.duration * i) / samples;
    mixer.update(0);
    model.updateMatrixWorld(true);
    feet.forEach((f, k) => {
      f.getWorldPosition(p);
      tracks[k]!.push({ y: p.y, z: p.z });
    });
  }
  mixer.stopAllAction();
  mixer.uncacheAction(clip);

  const dt = clip.duration / samples;
  const speeds: number[] = [];
  let footPhase = 0;
  tracks.forEach((t, k) => {
    const minY = Math.min(...t.map((s) => s.y));
    const on = t.map((s) => s.y < minY + 0.015);
    if (on.every(Boolean)) return; // 발을 떼지 않는 동작 (대기)
    for (let i = 0; i < samples; i++) {
      // 접지 시작 지점 (직전 샘플은 공중)
      if (!on[i] || on[(i - 1 + samples) % samples]) continue;
      let len = 0;
      while (on[(i + len) % samples] && len < samples) len++;
      if (k === 0 && speeds.length === 0) footPhase = i / samples;
      if (len >= 4) speeds.push(Math.abs(t[i]!.z - t[(i + len - 1) % samples]!.z) / ((len - 1) * dt));
    }
  });
  const noSlip = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  return { noSlip, footPhase };
}

/** 리그 정의에서 { kaykit } 으로 지정된 전투 클립을 KayKit 원본에서 리타게팅한다 (없으면 빈 맵) */
async function retargetKayKit(rig: RigDef, targetScene: Object3D, targetRef: AnimationClip) {
  const defs = Object.values(rig.actions).flatMap((d) => (typeof d === 'string' ? [] : [d]));
  const out = new Map<string, AnimationClip>();
  if (defs.length === 0) return { clips: out, weaponRef: null };
  const kk = await loadGltf(`${BASE}assets/characters/Knight.glb`);
  // 원본·대상 모두 손대지 않은 복제본으로 (배율·소품·재질이 바뀐 플레이어 모델을 쓰면 안 된다)
  const srcScene = cloneSkinned(kk.scene);
  const tgtScene = cloneSkinned(targetScene);
  const srcRef = kk.animations.find((c) => c.name === 'Idle')!;
  for (const d of defs) {
    const clip = kk.animations.find((c) => c.name === d.kaykit);
    if (!clip) throw new Error(`KayKit에 ${d.kaykit} 애니메이션이 없다`);
    const key = d.kaykit + (d.mirror ? '#mirror' : '');
    out.set(key, retargetClip({ scene: srcScene, clip, ref: srcRef }, { scene: tgtScene, ref: targetRef }, KAYKIT_TO_UAL, ['DEF-hips', 'hips'], UAL_KEEP, `${key}@ual`, d.mirror));
  }
  // KayKit 대기 자세에서 검(1H_Sword, 칼날 +Y)의 월드 회전 → 우리 검을 같은 방향으로 쥐면,
  // 리타게팅된 손 회전이 칼날을 원본과 똑같이 움직인다 (임의 각도로 쥐면 찌르기가 찌르기로 안 보였다)
  const mixer = new AnimationMixer(srcScene);
  mixer.clipAction(srcRef).play();
  mixer.update(0);
  srcScene.updateMatrixWorld(true);
  const sword = srcScene.getObjectByName('1H_Sword');
  const weaponRef = sword ? sword.getWorldQuaternion(new Quaternion()) : null;
  mixer.stopAllAction();
  return { clips: out, weaponRef };
}

/** 공격 클립의 타격 순간: 무기 손의 속도가 가장 빠른 시각 (실측 방식 — 에셋이 바뀌어도 자동으로 맞는다) */
export function findImpact(model: Object3D, mixer: AnimationMixer, clip: AnimationClip, hand: Object3D, samples = 90): number {
  mixer.stopAllAction();
  const a = mixer.clipAction(clip).play();
  const p = new Vector3();
  const q = new Vector3();
  let best = 0;
  let bestT = clip.duration * 0.4;
  for (let i = 0; i <= samples; i++) {
    const t = (clip.duration * i) / samples;
    a.time = t;
    mixer.update(0);
    model.updateMatrixWorld(true);
    hand.getWorldPosition(p);
    if (i > 0) {
      const v = p.distanceTo(q);
      if (v > best) {
        best = v;
        bestT = t;
      }
    }
    q.copy(p);
  }
  mixer.stopAllAction();
  mixer.uncacheAction(clip);
  return bestT;
}

export async function loadCharacter(classId: ClassId, rigId: RigId): Promise<CharacterRig> {
  const rig = RIGS[rigId];
  const url = rig.url(classId);
  const gltf = await loadGltf(url);
  // 원본 장면은 캐시에 공유된다(고블린도 같은 파일을 쓴다) → 스킨 메시를 뼈째 복제해서 쓴다
  const model = cloneSkinned(gltf.scene);

  const keep = rig.keep ? new Set(rig.keep(classId)) : null;
  model.traverse((o) => {
    const mesh = o as Object3D & { isMesh?: boolean; isSkinnedMesh?: boolean; material?: Material };
    if (!mesh.isMesh) return;
    if (keep && !mesh.isSkinnedMesh) o.visible = keep.has(o.name);
    o.castShadow = true;
    o.receiveShadow = true;
    // 스킨 메시는 바인드 포즈 기준 경계로 컬링돼 애니메이션 중 사라질 수 있다
    o.frustumCulled = false;
  });

  const mixer = new AnimationMixer(model);
  const byName = new Map(gltf.animations.map((c) => [c.name, c]));
  const clipOf = (name: string) => {
    const c = byName.get(name);
    if (!c) throw new Error(`${url}에 ${name} 애니메이션이 없다`);
    return c;
  };

  // 키 맞추기: 대기 포즈 기준 경계 상자 높이 → 목표 키
  mixer.clipAction(clipOf(rig.clips.idle)).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model, true);
  const scale = CLASS_HEIGHT[classId] / (box.max.y - box.min.y);
  const build = CLASS_BUILD[classId];
  model.scale.set(scale * build, scale, scale * build);
  mixer.stopAllAction();
  model.updateMatrixWorld(true);

  const feet = rig.feet.map((f) => findBone(model, f, url));

  // 횃불 팔 레이어: 그 팔 트랙만 남긴 클립 + 이동 클립에서는 그 팔 트랙을 뺀다 (두 레이어가 같은 뼈를 두고 평균내지 않게)
  let torchLayer: AnimationClip | null = null;
  let isTorchBone: (b: string) => boolean = () => false;
  if (rig.torchPose) {
    const prefixes = rig.torchPose.bonePrefixes.map((p) => PropertyBinding.sanitizeNodeName(p));
    // 손가락은 왼손 것만 (L 접미사): 'DEF-f_index01L' 처럼 이름 끝이 L
    isTorchBone = (b) => prefixes.some((p) => b.startsWith(p)) && (b.endsWith('L') || !/[LR]$/.test(b));
    torchLayer = filterClip(clipOf(rig.torchPose.clip), isTorchBone, 'TorchArm');
  }

  const loco = {} as Record<LocoSlot, LocoInfo>;
  for (const slot of Object.keys(rig.clips) as LocoSlot[]) {
    const src = clipOf(rig.clips[slot]);
    const clip = torchLayer ? filterClip(src, (b) => !isTorchBone(b), `${src.name}#noTorchArm`) : src;
    // 속도·위상은 원본 클립으로 잰다 (팔 트랙은 발에 영향이 없다)
    const a = slot === 'land' || slot === 'fall' ? { noSlip: 0, footPhase: 0 } : analyzeLoco(model, mixer, src, feet);
    loco[slot] = { clip, noSlip: a.noSlip, footPhase: a.footPhase };
  }

  // 전투 클립: 루트 이동 트랙 제거(구르기 등은 시뮬레이션이 몸을 옮긴다 — KayKit Dodge는 루트가 0.25 이동),
  // 상체 동작(공격·패링)은 횃불 팔 트랙을 빼서 횃불을 든 채 휘두르게 한다
  const weaponHand = findBone(model, rig.weaponHandForImpact, url);
  const actions = {} as Record<ActionSlot, ActionInfo>;
  const rt = await retargetKayKit(rig, gltf.scene, clipOf(rig.clips.idle === 'Idle_Torch_Loop' ? 'Idle_Loop' : rig.clips.idle));
  for (const slot of Object.keys(rig.actions) as ActionSlot[]) {
    const def = rig.actions[slot];
    const src = typeof def === 'string' ? clipOf(def) : rt.clips.get(def.kaykit + (def.mirror ? '#mirror' : ''))!;
    // root의 위치 트랙만 뺀다 (회전은 남긴다 — UAL root는 Z-up→Y-up 보정 회전을 가진다)
    let clip = new AnimationClip(`${src.name}#${slot}`, src.duration, src.tracks.filter((t) => !(trackBone(t.name) === 'root' && t.name.endsWith('.position'))));
    if (torchLayer && !FULL_BODY.has(slot)) clip = filterClip(clip, (b) => !isTorchBone(b), clip.name);
    const isAttack = slot.startsWith('light') || slot === 'heavy';
    actions[slot] = { clip, impact: isAttack ? findImpact(model, mixer, src, weaponHand) : 0 };
  }

  const idleRaw = clipOf(rig.clips.idle);
  const pivot = new Group();
  pivot.add(model);
  const root = new Group();
  root.add(pivot);

  return {
    rigId,
    actions,
    weaponRef: rt.weaponRef,
    root,
    pivot,
    model,
    mixer,
    loco,
    torchLayer,
    bones: {
      torchHand: findBone(model, rig.torchHand, url),
      weaponHand: findBone(model, rig.weaponHand, url),
      head: findBone(model, rig.head, url),
      chest: findBone(model, rig.chest, url),
    },
    scale,
    withIdlePose(fn) {
      // 주의: AnimationMixer는 뼈를 쓰던 마지막 액션이 멈추면 restoreOriginalState()로 뼈를 원래(바인드) 자세로
      // 되돌린다 (three AnimationMixer.js _deactivateAction). 그래서 포즈는 fn이 도는 동안에만 켜 둔다.
      const a = mixer.clipAction(idleRaw).play();
      mixer.update(0);
      root.updateMatrixWorld(true);
      try {
        fn();
      } finally {
        a.stop();
        mixer.uncacheAction(idleRaw);
      }
    },
    dispose() {
      // 지오메트리·텍스처는 glTF 캐시에서 다른 캐릭터(고블린)와 공유하므로 여기서 해제하지 않는다.
      // ponytail: 캐시 수명 = 페이지 수명. 구역 전환(M2)에서 참조 카운트 기반 해제로 바꾼다.
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      model.removeFromParent();
    },
  };
}

/**
 * 뼈에 소품을 붙이기 위한 소켓. 뼈의 로컬 축은 리그마다 제각각이라, 현재 포즈에서 '모델 공간 축'과 같아지도록
 * 회전·배율을 되돌린 노드를 만든다. 소켓 안에서는 +Y = 위, +Z = 캐릭터 앞, 단위 = 미터.
 * 반드시 rig.withIdlePose() 안에서 호출한다 (바인드 포즈 기준으로 잡으면 팔을 든 자세에서 소품이 누워 버린다).
 */
export function makeSocket(owner: { root: Object3D }, bone: Object3D): Group {
  owner.root.updateMatrixWorld(true);
  const boneQ = bone.getWorldQuaternion(new Quaternion());
  const rootQ = owner.root.getWorldQuaternion(new Quaternion());
  const boneS = bone.getWorldScale(new Vector3());
  const socket = new Group();
  socket.quaternion.copy(boneQ.invert().multiply(rootQ));
  socket.scale.set(1 / boneS.x, 1 / boneS.y, 1 / boneS.z);
  bone.add(socket);
  return socket;
}
