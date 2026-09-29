import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  type Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Frustum,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import type { Level, SurfaceKind, Vec3 } from '../sim/level';
import { MAX_THROWN } from '../sim/torch';
import type { Backend } from './renderer';

const TORCH_COLOR = 0xff8a3d;
const TORCH_INTENSITY = 18; // cd, decay 2 기준
const TORCH_RANGE = 10;
/**
 * WebGL2 폴백의 횃불 광원 수. ClusteredLighting은 컴퓨트 셰이더 기반이라 WebGPU 전용이다
 * (r186 공식 예제도 WebGPU가 없으면 중단). 폴백에서는 가까운 횃불 N개로 광원을 옮겨 다닌다.
 */
const WEBGL_TORCH_POOL = 6;
const PLAYER_TORCH_INTENSITY = 14;
/** 던지거나 내려놓은 횃불 (던진 것 최대 6 + 내려놓은 것 여유 2). 광원을 추가·제거하지 않고 고정 풀로 옮긴다 */
const DYNAMIC_POOL = MAX_THROWN + 2;

const SURFACE_COLOR: Record<SurfaceKind, number> = {
  floor: 0x3a3632,
  wall: 0x45413c,
  stone: 0x55504a,
  ceiling: 0x1c1a18,
};

/** 바닥·공중의 횃불 (시뮬레이션 TorchItem에서 렌더가 뽑아 넘긴다) */
export type LooseTorch = { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number };

export type GameScene = {
  scene: Scene;
  playerTorch: PointLight;
  /** 카메라를 따라다니는 약한 보조광 (main이 위치를 넣는다) */
  fill: PointLight;
  /** 매 렌더 프레임: 횃불 깜빡임, 떨어진 횃불 배치, WebGL2에서는 가까운 횃불로 광원 재배치 */
  update(focus: Vector3, loose: readonly LooseTorch[], holdingTorch: boolean): void;
  /** 문 여닫이·이실딘 빛·화로 불 (시뮬레이션 상태를 그대로 받는다) */
  props(dt: number, doorsOpen: readonly boolean[], braziersLit: readonly boolean[], player: Vector3): void;
  /** 포털 컬링: 카메라가 있는 방에서 보이는 통로를 따라 닿는 방만 그린다. 보이는 방 번호 목록을 돌려준다 */
  cull(camera: Camera, player: Vector3): readonly number[];
  /** 그 자리의 방이 지난 cull()에서 보였는가 (방 밖이면 true) */
  seen(x: number, y: number, z: number): boolean;
  /** 방 번호 (방이 없는 레벨·방 밖이면 −1) */
  roomAt(p: Vector3): number;
  /** 품질 확인용 수치 */
  stats(): { torchLights: number; lightingMode: string; rooms: number };
  dispose(): void;
};

