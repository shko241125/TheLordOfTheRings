import {
  AnimationClip, AnimationMixer, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack,
  type Object3D,
} from 'three/webgpu';
import { PropertyBinding } from 'three/webgpu';

/**
 * 리타게팅: 다른 뼈대의 애니메이션을 옮긴다 (렌더 전용).
 *
 * three.js SkeletonUtils.retarget은 원본 뼈의 월드 회전을 그대로 대상 뼈에 넣는다 → 두 리그의 뼈 축 규약과
 * 기본 자세가 같아야만 맞는다. KayKit(자체 리그, T-포즈)과 UAL(Rigify, A-포즈)은 둘 다 달라서 쓸 수 없다.
 *
 * 그래서 '기준 자세 대비 월드 회전 변화량'을 옮긴다:
 *   D(t)      = Q_src(t) · Q_src(ref)⁻¹          원본 뼈가 기준 자세에서 월드 공간으로 얼마나 돌았나
 *   Q_tgt(t)  = D(t) · Q_tgt(ref)                같은 변화를 대상 뼈의 기준 자세에 적용
 * 기준 자세는 각 리그의 '대기' 첫 프레임(둘 다 팔을 내리고 선 자세)이라 모양이 비슷하다.
 * 로컬 축 규약이 달라도 월드 변화량만 쓰므로 상관없다. 엉덩이 이동은 엉덩이 높이 비율로 줄인다.
 */

export type RetargetSource = { scene: Object3D; clip: AnimationClip; ref: AnimationClip };
export type RetargetTarget = { scene: Object3D; ref: AnimationClip };

const node = (root: Object3D, gltfName: string) => {
  const o = root.getObjectByName(PropertyBinding.sanitizeNodeName(gltfName));
  if (!o) throw new Error(`리타게팅: ${gltfName} 노드가 없다`);
  return o;
};

function pose(mixer: AnimationMixer, root: Object3D, clip: AnimationClip, t: number) {
  mixer.stopAllAction();
  const a = mixer.clipAction(clip).play();
  a.time = t;
  mixer.update(0);
  root.updateMatrixWorld(true);
}

/**
 * @param map 대상 뼈 이름 → 원본 뼈 이름 (glTF 원본 이름)
 * @param hips [대상 엉덩이, 원본 엉덩이]
 * @param keep 대상에서 기준 자세로 고정할 중간 뼈 (원본에 대응 뼈가 없는 목·쇄골·척추 중간 등)
 * @param mirror 좌우 반전: 원본의 왼쪽 뼈를 대상의 오른쪽에 쓰고, 월드 변화량을 YZ 평면에 대해 뒤집는다
 *               (쿼터니언 (x, y, z, w) → (x, −y, −z, w), 이동은 x → −x). 방패 막기(왼팔)를 검 막기(오른팔)로 쓸 때.
 */
