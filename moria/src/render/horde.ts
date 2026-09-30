import {
  AnimationMixer, Box3, BufferAttribute, BufferGeometry, Color, DataTexture, FloatType, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, MeshStandardNodeMaterial, RGBAFormat, SkinnedMesh, Vector3, type Object3D,
} from 'three/webgpu';
import { attribute, cos, float, floor, fract, int, ivec2, length, mix, sin, smoothstep, textureLoad, uniform, vec3, vertexIndex } from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { angleDiff, angleToRad } from '../core/trig';
import { GOBLIN_CAPSULE } from '../sim/enemy';
import { HORDE_MAX, type HordeAgent } from '../sim/horde';
import type { Sim } from '../sim/types';
import type { Impostor } from './goblins';
import { loadGltf } from './character';

/**
 * 고블린 물결의 무리 (렌더 전용) — 정점 애니메이션 텍스처(VAT) + 인스턴싱으로 수백 마리를 draw call 하나에.
 *  - 시작할 때 고블린 모델의 대기(12프레임)·달리기(24프레임) 자세를 CPU로 스키닝해 정점 위치를 텍스처에 굽는다.
 *  - 셰이더는 정점 번호(vertexIndex)와 인스턴스의 프레임 번호로 텍스처에서 위치를 읽어 두 프레임 사이를 보간한다.
 *  - TSL positionNode는 인스턴스 변환 '뒤에' 적용된다(r186 NodeMaterial.setupPosition) → 위치·회전을 인스턴스 속성으로 따로 넘겨
 *    셰이더에서 직접 돌리고 옮긴다. instanceMatrix(같은 값)는 법선 회전용으로 둔다.
 * ponytail: 법선은 기본 자세 값(애니메이션 안 함), 귀·칼 소품 없음 — 무리는 어둠 속 실루엣이라 충분하다.
 *           가까이서 보이면 이미 진짜 고블린(스키닝)으로 승격된 뒤다.
 */
const URL = `${import.meta.env.BASE_URL}assets/characters/ual/AnimationLibrary_Godot_Standard.gltf`;
const HEIGHT = 2 * (GOBLIN_CAPSULE.half + GOBLIN_CAPSULE.radius);
const W = 2048; // 텍스처 폭 (정점 번호 → (x, y))
const IDLE_FRAMES = 12;
const RUN_FRAMES = 24;
const FRAMES = IDLE_FRAMES + RUN_FRAMES;
const MODEL_YAW_OFFSET = Math.PI;