export function buildScene(level: Level, renderer: WebGPURenderer, backend: Backend): GameScene {
  const scene = new Scene();
  scene.background = new Color(0x000000);
  scene.fog = new FogExp2(0x000000, 0.035);
  // 어둠이 기본값. 실루엣만 겨우 보이는 수준의 환경광.
  scene.add(new HemisphereLight(0x2a3040, 0x080605, 0.12));

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);

  const materials = new Map<SurfaceKind, MeshStandardMaterial>();
  const mat = (k: SurfaceKind) => {
    let m = materials.get(k);
    if (!m) {
      m = track(new MeshStandardMaterial({ color: SURFACE_COLOR[k], roughness: 0.92, metalness: 0 }));
      materials.set(k, m);
    }
    return m;
  };

  // --- 방 나누기 + 정적 병합 ---
  // 방이 없는 레벨(시험 방)은 전체가 방 하나. 각 도형은 중심이 들어 있는 방에 속한다 (구역 데이터가 벽을 방 안에 만든다).
  const rooms = level.rooms?.length ? level.rooms : [{ name: 'all', min: [-1e9, -1e9, -1e9] as Vec3, max: [1e9, 1e9, 1e9] as Vec3 }];
  const roomBoxes = rooms.map((r) => new Box3(new Vector3(...r.min).subScalar(0.01), new Vector3(...r.max).addScalar(0.01)));
  const roomOf = (x: number, y: number, z: number) => roomBoxes.findIndex((b) => b.containsPoint(tmp.set(x, y, z)));
  const tmp = new Vector3();
  const roomGroups = rooms.map(() => new Group());
  roomGroups.forEach((g) => scene.add(g));
  // (방, 재질, 그림자 여부)마다 도형을 하나로 합친다: 구역 1의 도형 150여 개 → 방당 3~5 draw call
  const buckets = new Map<string, { room: number; surface: SurfaceKind; caster: boolean; geos: BufferGeometry[] }>();
  for (const s of level.solids) {
    const geo =
      s.kind === 'box' ? new BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2) : new CylinderGeometry(s.radius, s.radius, s.halfHeight * 2, 24);
    const m = new Matrix4().makeTranslation(s.pos[0], s.pos[1], s.pos[2]);
    if (s.kind === 'box' && s.rot) m.multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(s.rot[0], s.rot[1], s.rot[2], s.rot[3])));
    geo.applyMatrix4(m);
    // 그림자는 큰 덩어리(기둥·단·경사로)만. 계단 한 칸(바닥 1.35m²)처럼 작은 것은 받기만 한다 — 점광원 그림자 6면 비용
    const caster = s.surface === 'stone' && (s.kind === 'cylinder' || s.half[0] * s.half[2] * 4 >= 2);
    const room = Math.max(0, roomOf(s.pos[0], s.pos[1], s.pos[2]));
    const key = `${room}/${s.surface}/${caster}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { room, surface: s.surface, caster, geos: [] }));
    b.geos.push(geo);
  }
  for (const b of buckets.values()) {
    const merged = track(mergeGeometries(b.geos));
    for (const g of b.geos) g.dispose();
    const mesh = new Mesh(merged, mat(b.surface));
    mesh.receiveShadow = true;
    mesh.castShadow = b.caster;
    roomGroups[b.room]!.add(mesh);
  }

  // 벽 횃불: 불꽃 메시는 항상, 광원은 백엔드에 따라
  const flameGeo = track(new SphereGeometry(0.12, 12, 8));
  const flameMat = track(new MeshBasicMaterial({ color: 0xffb060 }));
  const handleGeo = track(new CylinderGeometry(0.04, 0.05, 0.5, 8));
  const handleMat = track(new MeshStandardMaterial({ color: 0x2a1c10, roughness: 1 }));
  const torchPos = level.torches.map((t) => new Vector3(t[0], t[1], t[2]));
  const torchRoom = torchPos.map((p) => roomOf(p.x, p.y, p.z));
  // 반복 소품은 인스턴싱: 횃불 20개 × 2메시 = draw call 40 → 2
  const flames = track(new InstancedMesh(flameGeo, flameMat, torchPos.length));
  const handles = track(new InstancedMesh(handleGeo, handleMat, torchPos.length));
  const m4 = new Matrix4();
  torchPos.forEach((p, i) => {
    flames.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z));
    handles.setMatrixAt(i, m4.makeTranslation(p.x, p.y - 0.3, p.z));
  });
  scene.add(flames, handles);

  // 떨어진 횃불: 고정 풀 (메시 + 광원). 쓰지 않는 칸은 숨기고 광원 세기 0
  const looseGeo = track(new CylinderGeometry(0.02, 0.025, 0.5, 6));
  const looseFlameGeo = track(new IcosahedronGeometry(0.05, 1));
  const looseFlameMat = track(new MeshBasicMaterial({ color: new Color(1.0, 0.36, 0.06) }));
  const loose = Array.from({ length: DYNAMIC_POOL }, () => {
    const g = new Group();
    const stick = new Mesh(looseGeo, handleMat);
    const flame = new Mesh(looseFlameGeo, looseFlameMat);
    flame.position.y = 0.27;
    flame.scale.set(1, 1.6, 1);
    g.add(stick, flame);
    g.visible = false;
    scene.add(g);
    return { g, flame };
  });
  const looseFlamePos = Array.from({ length: DYNAMIC_POOL }, () => new Vector3());
  let looseCount = 0;

  let torchLights: PointLight[];
  let dynLights: PointLight[] = [];
  let lightingMode: string;
  if (backend === 'webgpu') {
    renderer.lighting = new ClusteredLighting();
    torchLights = torchPos.map((p) => {
      const l = new PointLight(TORCH_COLOR, TORCH_INTENSITY, TORCH_RANGE, 2);
      l.position.copy(p);
      scene.add(l);
      return l;
    });
    dynLights = loose.map(() => {
      const l = new PointLight(TORCH_COLOR, 0, TORCH_RANGE * 0.8, 2);
      scene.add(l);
      return l;
    });
    lightingMode = 'clustered';
  } else {
    torchLights = Array.from({ length: Math.min(WEBGL_TORCH_POOL, torchPos.length) }, () => {
      const l = new PointLight(TORCH_COLOR, TORCH_INTENSITY, TORCH_RANGE, 2);
      scene.add(l);
      return l;
    });
    lightingMode = `nearest-${torchLights.length}`;
  }

  // --- 두린의 문: 돌문 두 짝 + 이실딘(달빛에만 보이는 은빛 선) ---
  const doorMat = track(new MeshStandardMaterial({ color: 0x3c3e44, roughness: 0.85 }));
  const ithildinMat = track(new MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0 }));
  const doors = (level.doors ?? []).map((d) => {
    const [hx, hy, hz] = d.half;
    const leafGeo = track(new BoxGeometry(hx, hy * 2, hz * 1.6));
    const leaves = [-1, 1].map((side) => {
      const pivot = new Group(); // 경첩 = 문틀 양끝
      pivot.position.set(d.pos[0] + side * hx, d.pos[1], d.pos[2]);
      const leaf = new Mesh(leafGeo, doorMat);
      leaf.position.x = -side * hx / 2;
      leaf.castShadow = leaf.receiveShadow = true;
      pivot.add(leaf);
      scene.add(pivot);
      return { pivot, side };
    });
    // 아치 + 두 기둥 선 + 별 (바깥 면 5cm 앞)
    const glow = new Group();
    const front = d.pos[2] + hz + 0.05;
    const arch = new Mesh(track(new TorusGeometry(hx * 0.9, 0.035, 6, 48, Math.PI)), ithildinMat);
    arch.position.set(d.pos[0], d.pos[1] + hy * 0.2, front);
    const barGeo = track(new BoxGeometry(0.06, hy * 1.2, 0.02));
    const bars = [-1, 1].map((sd) => {
      const b = new Mesh(barGeo, ithildinMat);
      b.position.set(d.pos[0] + sd * hx * 0.9, d.pos[1] - hy * 0.4, front);
      return b;
    });
    const star = new Mesh(track(new IcosahedronGeometry(0.16, 0)), ithildinMat);
    star.position.set(d.pos[0], d.pos[1] + hy * 0.55, front);
    glow.add(arch, ...bars, star);
    scene.add(glow);
    return { leaves, glow, open: 0, z: d.pos[2], x: d.pos[0] };
  });

  // --- 화로: 돌 받침(레벨 도형) 위에 그릇 + 불. 광원은 미리 만들어 세기 0 (광원 수가 바뀌면 셰이더를 다시 짓는다) ---
  const bowlGeo = track(new CylinderGeometry(0.55, 0.32, 0.3, 16, 1, true));
  const bowlMat = track(new MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.6, metalness: 0.4, side: DoubleSide }));
  const coalMat = track(new MeshBasicMaterial({ color: 0xffb050 }));
  const coalGeo = track(new IcosahedronGeometry(0.13, 1));
  const braziers = (level.braziers ?? []).map(([x, y, z]) => {
    const bowl = new Mesh(bowlGeo, bowlMat);
    bowl.position.set(x, y + 1.05, z);
    // 불꽃 3개 (가운데 높게) — 매 프레임 높이만 흔든다
    const fire = new Group();
    for (const [ox, oz, h] of [[0, 0, 1.9], [0.15, 0.08, 1.3], [-0.12, -0.1, 1.2]] as const) {
      const f = new Mesh(coalGeo, coalMat);
      f.position.set(ox, 0, oz);
      f.scale.set(1, h, 1);
      fire.add(f);
    }
    fire.position.set(x, y + 1.3, z);
    fire.visible = false;
    const light = new PointLight(0xffa050, 0, 14, 2);
    light.position.set(x, y + 1.8, z);
    scene.add(bowl, fire);
    if (backend === 'webgpu') scene.add(light);
    return { fire, light, pos: new Vector3(x, y + 1.6, z), room: roomOf(x, y + 0.5, z), lit: false };
  });

  // 플레이어가 든 횃불 광원. 그림자를 드리우는 유일한 광원이며 위치는 매 프레임 손의 불꽃에 맞춘다.
  // 26cd였을 때 0.6m 거리의 캐릭터 몸이 하얗게 날아갔다 (스크린샷 확인) → 14cd
  const playerTorch = new PointLight(0xffa050, PLAYER_TORCH_INTENSITY, 14, 2);
  playerTorch.castShadow = true;
  playerTorch.shadow.mapSize.set(1024, 1024);
  playerTorch.shadow.bias = -0.002;
  scene.add(playerTorch);

  // 카메라 보조광: 횃불 반대편(카메라 쪽) 몸이 새까만 실루엣이 되는 것을 막는다. 그림자 없음, 약하게.
  // 어두운 게임에서 흔히 쓰는 방식 — 장면의 어둠은 유지하고 플레이어만 읽히게 한다.
  const fill = new PointLight(0xa8a39a, 11, 9, 2);
  scene.add(fill);

  // 렌더 전용 깜빡임. 시뮬레이션 난수와 섞이지 않게 별도 스트림.
  const fx = createRng(0xf1a3e);
  const flicker = torchLights.map(() => 1);
  const candidates: Vector3[] = [];
  const frustum = new Frustum();
  const projView = new Matrix4();
  const portals = level.portals ?? [];
  const portalBoxes = portals.map((pt) => new Box3(new Vector3(...pt.min), new Vector3(...pt.max)));
  const visible = rooms.map(() => true);
  // 닫힌 문이 막고 있는 통로는 시야도 막는다 (문 중심이 통로 상자 안에 있으면 그 문의 통로)
  const portalDoor = portalBoxes.map((b) => doors.findIndex((d) => b.containsPoint(tmp.set(d.x, b.min.y + 0.1, d.z))));
  const portalShut = portalDoor.map(() => false);
  const visibleList: number[] = [];
  const order: number[] = [];

  return {
    scene,
    playerTorch,
    fill,
    update(focus, looseList, holdingTorch) {
      // 떨어진 횃불 배치
      looseCount = Math.min(looseList.length, DYNAMIC_POOL);
      for (let i = 0; i < DYNAMIC_POOL; i++) {
        const slot = loose[i]!;
        const t = looseList[i];
        slot.g.visible = i < looseCount;
        if (!t || i >= looseCount) continue;
        slot.g.position.set(t.x, t.y, t.z);
        slot.g.quaternion.set(t.qx, t.qy, t.qz, t.qw);
        slot.g.updateMatrixWorld(true);
        slot.flame.getWorldPosition(looseFlamePos[i]!);
      }

      if (backend === 'webgl2') {
        // 가까운 횃불(벽 + 떨어진 것) N개로 광원 풀을 옮긴다
        candidates.length = 0;
        candidates.push(...torchPos, ...looseFlamePos.slice(0, looseCount));
        for (const b of braziers) if (b.lit) candidates.push(b.pos);
        order.length = 0;
        for (let i = 0; i < candidates.length; i++) order.push(i);
        order.sort((a, b) => candidates[a]!.distanceToSquared(focus) - candidates[b]!.distanceToSquared(focus));
        for (let i = 0; i < torchLights.length; i++) torchLights[i]!.position.copy(candidates[order[i]!]!);
      } else {
        for (let i = 0; i < dynLights.length; i++) {
          const l = dynLights[i]!;
          if (i < looseCount) {
            l.position.copy(looseFlamePos[i]!);
            l.intensity = TORCH_INTENSITY * 0.8 * (0.85 + fx.next() * 0.15);
          } else l.intensity = 0;
        }
      }
      for (let i = 0; i < torchLights.length; i++) {
        flicker[i] = flicker[i]! * 0.85 + (0.8 + fx.next() * 0.4) * 0.15;
        torchLights[i]!.intensity = TORCH_INTENSITY * flicker[i]!;
      }
      playerTorch.intensity = holdingTorch ? PLAYER_TORCH_INTENSITY * (0.9 + fx.next() * 0.1) : 0;
    },
    props(dt, doorsOpen, braziersLit, player) {
      for (let i = 0; i < portalDoor.length; i++) portalShut[i] = portalDoor[i]! >= 0 && doors[portalDoor[i]!]!.open === 0;
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i]!;
        const target = doorsOpen[i] ? 1 : 0;
        d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt / 2.5); // 2.5초에 걸쳐 안쪽으로
        const ease = d.open * d.open * (3 - 2 * d.open);
        for (const l of d.leaves) l.pivot.rotation.y = l.side * -1 * ease * (Math.PI / 2);
        // 이실딘: 문 앞 10m 안에서 서서히 드러나고, 문이 열리면 사라진다
        const near = Math.max(0, Math.min(1, (12 - Math.hypot(player.x - d.x, player.z - d.z)) / 6));
        ithildinMat.opacity = near * (1 - d.open) * (0.75 + 0.25 * Math.sin(performance.now() / 700));
        d.glow.visible = ithildinMat.opacity > 0.01;
      }
      for (let i = 0; i < braziers.length; i++) {
        const b = braziers[i]!;
        b.lit = !!braziersLit[i];
        b.fire.visible = b.lit;
        b.light.intensity = b.lit ? 30 * (0.85 + fx.next() * 0.15) : 0;
        if (b.lit) b.fire.scale.y = 0.9 + fx.next() * 0.25;
      }
    },
    cull(camera, player) {
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      let start = roomOf(camera.position.x, camera.position.y, camera.position.z);
      if (start < 0) start = Math.max(0, roomOf(player.x, player.y, player.z));
      visible.fill(false);
      visible[start] = true;
      // ponytail: 포털 상자가 전체 시야 절두체에 걸리는지만 본다 (포털을 지날 때마다 절두체를 좁히지 않음).
      // 방이 5개인 구역에서는 충분하다. 방이 수십 개가 되면 포털 사각형으로 절두체를 깎는 방식으로.
      const queue = [start];
      while (queue.length) {
        const r = queue.shift()!;
        for (let i = 0; i < portals.length; i++) {
          const pt = portals[i]!;
          const other = pt.a === r ? pt.b : pt.b === r ? pt.a : -1;
          if (other < 0 || visible[other] || portalShut[i] || !frustum.intersectsBox(portalBoxes[i]!)) continue;
          visible[other] = true;
          queue.push(other);
        }
      }
      for (let i = 0; i < roomGroups.length; i++) roomGroups[i]!.visible = visible[i]!;
      if (backend === 'webgpu') {
        for (let i = 0; i < torchLights.length; i++) torchLights[i]!.visible = torchRoom[i]! < 0 || visible[torchRoom[i]!]!;
        for (const b of braziers) b.light.visible = b.room < 0 || visible[b.room]!;
      }
      visibleList.length = 0;
      visible.forEach((v, i) => v && visibleList.push(i));
      return visibleList;
    },
    seen(x, y, z) {
      const r = roomOf(x, y + 0.2, z);
      return r < 0 || visible[r]!;
    },
    roomAt: (p) => (level.rooms?.length ? roomOf(p.x, p.y, p.z) : -1),
    stats: () => ({ torchLights: torchLights.length + dynLights.length + (backend === 'webgpu' ? braziers.length : 0), lightingMode, rooms: rooms.length }),
    dispose() {
      for (const d of disposables) d.dispose();
      playerTorch.shadow.dispose();
    },
  };
}
