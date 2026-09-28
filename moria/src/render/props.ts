import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Quaternion,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three/webgpu';
import type { ClassId } from '../sim/classes';
import { makeSocket, type CharacterRig } from './character';

/**
 * 캐릭터 소품과 클래스 복장. 전부 기본 도형이라 라이선스·로딩 비용이 없고, 소켓(makeSocket) 기준 미터 단위로 배치한다.
 * 소켓 축: +Y 위, +Z 캐릭터 앞 (바인드 포즈 기준). 최종 아트가 오면 이 파일만 glTF 소품으로 바꾼다.
 */

/** blade: 칼날 재질 — 스팅 경보(적이 가까우면 푸르게 빛남)에 쓴다 */
type Kit = { geos: BufferGeometry[]; mats: Material[]; blade?: MeshStandardMaterial };

function kit(): Kit {
  return { geos: [], mats: [] };
}
/**
 * 소품은 기본적으로 그림자를 드리우지 않는다: 점광원 그림자는 큐브맵 6면을 모두 다시 그려 draw call이 곱으로 는다.
 * 특히 손의 횃불은 광원 바로 옆이라 제 빛을 가리기까지 했다 (M1 draw call 189 → 점검에서 발견).
 */
function mesh(k: Kit, geo: BufferGeometry, mat: Material, shadow = false): Mesh {
  k.geos.push(geo);
  const m = new Mesh(geo, mat);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}
function std(k: Kit, color: number, roughness = 0.85, metalness = 0): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness, metalness });
  k.mats.push(m);
  return m;
}

export type Torch = {
  group: Group;
  /** 불꽃 위치 (광원을 이 위치에 매 프레임 맞춘다) */
  flame: Object3D;
  flameMesh: Mesh;
};

/** 손에 쥐는 횃불: 나무 자루 + 감은 천 + 불꽃. 자루는 손 소켓 기준 약간 앞·위로 기운다. */
export function buildTorch(k: Kit): Torch {
  const group = new Group();
  const handle = mesh(k, new CylinderGeometry(0.018, 0.024, 0.5, 8), std(k, 0x3a2614, 1));
  handle.position.y = 0.12;
  const wrap = mesh(k, new CylinderGeometry(0.036, 0.03, 0.1, 8), std(k, 0x2a2018, 1));
  wrap.position.y = 0.38;
  const flameMat = new MeshBasicMaterial({ color: new Color(1.0, 0.36, 0.06) });
  k.mats.push(flameMat);
  const flameMesh = mesh(k, new IcosahedronGeometry(0.05, 1), flameMat, false);
  flameMesh.position.y = 0.47;
  flameMesh.scale.set(1, 1.6, 1);
  const flame = new Group();
  flame.position.y = 0.5;
  group.add(handle, wrap, flameMesh, flame);
  return { group, flame, flameMesh };
}

type Outfit = {
  body: number;
  accent: number;
  build: (k: Kit, head: Group, weapon: Group, chest: Group) => void;
};

const OUTFITS: Record<ClassId, Outfit> = {
  // 곤도르 변경의 경비병: 짙은 청회색 겉옷, 가죽, 코가리개 투구, 한손검
  human: {
    body: 0x2f3947,
    accent: 0x4a3423,
    build(k, head, weapon, chest) {
      const steel = std(k, 0x8a8f96, 0.45, 0.8);
      const helm = mesh(k, new SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      helm.position.set(0, 0.06, 0.005);
      helm.scale.set(1, 1.05, 1.1);
      const nasal = mesh(k, new BoxGeometry(0.025, 0.1, 0.02), steel);
      nasal.position.set(0, 0.03, 0.14);
      head.add(helm, nasal);
      k.blade = std(k, 0xb8bec6, 0.3, 0.9);
      const blade = mesh(k, new BoxGeometry(0.05, 0.8, 0.012), k.blade);
      blade.position.set(0, 0.5, 0);
      const guard = mesh(k, new BoxGeometry(0.2, 0.03, 0.04), steel);
      guard.position.y = 0.09;
      const grip = mesh(k, new CylinderGeometry(0.018, 0.018, 0.16, 8), std(k, 0x2a1a10, 1));
      weapon.add(blade, guard, grip);
      const pauldron = std(k, 0x5b6068, 0.55, 0.6);
      for (const s of [-1, 1]) {
        const p = mesh(k, new SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), pauldron);
        p.position.set(0.19 * s, 0.1, 0);
        p.rotation.z = -0.5 * s;
        chest.add(p);
      }
    },
  },
  // 발린의 원정대 드워프: 사슬갑옷 회색, 적갈색 수염, 둥근 투구, 한손도끼
  dwarf: {
    body: 0x55585c,
    accent: 0x3a2a1c,
    build(k, head, weapon) {
      const iron = std(k, 0x6d6a66, 0.5, 0.75);
      const helm = mesh(k, new SphereGeometry(0.145, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), iron);
      helm.position.set(0, 0.05, 0);
      const rim = mesh(k, new CylinderGeometry(0.155, 0.155, 0.03, 16), iron);
      rim.position.y = 0.05;
      // 밝은 적갈색은 횃불빛을 받으면 분홍 삼각형처럼 보였다 (WebGL2 스크린샷) → 짙은 갈색, 넓고 짧게
      const beardMat = std(k, 0x4a2a14, 1);
      const beard = mesh(k, new ConeGeometry(0.14, 0.3, 12), beardMat);
      beard.position.set(0, -0.13, 0.085);
      beard.rotation.x = Math.PI; // 뾰족한 쪽이 아래
      beard.scale.set(1.05, 1, 0.55);
      const moustache = mesh(k, new BoxGeometry(0.16, 0.035, 0.04), beardMat);
      moustache.position.set(0, -0.02, 0.13);
      head.add(helm, rim, beard, moustache);
      const haft = mesh(k, new CylinderGeometry(0.02, 0.022, 0.6, 8), std(k, 0x3a2614, 1));
      haft.position.y = 0.2;
      k.blade = std(k, 0xa7aab0, 0.35, 0.9);
      const bit = mesh(k, new BoxGeometry(0.02, 0.18, 0.16), k.blade);
      bit.position.set(0, 0.44, 0.08);
      weapon.add(haft, bit);
    },
  },
  // 로스로리엔 정찰병: 짙은 녹색, 두건, 단검
  elf: {
    body: 0x344a36,
    accent: 0x5c5040,
    build(k, head, weapon) {
      const cloth = std(k, 0x4b5a48, 1);
      const hood = mesh(k, new SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), cloth);
      hood.position.set(0, 0.03, -0.015);
      hood.scale.set(1, 1.12, 1.12);
      const tip = mesh(k, new ConeGeometry(0.06, 0.12, 8), cloth);
      tip.position.set(0, 0.1, -0.13);
      tip.rotation.x = -1.1;
      head.add(hood, tip);
      k.blade = std(k, 0xd8dde2, 0.25, 0.9);
      const blade = mesh(k, new ConeGeometry(0.022, 0.32, 4), k.blade);
      blade.position.y = 0.24;
      const grip = mesh(k, new CylinderGeometry(0.015, 0.015, 0.12, 8), std(k, 0x2a1a10, 1));
      weapon.add(blade, grip);
    },
  },
};

