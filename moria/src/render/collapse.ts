import {
  AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  RingGeometry, TorusGeometry, type Object3D,
} from 'three/webgpu';
import type { Sim } from '../sim/types';

/**
 * 무너지는 기둥과 동료 광역기의 외형 (렌더 전용).
 *  - 금 간 기둥: 균열 띠가 희미한 주황빛으로 빛나 '부술 수 있다'를 알린다. 맞을수록 밝아진다.
 *  - 쓰러지는 조각 6개는 시뮬레이션 강체의 위치·회전을 그대로 따른다 (결정적 물리 = 모든 화면에서 같은 잔해).
 *  - 동료 광역기: 바닥에 고리(아라곤·김리) 또는 부채꼴 고리(레골라스) 충격파가 0.6초 동안 범위 끝까지 퍼진다.
 */
const CRACK_BANDS = 4;
const FLASH_SECONDS = 0.6;

export function createCollapseView(sim: Sim, parent: Object3D) {
  const stone = new MeshStandardMaterial({ color: 0x5e554b, roughness: 0.95 });
  const views = sim.collapses.map((c) => {
    const standing = new Group();
    const body = new Mesh(new CylinderGeometry(c.radius, c.radius * 1.05, c.height, 20), stone);
    body.position.y = c.height / 2;
    body.castShadow = body.receiveShadow = true;
    standing.add(body);
    // 균열: 기둥을 비스듬히 두르는 얇은 고리 (빛나는 틈)
    const crackMat = new MeshBasicMaterial({ color: new Color(0.9, 0.35, 0.08) });
    for (let k = 0; k < CRACK_BANDS; k++) {
      const band = new Mesh(new TorusGeometry(c.radius * 1.01, 0.05, 4, 28), crackMat);
      band.position.y = c.height * (0.2 + 0.18 * k);
      band.rotation.set(Math.PI / 2 + 0.25 * (k % 2 ? 1 : -1), 0, 0.3 * k);
      standing.add(band);
    }
    standing.position.set(c.x, c.y, c.z);
    parent.add(standing);
    const seg = c.height / 6;
    const chunkGeo = new CylinderGeometry(c.radius, c.radius, seg - 0.04, 16);
    const chunks = Array.from({ length: 6 }, () => {
      const m = new Mesh(chunkGeo, stone);
      m.castShadow = m.receiveShadow = true;
      m.visible = false;
      parent.add(m);
      return m;
    });
    return { standing, crackMat, chunks, maxHp: c.hp };
  });

  // 동료 광역기 섬광 (재사용 하나)
  const flashMat = new MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const flash = new Mesh(new RingGeometry(0.82, 1, 64), flashMat);
  flash.rotation.x = -Math.PI / 2;
  flash.visible = false;
  parent.add(flash);
  let flashT = -1;
  /** 균열 빛 색 (색각 보정이면 하늘색) */
  let crack: [number, number, number] = [1.0, 0.4, 0.1];

  return {
    setPalette(colorSafe: boolean) {
      crack = colorSafe ? [0.35, 0.85, 1.0] : [1.0, 0.4, 0.1];
    },
    onEvent(ev: Sim['events'][number]) {
      if (ev.type === 'companion') {
        // 원 또는 부채꼴: 부채꼴은 facing 방향(−sin, −cos) 중심 ±halfArc
        const full = ev.halfArc >= 2048;
        const arc = full ? Math.PI * 2 : (ev.halfArc / 4096) * Math.PI * 4;
        flash.geometry.dispose();
        // CircleGeometry는 +X에서 반시계로 thetaStart. 눕히면(-90° X) 화면의 −Z가 +Y 쪽 → 앞 방향 각 = facing 기준으로 맞춘다
        const face = (ev.facing / 4096) * Math.PI * 2;
        // 꽉 찬 원판은 낮은 카메라에서 바닥 전체를 칠한 것처럼 보였다(스크린샷) → 가장자리 고리가 퍼지는 충격파
        flash.geometry = new RingGeometry(0.82, 1, 64, 1, full ? 0 : Math.PI / 2 + face - arc / 2, arc);
        flash.position.set(ev.x, ev.y - 0.85, ev.z);
        flash.userData.radius = ev.radius;
        flash.scale.setScalar(ev.radius * 0.3);
        flash.visible = true;
        flashT = 0;
      }
    },
    update(dt: number) {
      for (let i = 0; i < views.length; i++) {
        const c = sim.collapses[i]!;
        const v = views[i]!;
        v.standing.visible = c.state === 'standing';
        if (c.state === 'standing') {
          // 금: 처음엔 희미하게, 깎일수록 밝게 (어둠 속에서도 '여기를 치라'가 읽힌다)
          // (처음 0.25는 어둠 속에서 안 보였다 — 스크린샷) → 0.6에서 시작해 깎일수록 1.6까지 (톤매핑 전 값이라 1을 넘겨 빛나게)
          const k = 0.6 + 1.0 * (1 - Math.max(0, c.hp) / v.maxHp);
          v.crackMat.color.setRGB(crack[0] * k, crack[1] * k, crack[2] * k);
          continue;
        }
        for (let j = 0; j < v.chunks.length; j++) {
          const b = c.chunks[j];
          const m = v.chunks[j]!;
          m.visible = !!b;
          if (!b) continue;
          const t = b.translation();
          const q = b.rotation();
          m.position.set(t.x, t.y, t.z);
          m.quaternion.set(q.x, q.y, q.z, q.w);
        }
      }
      if (flashT >= 0) {
        flashT += dt;
        const k = flashT / FLASH_SECONDS;
        // 작은 원에서 범위 끝까지 번지며 옅어진다 (처음의 불투명 0.7 원판은 바닥 전체를 하얗게 씻어 냈다 — 스크린샷)
        flash.scale.setScalar((flash.userData.radius as number) * (0.3 + 0.7 * (1 - (1 - Math.min(1, k)) ** 3)));
        flashMat.opacity = Math.max(0, 0.8 * (1 - k));
        if (k >= 1) {
          flash.visible = false;
          flashT = -1;
        }
      }
    },
  };
}
