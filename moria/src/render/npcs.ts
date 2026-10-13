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
    const body = new Mesh(new CylinderGeometry(0.36, 0.5, 1.0, 12), robe(n.kind === 'smith' ? 0x3a2a20 : n.kind === 'fellow' ? 0x2c3640 : 0x3c4a32));
    body.position.y = 0.5;
    const head = new Mesh(new SphereGeometry(0.2, 12, 8), skin);
    head.position.y = 1.22;
    const hood = new Mesh(new ConeGeometry(0.26, 0.4, 12), robe(n.kind === 'smith' ? 0x2a1e18 : n.kind === 'fellow' ? 0x232b33 : 0x2e3a26));
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
    // 원정대원: 드워프 도형을 키워 사람 키(≈1.9m)로 — 회색 망토, 손의 무기는 망치 대신 같은 막대(칼자루처럼)
    if (n.kind === 'fellow') g.scale.set(1.15, 1.45, 1.15);
    g.position.set(n.pos[0], n.pos[1], n.pos[2]);
    g.rotation.y = angleToRad(n.facing);
    g.traverse((o) => (o.castShadow = true));
    parent.add(g);
  }
}

/** 호위 대상 (광부): NPC와 같은 드워프 도형 + 곡괭이. 시뮬레이션의 점을 따라 걷고, 다치면 붉게 깜빡인다 */
export function createEscortView(sim: import('../sim/types').Sim, parent: Object3D) {
  if (!sim.level.escort) return { update() {} };
  const robe = new MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95, emissive: 0x000000 });
  const skin = new MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
  const g = new Group();
  const body = new Mesh(new CylinderGeometry(0.34, 0.48, 0.95, 12), robe);
  body.position.y = 0.48;
  const head = new Mesh(new SphereGeometry(0.19, 12, 8), skin);
  head.position.y = 1.15;
  const helm = new Mesh(new SphereGeometry(0.21, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0x5a5048, metalness: 0.5, roughness: 0.6 }));
  helm.position.y = 1.2;
  const beard = new Mesh(new ConeGeometry(0.16, 0.45, 8), new MeshStandardMaterial({ color: 0x9a8a70, roughness: 1 }));
  beard.position.set(0, 0.9, -0.13);
  beard.rotation.x = Math.PI;
  const pick = new Mesh(new CylinderGeometry(0.025, 0.025, 0.8, 6), skin);
  pick.position.set(0.3, 0.9, 0.15);
  pick.rotation.z = -0.6;
  g.add(body, head, helm, beard, pick);
  g.traverse((o) => (o.castShadow = true));
  parent.add(g);
  let px = sim.escort.x, pz = sim.escort.z, lastHp = sim.escort.hp, flash = 0;
  return {
    update(dt: number) {
      const e = sim.escort;
      g.visible = e.state !== 'dead';
      const mx = e.x - px, mz = e.z - pz;
      if (mx * mx + mz * mz > 1e-6) g.rotation.y = Math.atan2(-mx, -mz); // 걷는 쪽을 본다 (앞 = −Z)
      px = e.x;
      pz = e.z;
      // 걸을 때 살짝 흔들린다
      const moving = mx * mx + mz * mz > 1e-5;
      g.position.set(e.x, e.y + (moving ? Math.abs(Math.sin(performance.now() / 120)) * 0.05 : 0), e.z);
      if (e.hp < lastHp) flash = 0.25;
      lastHp = e.hp;
      flash = Math.max(0, flash - dt);
      robe.emissive.setRGB(flash > 0 ? 0.6 : 0, 0, 0);
    },
  };
}