/** 무기 쥔 방향: 평상시(늘어뜨림)와 전투 동작(리타게팅 원본과 같은 방향) — main이 행동 가중치로 섞는다 */
export type WeaponGrip = { group: Group; rest: Quaternion; combat: Quaternion | null };
export type Dressing = { torch: Torch; weapon: WeaponGrip | null; blade: MeshStandardMaterial | null; dispose(): void };

/**
 * 캐릭터에 횃불과 클래스 복장을 입힌다.
 * UAL 마네킹: 몸 재질 두 개(M_Main 주황, M_Joints 보라)를 클래스 색으로 바꾸고 투구·수염·두건·무기를 붙인다.
 * KayKit: 의상·무기가 모델에 있으므로 횃불만 붙인다.
 */
export function dress(rig: CharacterRig, classId: ClassId): Dressing {
  const k = kit();
  const outfit = OUTFITS[classId];

  let grip: WeaponGrip | null = null;
  if (rig.rigId === 'ual') {
    const recolor = new Map<string, MeshStandardMaterial>([
      ['M_Main', std(k, outfit.body, 0.9)],
      ['M_Joints', std(k, outfit.accent, 0.8)],
    ]);
    rig.model.traverse((o) => {
      const m = o as Object3D & { isMesh?: boolean; material?: Material | Material[] };
      if (!m.isMesh || !m.material) return;
      const swap = (mat: Material) => recolor.get(mat.name) ?? mat;
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    rig.withIdlePose(() => {
      const head = makeSocket(rig, rig.bones.head);
      const chest = makeSocket(rig, rig.bones.chest);
      // 무기는 소켓 안에 한 단계 더 두고 돌린다 (소켓 자체의 보정 회전을 덮어쓰지 않게)
      const weapon = new Group();
      makeSocket(rig, rig.bones.weaponHand).add(weapon);
      // 평상시: 대기 자세에서 늘어진 손 기준 앞쪽 아래(X축 약 132°).
      // 전투 동작: 리타게팅 원본(KayKit)의 검 쥔 방향 → 칼날까지 원본 동작과 같아진다 (찌르기가 찌르기로 보인다).
      // 원본 방향을 평상시에도 쓰면 대기 중 칼을 허리에 가로로 든 모양이 된다(스크린샷) → 둘을 섞는다.
      weapon.rotation.x = 2.3;
      grip = { group: weapon, rest: weapon.quaternion.clone(), combat: rig.weaponRef };
      outfit.build(k, head, weapon, chest);
    });
  }

  const torch = buildTorch(k);
  rig.withIdlePose(() => makeSocket(rig, rig.bones.torchHand).add(torch.group));
  // 대기 포즈에서 소켓 +Y = 위 → 횃불이 곧게 선다. 약간 앞으로 기울인다.
  torch.group.rotation.x = rig.rigId === 'ual' ? 0.15 : 0.35;

  return {
    torch,
    weapon: grip,
    blade: k.blade ?? null,
    dispose() {
      for (const g of k.geos) g.dispose();
      for (const m of k.mats) m.dispose();
    },
  };
}