export function retargetClip(
  src: RetargetSource,
  tgt: RetargetTarget,
  map: Readonly<Record<string, string>>,
  hips: readonly [string, string],
  keep: readonly string[],
  name: string,
  mirror = false,
  fps = 30,
): AnimationClip {
  const side = (n: string) => (mirror ? n.replace(/\.l$/, '.__').replace(/\.r$/, '.l').replace(/\.__$/, '.r') : n);
  const sm = new AnimationMixer(src.scene);
  const tm = new AnimationMixer(tgt.scene);
  const pairs = Object.entries(map).map(([t, s]) => ({ t: node(tgt.scene, t), s: node(src.scene, side(s)) }));
  const tHip = node(tgt.scene, hips[0]);
  const sHip = node(src.scene, hips[1]);
  const kept = keep.map((n) => node(tgt.scene, n));

  // 기준 자세 기록
  pose(sm, src.scene, src.ref, 0);
  const qs0 = pairs.map((p) => p.s.getWorldQuaternion(new Quaternion()));
  const ps0 = sHip.getWorldPosition(new Vector3());
  pose(tm, tgt.scene, tgt.ref, 0);
  const qt0 = pairs.map((p) => p.t.getWorldQuaternion(new Quaternion()));
  const pt0 = tHip.getWorldPosition(new Vector3());
  const heightRatio = pt0.y / Math.max(ps0.y, 1e-4);
  const keptLocal = kept.map((b) => b.quaternion.clone());
  const hipParentInv = new Matrix4().copy(tHip.parent!.matrixWorld).invert();

  // 대상 뼈를 부모 → 자식 순으로 (엉덩이 아래 전부). 매핑·고정 대상만 트랙을 만든다.
  const mapped = new Map(pairs.map((p, i) => [p.t, i]));
  const keptSet = new Map(kept.map((b, i) => [b, i]));
  const order: Object3D[] = [];
  tHip.traverse((o) => {
    if (mapped.has(o) || keptSet.has(o)) order.push(o);
  });

  const frames = Math.max(2, Math.round(src.clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const quatValues = new Map(order.map((b) => [b, new Float32Array(frames * 4)]));
  const hipPos = new Float32Array(frames * 3);

  const d = new Quaternion();
  const qw = new Quaternion();
  const parentW = new Quaternion();
  const local = new Quaternion();
  const world = new Map<Object3D, Quaternion>();
  const p = new Vector3();

  // 대상의 기준 자세를 한 번 깔아 둔다 (매핑 안 된 조상의 월드 회전 계산용)
  pose(tm, tgt.scene, tgt.ref, 0);
  const restWorld = new Map<Object3D, Quaternion>();
  tHip.traverse((o) => restWorld.set(o, o.getWorldQuaternion(new Quaternion())));
  const hipParentW = tHip.parent!.getWorldQuaternion(new Quaternion());

  for (let f = 0; f < frames; f++) {
    const t = Math.min(src.clip.duration, f / fps);
    times[f] = t;
    pose(sm, src.scene, src.clip, t);
    world.clear();
    for (const b of order) {
      // 부모의 (이번 프레임) 월드 회전: 처리한 조상이 있으면 그것, 없으면 기준 자세
      let par: Object3D | null = b.parent;
      let pw: Quaternion | undefined;
      // 부모 사슬에서 이번 프레임 계산값이 있는 가장 가까운 조상을 찾고, 사이의 뼈는 기준 로컬 회전을 곱한다
      const between: Object3D[] = [];
      while (par && !(pw = world.get(par)) && par !== tHip.parent) {
        between.push(par);
        par = par.parent;
      }
      if (!pw) pw = par === tHip.parent ? hipParentW : restWorld.get(par!) ?? hipParentW;
      parentW.copy(pw);
      for (let i = between.length - 1; i >= 0; i--) parentW.multiply(between[i]!.quaternion);

      const mi = mapped.get(b);
      if (mi !== undefined) {
        const pr = pairs[mi]!;
        pr.s.getWorldQuaternion(qw);
        d.copy(qw).multiply(qs0[mi]!.clone().invert());
        if (mirror) d.set(d.x, -d.y, -d.z, d.w);
        qw.copy(d).multiply(qt0[mi]!);
        local.copy(parentW).invert().multiply(qw);
      } else {
        local.copy(keptLocal[keptSet.get(b)!]!);
        qw.copy(parentW).multiply(local);
      }
      world.set(b, qw.clone());
      local.toArray(quatValues.get(b)!, f * 4);
    }
    // 엉덩이 위치: 원본 이동량 × 높이 비율 → 대상 기준 위치에 더해 로컬로
    sHip.getWorldPosition(p);
    p.sub(ps0);
    if (mirror) p.x = -p.x;
    p.multiplyScalar(heightRatio).add(pt0).applyMatrix4(hipParentInv);
    p.toArray(hipPos, f * 3);
  }

  sm.stopAllAction();
  tm.stopAllAction();
  const tracks = [
    ...order.map((b) => new QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quatValues.get(b)!)),
    new VectorKeyframeTrack(`${tHip.name}.position`, times, hipPos),
  ];
  return new AnimationClip(name, src.clip.duration, tracks);
}

/** KayKit(원본) → UAL(대상) 뼈 대응. 없는 뼈(목·쇄골·척추 중간)는 기준 자세로 고정한다. */
export const KAYKIT_TO_UAL: Readonly<Record<string, string>> = {
  'DEF-hips': 'hips',
  'DEF-spine.001': 'spine',
  'DEF-spine.003': 'chest',
  'DEF-head': 'head',
  'DEF-upper_arm.L': 'upperarm.l',
  'DEF-forearm.L': 'lowerarm.l',
  'DEF-hand.L': 'hand.l',
  'DEF-upper_arm.R': 'upperarm.r',
  'DEF-forearm.R': 'lowerarm.r',
  'DEF-hand.R': 'hand.r',
  'DEF-thigh.L': 'upperleg.l',
  'DEF-shin.L': 'lowerleg.l',
  'DEF-foot.L': 'foot.l',
  'DEF-toe.L': 'toes.l',
  'DEF-thigh.R': 'upperleg.r',
  'DEF-shin.R': 'lowerleg.r',
  'DEF-foot.R': 'foot.r',
  'DEF-toe.R': 'toes.r',
};
export const UAL_KEEP = ['DEF-spine.002', 'DEF-neck', 'DEF-shoulder.L', 'DEF-shoulder.R'];
