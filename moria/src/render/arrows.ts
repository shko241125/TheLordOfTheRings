import { Color, CylinderGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PointLight, Quaternion, Vector3, type Object3D } from 'three/webgpu';
import { MAX_EMBERS } from '../sim/archer';
import type { Sim } from '../sim/types';
import type { Backend } from './renderer';

/** 날아가는 화살 (렌더 전용) — 가는 막대 하나를 인스턴싱. 방향은 속도를 따른다. 발로그의 불덩이는 빛나는 구.
 *  불씨 화살·박힌 불씨는 작은 불꽃 + 빛. WebGPU는 자체 점광원 풀(박힌 불씨 먼저, 그다음 날아가는 불씨 화살),
 *  WebGL2는 광원을 만들지 않고 glows(불꽃 자리)를 장면의 '가까운 횃불' 후보로 넘긴다 (forward 광원 수를 늘리지 않는다) */
const MAX = 32;
// ponytail: 광원은 불씨 수만큼 고정 풀 — 날아가는 불씨 화살이 많으면 빛 없이 불꽃만 보인다
const EMBER_LIGHTS = MAX_EMBERS + 2;

export function createArrowView(sim: Sim, parent: Object3D, backend: Backend) {
  const geo = new CylinderGeometry(0.012, 0.012, 0.75, 5);
  const mat = new MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.8 });
  const mesh = new InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  parent.add(mesh);
  const orbs = new InstancedMesh(new IcosahedronGeometry(0.35, 1), new MeshBasicMaterial({ color: new Color(1, 0.5, 0.1) }), 8);
  orbs.count = 0;
  orbs.frustumCulled = false;
  parent.add(orbs);
  const sparks = new InstancedMesh(new IcosahedronGeometry(0.06, 1), new MeshBasicMaterial({ color: new Color(1, 0.42, 0.08) }), MAX + MAX_EMBERS);
  sparks.count = 0;
  sparks.frustumCulled = false;
  parent.add(sparks);
  const lights = Array.from({ length: backend === 'webgpu' ? EMBER_LIGHTS : 0 }, () => {
    const l = new PointLight(0xff8a3d, 0, 5, 2);
    parent.add(l);
    return l;
  });
  const glowPool = Array.from({ length: MAX + MAX_EMBERS }, () => new Vector3());
  const glows: Vector3[] = [];
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  return {
    /** 이번 프레임 불꽃 자리 (WebGL2 광원 풀 후보) */
    glows: glows as readonly Vector3[],
    update() {
      glows.length = 0;
      let n = 0;
      let o = 0;
      let k = 0;
      const glow = (x: number, y: number, z: number, intensity: number) => {
        glows.push(glowPool[k]!.set(x, y, z));
        sparks.setMatrixAt(k++, m4.makeTranslation(x, y, z));
        const l = lights[k - 1];
        if (!l) return;
        l.position.set(x, y, z);
        l.intensity = intensity * (0.85 + Math.random() * 0.15); // 렌더 전용 깜빡임
      };
      for (const e of sim.embers) glow(e.x, e.y, e.z, 4 * Math.min(1, e.ttl / 60)); // 마지막 1초에 사그라든다
      for (const a of sim.arrows) {
        if (a.fire) {
          if (o < 8) orbs.setMatrixAt(o++, m4.makeTranslation(a.x, a.y, a.z));
          continue;
        }
        if (n >= MAX) break;
        dir.set(a.vx, a.vy, a.vz).normalize();
        q.setFromUnitVectors(up, dir);
        mesh.setMatrixAt(n++, m4.compose(pos.set(a.x, a.y, a.z), q, one));
        if (a.ember) glow(a.x, a.y, a.z, 3);
      }
      for (let i = k; i < lights.length; i++) lights[i]!.intensity = 0;
      sparks.count = k;
      sparks.instanceMatrix.needsUpdate = true;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      orbs.count = o;
      orbs.instanceMatrix.needsUpdate = true;
    },
  };
}
