import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, SphereGeometry, type Object3D } from 'three/webgpu';
import { angleToRad } from '../core/trig';
import type { Level } from '../sim/level';
import type { Backend } from './renderer';

/**
 * NPC 외형 (렌더 전용): 키 작고 다부진 드워프 — 두건 달린 겉옷, 수염, 등불(상인) 또는 망치(대장장이).
 * 캐릭터 에셋 없이 도형으로 짠다. 상인의 등불은 작은 광원이라 어둠 속에서 '여기 사람이 있다'를 알린다.
 */
export function createNpcView(level: Level, parent: Object3D, backend: Backend) {
  const npcs = level.npcs ?? [];
  if (npcs.length === 0) return;
  const robe = (c: number) => new MeshStandardMaterial({ color: c, roughness: 0.95 });
  const skin = new MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
  const beard = new MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  const glow = new MeshBasicMaterial({ color: 0xffc070 });
  const iron = new MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.7 });
  for (const n of npcs) {
    const g = new Group();
    const body = new Mesh(new CylinderGeometry(0.36, 0.5, 1.0, 12), robe(n.kind === 'smith' ? 0x3a2a20 : 0x3c4a32));
    body.position.y = 0.5;
    const head = new Mesh(new SphereGeometry(0.2, 12, 8), skin);
    head.position.y = 1.22;
    const hood = new Mesh(new ConeGeometry(0.26, 0.4, 12), robe(n.kind === 'smith' ? 0x2a1e18 : 0x2e3a26));
    hood.position.y = 1.45;
    const bd = new Mesh(new ConeGeometry(0.17, 0.5, 8), beard);
    bd.position.set(0, 0.95, -0.14);
    bd.rotation.x = Math.PI;
    g.add(body, head, hood, bd);
    if (n.kind === 'merchant') {
      const lantern = new Mesh(new SphereGeometry(0.09, 8, 6), glow);
      lantern.position.set(0.42, 0.75, -0.15);
      g.add(lantern);
      if (backend === 'webgpu') {
        const l = new PointLight(0xffb060, 8, 6, 2);
        l.position.set(0.42, 0.9, -0.3);
        g.add(l);
      }
    } else {
      const hammer = new Group();
      const handle = new Mesh(new CylinderGeometry(0.03, 0.03, 0.7, 6), beard);
      const headM = new Mesh(new CylinderGeometry(0.09, 0.09, 0.3, 8), iron);
      headM.rotation.z = Math.PI / 2;
      headM.position.y = 0.35;
      hammer.add(handle, headM);
      hammer.position.set(0.45, 0.7, -0.1);
      hammer.rotation.z = 0.4;
      g.add(hammer);
    }
    g.position.set(n.pos[0], n.pos[1], n.pos[2]);
    g.rotation.y = angleToRad(n.facing);
    g.traverse((o) => (o.castShadow = true));
    parent.add(g);
  }
}