export async function createHordeView(sim: Sim, parent: Object3D) {
  if (!sim.horde) return null;
  const gltf = await loadGltf(URL);
  const clip = (n: string) => {
    const c = gltf.animations.find((x) => x.name === n)!.clone();
    c.tracks = c.tracks.filter((t) => !(t.name.startsWith('root.') && t.name.endsWith('.position')));
    return c;
  };

  // --- 굽기 ---
  const model = cloneSkinned(gltf.scene);
  const pivot = new Group();
  pivot.add(model);
  const mixer = new AnimationMixer(model);
  const idle = mixer.clipAction(clip('Idle_Loop')).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model, true);
  const s = HEIGHT / (box.max.y - box.min.y);
  model.scale.set(s * 1.08, s, s * 1.08);
  // 고블린과 같은 구부정한 자세 (모델 앞 = +Z 기준으로 굽는다 — 180° 돌리는 것은 셰이더의 방향값에서.
  // 여기서 y로 먼저 돌리면 x 기울기가 뒤로 젖혀진다: Euler XYZ는 벡터에 Rz→Ry→Rx 순서로 걸린다)
  pivot.rotation.x = 0.14;
  const meshes: SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  const counts = meshes.map((m) => m.geometry.getAttribute('position').count);
  const V = counts.reduce((a, b) => a + b, 0);
  const rows = Math.ceil(V / W);
  const data = new Float32Array(W * rows * FRAMES * 4);
  const v = new Vector3();
  const bake = (frameBase: number, n: number, clipName: string) => {
    idle.stop();
    mixer.stopAllAction();
    const act = mixer.clipAction(clip(clipName)).play();
    const dur = act.getClip().duration;
    for (let f = 0; f < n; f++) {
      act.time = (f / n) * dur;
      mixer.update(0);
      pivot.updateMatrixWorld(true);
      let vi = 0;
      for (const m of meshes) {
        m.skeleton.update();
        const count = m.geometry.getAttribute('position').count;
        for (let i = 0; i < count; i++, vi++) {
          m.getVertexPosition(i, v); // 스키닝 후 메시 좌표
          v.applyMatrix4(m.matrixWorld); // → 고블린 몸 좌표 (발밑 원점)
          const o = ((frameBase + f) * rows * W + vi) * 4;
          data[o] = v.x;
          data[o + 1] = v.y;
          data[o + 2] = v.z;
          data[o + 3] = 1;
        }
      }
    }
    act.stop();
  };
  bake(0, IDLE_FRAMES, 'Idle_Loop');
  bake(IDLE_FRAMES, RUN_FRAMES, 'Jog_Fwd_Loop');
  const tex = new DataTexture(data, W, rows * FRAMES, RGBAFormat, FloatType);
  tex.needsUpdate = true;

  // --- 하나로 합친 기하 (위치는 자리만 — 실제 위치는 텍스처에서) ---
  const geo = new BufferGeometry();
  const pos = new Float32Array(V * 3);
  const nrm = new Float32Array(V * 3);
  const col = new Float32Array(V * 3);
  const idx: number[] = [];
  const skin = new Color(0x2c4526);
  const leather = new Color(0x221a12);
  let base = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const n = g.getAttribute('normal');
    const c = (m.material as { name?: string }).name === 'M_Main' ? skin : leather;
    for (let i = 0; i < g.getAttribute('position').count; i++) {
      v.fromBufferAttribute(n, i);
      nrm.set([v.x, v.y, v.z], (base + i) * 3);
      col.set([c.r, c.g, c.b], (base + i) * 3);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += g.getAttribute('position').count;
  }
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(idx);
  // 인스턴스 속성: (x, y, z, 회전 rad), 프레임 (0..FRAMES)
  const iPose = new InstancedBufferAttribute(new Float32Array(HORDE_MAX * 4), 4);
  const iFrame = new InstancedBufferAttribute(new Float32Array(HORDE_MAX), 1);
  geo.setAttribute('iPose', iPose);
  geo.setAttribute('iFrame', iFrame);
  mixer.stopAllAction();
  mixer.uncacheRoot(model);

  // --- TSL 재질 ---
  const pose = attribute('iPose', 'vec4');
  const fr = attribute('iFrame', 'float');
  const f0 = floor(fr);
  const t = fract(fr);
  // 루프 끝 → 처음 (대기·달리기 구간마다 따로 감긴다)
  const inIdle = f0.lessThan(IDLE_FRAMES);
  const f1 = inIdle.select(f0.add(1).mod(IDLE_FRAMES), f0.sub(IDLE_FRAMES).add(1).mod(RUN_FRAMES).add(IDLE_FRAMES));
  const vid = int(vertexIndex);
  const tx = vid.mod(W);
  const ty = vid.div(W);
  const p0 = textureLoad(tex, ivec2(tx, ty.add(int(f0).mul(rows)))).xyz;
  const p1 = textureLoad(tex, ivec2(tx, ty.add(int(f1).mul(rows)))).xyz;
  const p = mix(p0, p1, t);
  const c = cos(pose.w);
  const sn = sin(pose.w);
  const mat = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  mat.vertexColors = true;
  mat.positionNode = vec3(p.x.mul(c).add(p.z.mul(sn)), p.y, p.x.negate().mul(sn).add(p.z.mul(c))).add(pose.xyz);
  // 돌의 감각: 음파 반경 안의 무리는 청백색으로 드러난다 (무리는 늘 움직이므로)
  const senseO = uniform(new Vector3());
  const senseR = uniform(0);
  const senseS = uniform(0);
  const d = length(pose.xz.sub(senseO.xz));
  mat.emissiveNode = vec3(0.12, 0.19, 0.28).mul(senseS).mul(float(1).sub(smoothstep(senseR.sub(0.5), senseR, d)));

  const mesh = new InstancedMesh(geo, mat, HORDE_MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);

  // --- 보간·애니메이션 상태 (에이전트 id → 직전·현재 스냅샷, 프레임 위상) ---
  type Snap = { x: number; y: number; z: number; f: number; sp: number };
  let prev = new Map<number, Snap>();
  let curr = new Map<number, Snap>();
  const phase = new Map<number, number>();
  const m4 = new Matrix4();
  const snapOf = (a: HordeAgent): Snap => ({ x: a.x, y: a.y, z: a.z, f: a.facing, sp: Math.hypot(a.vx, a.vz) });

  return {
    /** 틱마다: 보간 스냅샷 */
    capture() {
      prev = curr;
      curr = new Map();
      for (const a of sim.horde!.agents) curr.set(a.id, snapOf(a));
      for (const id of phase.keys()) if (id >= 0 && !curr.has(id)) phase.delete(id); // 음수 = 진짜 고블린(대역)
    },
    /** 돌의 감각 음파 (main이 매 프레임 넣는다) */
    sense(x: number, z: number, radius: number, strength: number) {
      senseO.value.set(x, 0, z);
      senseR.value = radius;
      senseS.value = strength;
    },
    /** impostors: 스키닝 LOD 밖의 진짜 고블린 (goblins.update가 채운다) — 무리와 같은 메시로 그린다 */
    update(dt: number, alpha: number, seen: (x: number, y: number, z: number) => boolean, impostors: readonly Impostor[] = [], runNoSlip = 4.4) {
      let n = 0;
      const put = (key: number, x: number, y: number, z: number, facing: number, sp: number) => {
        if (n >= HORDE_MAX) return;
        const yaw = angleToRad(facing) + MODEL_YAW_OFFSET; // 모델 앞(+Z) → facing 0(−Z)
        // 프레임: 멈춰 있으면 대기 고리, 움직이면 달리기 고리 (보폭에 맞춘 속도 — 미끄러짐 방지)
        let ph = phase.get(key) ?? (Math.abs(key) * 7.31) % 1;
        const running = sp > 0.6;
        ph = (ph + dt * (running ? sp / runNoSlip / 0.8 : 0.35)) % 1;
        phase.set(key, ph);
        iPose.setXYZW(n, x, y, z, yaw);
        iFrame.setX(n, running ? IDLE_FRAMES + ph * RUN_FRAMES : ph * IDLE_FRAMES);
        m4.makeRotationY(yaw).setPosition(x, y, z);
        mesh.setMatrixAt(n, m4);
        n++;
      };
      for (const im of impostors) put(im.key, im.x, im.y, im.z, im.facing, im.speed);
      for (const [id, c] of curr) {
        const p = prev.get(id) ?? c;
        const x = p.x + (c.x - p.x) * alpha;
        const y = p.y + (c.y - p.y) * alpha;
        const z = p.z + (c.z - p.z) * alpha;
        if (!seen(x, y, z)) continue;
        put(id, x, y, z, p.f + angleDiff(p.f, c.f) * alpha, c.sp);
      }
      mesh.count = n;
      iPose.needsUpdate = true;
      iFrame.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    },
    stats: () => ({ vertices: V, textureMB: +((data.byteLength / 1048576).toFixed(1)), drawn: mesh.count }),
  };
}
