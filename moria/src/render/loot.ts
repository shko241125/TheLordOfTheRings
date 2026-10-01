import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, type Object3D } from 'three/webgpu';
import { GRADE_COLORS } from '../sim/items';
import type { Sim } from '../sim/types';

/**
 * 바닥 전리품 (렌더 전용): 장비 = 등급 색으로 빛나는 작은 상자(희귀 이상은 빛기둥), 금화 = 금빛 조각, 미스릴 = 은청색 결정.
 * 어두운 동굴에서 보여야 하므로 빛을 받지 않는 재질(스스로 빛남)이다.
 */
export function createLootView(sim: Sim, parent: Object3D) {
  const boxGeo = new BoxGeometry(0.3, 0.2, 0.22);
  const beamGeo = new CylinderGeometry(0.04, 0.04, 2.4, 6, 1, true);
  beamGeo.translate(0, 1.2, 0);
  const gemGeo = new OctahedronGeometry(0.12);
  const coinGeo = new CylinderGeometry(0.12, 0.12, 0.04, 10);
  const gradeMats = GRADE_COLORS.map((c) => new MeshBasicMaterial({ color: new Color(c) }));
  const beamMats = GRADE_COLORS.map((c) => new MeshBasicMaterial({ color: new Color(c), transparent: true, opacity: 0.35, depthWrite: false }));
  const goldMat = new MeshBasicMaterial({ color: 0xffc040 });
  const mithrilMat = new MeshBasicMaterial({ color: 0xa8d8ff });
  const views = new Map<number, Group>();
  let clock = 0;
  return {
    update(dt: number) {
      clock += dt;
      const alive = new Set<number>();
      for (const l of sim.loot) {
        alive.add(l.id);
        let g = views.get(l.id);
        if (!g) {
          g = new Group();
          if (l.kind === 'item' && l.item) {
            g.add(new Mesh(boxGeo, gradeMats[l.item.grade]));
            if (l.item.grade >= 2) g.add(new Mesh(beamGeo, beamMats[l.item.grade]));
          } else g.add(new Mesh(l.kind === 'gold' ? coinGeo : gemGeo, l.kind === 'gold' ? goldMat : mithrilMat));
          g.position.set(l.x, l.y + 0.15, l.z);
          parent.add(g);
          views.set(l.id, g);
        }
        g.children[0]!.rotation.y = clock * 1.5 + l.id; // 천천히 돈다
        g.position.y = l.y + 0.15 + Math.sin(clock * 2 + l.id) * 0.04;
      }
      for (const [id, g] of views) {
        if (alive.has(id)) continue;
        g.removeFromParent();
        views.delete(id);
      }
    },
  };
}
