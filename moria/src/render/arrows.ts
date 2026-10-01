import { CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from 'three/webgpu';
import type { Sim } from '../sim/types';

/** 날아가는 화살 (렌더 전용) — 가는 막대 하나를 인스턴싱. 방향은 속도를 따른다 */
const MAX = 32;

export function createArrowView(sim: Sim, parent: Object3D) {
  const geo = new CylinderGeometry(0.012, 0.012, 0.75, 5);
  const mat = new MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.8 });
  const mesh = new InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  parent.add(mesh);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  return {
    update() {
      let n = 0;
      for (const a of sim.arrows) {
        if (n >= MAX) break;
        dir.set(a.vx, a.vy, a.vz).normalize();
        q.setFromUnitVectors(up, dir);
        mesh.setMatrixAt(n++, m4.compose(pos.set(a.x, a.y, a.z), q, one));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
