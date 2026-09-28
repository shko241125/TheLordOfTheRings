import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { createRng } from '../core/rng';
import type { Level, SurfaceKind } from '../sim/level';
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
  /** 품질 확인용 수치 */
  stats(): { torchLights: number; lightingMode: string };
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

  for (const s of level.solids) {
    const geo =
      s.kind === 'box'
        ? track(new BoxGeometry(s.half[0] * 2, s.half[1] * 2, s.half[2] * 2))
        : track(new CylinderGeometry(s.radius, s.radius, s.halfHeight * 2, 24));
    const mesh = new Mesh(geo, mat(s.surface));
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    if (s.kind === 'box' && s.rot) mesh.quaternion.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3]);
    mesh.receiveShadow = true;
    // 그림자는 큰 덩어리(기둥·단·경사로)만. 계단 한 칸(바닥 1.35m²)처럼 작은 것은 받기만 한다 — 점광원 그림자 6면 비용
    mesh.castShadow = s.surface === 'stone' && (s.kind === 'cylinder' || s.half[0] * s.half[2] * 4 >= 2);
    scene.add(mesh);
  }

  // 벽 횃불: 불꽃 메시는 항상, 광원은 백엔드에 따라
  const flameGeo = track(new SphereGeometry(0.12, 12, 8));
  const flameMat = track(new MeshBasicMaterial({ color: 0xffb060 }));
  const handleGeo = track(new CylinderGeometry(0.04, 0.05, 0.5, 8));
  const handleMat = track(new MeshStandardMaterial({ color: 0x2a1c10, roughness: 1 }));
  const torchPos = level.torches.map((t) => new Vector3(t[0], t[1], t[2]));
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
    stats: () => ({ torchLights: torchLights.length + dynLights.length, lightingMode }),
    dispose() {
      for (const d of disposables) d.dispose();
      playerTorch.shadow.dispose();
    },
  };
}
