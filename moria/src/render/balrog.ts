import {
  AdditiveBlending, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, RingGeometry, Shape, ShapeGeometry, SphereGeometry, type Object3D,
} from 'three/webgpu';
import { angleToRad } from '../core/trig';
import { DT } from '../core/loop';
import { ENDING, SLAM_HALF, SLAM_LEN, SLAM_WINDUP, WAVE_SPEED, WAVE_WINDUP, WHIP_WINDUP, WIND_WINDUP } from '../sim/balrog';
import type { Sim, SimEvent } from '../sim/types';
import type { Backend } from './renderer';

/**
 * 크하잣둠의 다리 연출 (렌더 전용): 발로그(도형으로 짠 그림자와 불), 간달프, 불의 벽, 기술 예고.
 *   발로그: 검은 몸 + 가슴 균열(칼이 박혀 있는 동안 밝게 = 지금 쳐라) + 뿔 + 날개 둘 + 불칼 + 채찍 + 몸의 불꽃·광원.
 *   예고: 내리찍기 = 바닥의 붉은 띠(굳는 순간 진해진다), 채찍 = 가는 붉은 선, 불의 고리 = 퍼지는 고리, 날개 바람 = 그쪽 날개가 들린다.
 *   불의 벽: 추격 동안 홀을 가득 채운 불의 판 + 광원.
 * 사람 모양 에셋 없이 도형으로 짠다 (계획서 11장: 발로그는 그림자와 불 — 윤곽보다 빛이 중요하다).
 */
export function createBalrogView(sim: Sim, parent: Object3D, backend: Backend) {
  const boss = () => sim.enemies.find((e) => e.kind === 'balrog');
  if (!boss()) return { update() {}, onEvent() {} };
  const dark = new MeshStandardMaterial({ color: 0x120806, roughness: 0.9 });
  const fireMat = new MeshBasicMaterial({ color: new Color(1.0, 0.45, 0.08) });
  const coreMat = new MeshBasicMaterial({ color: new Color(0.5, 0.12, 0.02) });
  const swordMat = new MeshBasicMaterial({ color: new Color(1.0, 0.75, 0.3) });
  const wingMat = new MeshStandardMaterial({ color: 0x1a0d08, roughness: 1, side: DoubleSide, transparent: true, opacity: 0.92 });

  // --- 발로그 (원점 = 발, 앞 = −Z) ---
  const root = new Group();
  const body = new Mesh(new CylinderGeometry(1.3, 0.8, 3.4, 12), dark);
  body.position.y = 3.4;
  const core = new Mesh(new SphereGeometry(0.5, 12, 8), coreMat);
  core.position.set(0, 3.9, -0.75);
  core.scale.set(1, 1.6, 0.4);
  const legs = [-0.55, 0.55].map((x) => {
    const l = new Mesh(new CylinderGeometry(0.4, 0.3, 1.8, 8), dark);
    l.position.set(x, 0.9, 0);
    return l;
  });
  const head = new Mesh(new SphereGeometry(0.6, 12, 8), dark);
  head.position.set(0, 5.6, -0.2);
  const horns = [-1, 1].map((s) => {
    const h = new Mesh(new ConeGeometry(0.16, 1.1, 6), dark);
    h.position.set(0.45 * s, 6.1, -0.1);
    h.rotation.set(-0.5, 0, -0.7 * s);
    return h;
  });
  const eyes = [-1, 1].map((s) => {
    const m = new Mesh(new SphereGeometry(0.08, 6, 4), swordMat);
    m.position.set(0.22 * s, 5.65, -0.72);
    return m;
  });
  // 날개: 어깨에서 뒤·옆으로 펼친 막 (경첩 = 어깨)
  const wingShape = new Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(5.5, 1.8);
  wingShape.lineTo(4.6, -0.6);
  wingShape.lineTo(3.4, -1.4);
  wingShape.lineTo(2.0, -2.2);
  wingShape.lineTo(0, -1.2);
  const wingGeo = new ShapeGeometry(wingShape);
  const wings = [-1, 1].map((s) => {
    const hinge = new Group();
    hinge.position.set(0.9 * s, 4.8, 0.4);
    const w = new Mesh(wingGeo, wingMat);
    w.scale.x = s;
    w.rotation.y = 0.5 * s;
    hinge.add(w);
    return { hinge, s };
  });
  // 불칼 (오른손) — 어깨 경첩에서 앞으로 내리찍는다
  const swordArm = new Group();
  swordArm.position.set(1.5, 4.6, -0.2);
  const sword = new Mesh(new BoxGeometry(0.16, 4.8, 0.36), swordMat);
  sword.position.y = 2.6;
  swordArm.add(sword);
  // 채찍 (왼손): 앞으로 뻗는 가는 선. 길이는 매 프레임 바꾼다
  const whipArm = new Group();
  whipArm.position.set(-1.5, 4.0, -0.2);
  const whip = new Mesh(new BoxGeometry(0.06, 0.06, 1), fireMat);
  whip.visible = false;
  whipArm.add(whip);
  // 몸의 불꽃: 어깨·머리 둘레
  const flameGeo = new IcosahedronGeometry(0.35, 0);
  const flames = Array.from({ length: 9 }, (_, i) => {
    const f = new Mesh(flameGeo, fireMat);
    const a = (i / 9) * Math.PI * 2;
    f.position.set(Math.cos(a) * 1.1, 4.9 + (i % 3) * 0.5, Math.sin(a) * 0.7);
    return f;
  });
  root.add(body, core, ...legs, head, ...horns, ...eyes, ...wings.map((w) => w.hinge), swordArm, whipArm, ...flames);
  root.visible = false;
  parent.add(root);
  const light = new PointLight(0xff6a20, 0, 24, 2);
  light.position.set(0, 4.5, -1.5);
  if (backend === 'webgpu') root.add(light);

  // --- 예고 ---
  const telMat = new MeshBasicMaterial({ color: 0xff3010, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });
  const slamGeo = new PlaneGeometry(SLAM_HALF * 2, SLAM_LEN);
  slamGeo.rotateX(-Math.PI / 2);
  slamGeo.translate(0, 0, -SLAM_LEN / 2);
  const slamStrip = new Mesh(slamGeo, telMat);
  const ringMat = new MeshBasicMaterial({ color: new Color(1, 0.4, 0.05), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const ring = new Mesh(new RingGeometry(0.85, 1, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  slamStrip.visible = ring.visible = false;
  parent.add(slamStrip, ring);

  // --- 불의 벽 (추격) ---
  const chase = sim.level.chase;
  const wallMat = new MeshBasicMaterial({ color: new Color(1, 0.38, 0.06), transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const wall = new Mesh(new PlaneGeometry((chase?.halfWidth ?? 6) * 2, 10), wallMat);
  wall.visible = false;
  parent.add(wall);
  const wallLight = new PointLight(0xff5a18, 0, 18, 2);
  if (backend === 'webgpu') parent.add(wallLight);

  // --- 간달프: 다리 동쪽 끝의 회색 형체 + 지팡이 끝의 흰 빛 ---
  const grey = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 });
  const gandalf = new Group();
  const robe = new Mesh(new ConeGeometry(0.45, 1.7, 10), grey);
  robe.position.y = 0.85;
  const gHead = new Mesh(new SphereGeometry(0.17, 10, 8), grey);
  gHead.position.y = 1.78;
  const hat = new Mesh(new ConeGeometry(0.28, 0.6, 10), grey);
  hat.position.y = 2.05;
  const staff = new Mesh(new CylinderGeometry(0.025, 0.03, 1.9, 6), new MeshStandardMaterial({ color: 0x4a3a2a }));
  staff.position.set(0.35, 0.95, -0.1);
  const staffTip = new Mesh(new SphereGeometry(0.1, 8, 6), new MeshBasicMaterial({ color: 0xffffff }));
  staffTip.position.set(0.35, 1.95, -0.1);
  gandalf.add(robe, gHead, hat, staff, staffTip);
  gandalf.position.set(0, 0, -108);
  gandalf.rotation.y = Math.PI; // 서쪽(+Z)을 본다
  gandalf.visible = false;
  parent.add(gandalf);
  const staffLight = new PointLight(0xdfe8ff, 0, 14, 2);
  staffLight.position.set(0.35, 2.2, -108);
  if (backend === 'webgpu') parent.add(staffLight);

  let clock = 0;
  let flash = 0;
  let fall = 0;
  return {
    onEvent(ev: SimEvent) {
      if (ev.type === 'balrog' && ev.stage === 'break') flash = 1.2;
      if (ev.type === 'balrog' && ev.stage === 'fall') fall = 0.001;
    },
    update(dt: number) {
      clock += dt;
      const e = boss();
      // 불의 벽
      const running = sim.chase.state === 'run';
      wall.visible = running;
      wallLight.intensity = running ? 120 * (0.85 + 0.15 * Math.sin(clock * 13)) : 0;
      if (running && chase) {
        wall.position.set(0, 5, sim.chase.z);
        wallLight.position.set(0, 3, sim.chase.z - 1.5);
        wallMat.opacity = 0.75 + 0.2 * Math.sin(clock * 9);
      }
      if (!e) return;
      const awake = e.ai !== 'patrol';
      gandalf.visible = awake;
      staffLight.intensity = awake ? (flash > 0 ? 400 * flash : 30) : 0;
      flash = Math.max(0, flash - dt);
      staffTip.scale.setScalar(1 + flash * 3);
      if (!awake) {
        root.visible = false;
        light.intensity = 0;
        return;
      }
      const t = e.body.translation();
      if (fall > 0) fall += dt;
      root.visible = fall < 3.5;
      root.position.set(t.x, t.y - 3.2 - fall * fall * 6, t.z);
      root.rotation.y = angleToRad(e.facing);
      light.intensity = fall > 0 ? Math.max(0, 220 * (1 - fall / 3)) : 220 * (0.85 + 0.15 * Math.sin(clock * 11));
      flames.forEach((f, i) => f.scale.set(1, 1 + 0.5 * Math.sin(clock * 8 + i * 1.7), 1));
      const exposed = e.ai === 'stagger';
      coreMat.color.setRGB(exposed ? 1 : 0.5 + 0.1 * Math.sin(clock * 3), exposed ? 0.8 : 0.12, exposed ? 0.4 : 0.02);
      core.scale.set(exposed ? 1.4 : 1, exposed ? 2 : 1.6, 0.4);

      // 동작
      const st = e.swingTick;
      const ending = (e.used & ENDING) !== 0;
      let swordRot = -0.3;
      for (const w of wings) w.hinge.rotation.z = 0.15 * w.s;
      whip.visible = false;
      slamStrip.visible = ring.visible = false;
      if (!ending && e.ai === 'attack') {
        if (e.move === 'slam') {
          const k = Math.min(1, st / SLAM_WINDUP);
          swordRot = -0.3 + 1.1 * k; // 머리 위로 치켜든다 (회전 +x = 칼끝이 뒤로)
          const ax = e.aimX - t.x, az = e.aimZ - t.z;
          slamStrip.visible = true;
          slamStrip.position.set(t.x, 0.06, t.z);
          slamStrip.rotation.y = Math.atan2(-ax, -az);
          telMat.opacity = st < 48 ? 0.15 + 0.2 * k : 0.55 + 0.25 * Math.sin(clock * 30);
        } else if (e.move === 'wind') {
          const k = Math.min(1, st / WIND_WINDUP);
          // 미는 쪽(오른쪽 +1)의 날개가 높이 들린다
          for (const w of wings) if (w.s === e.step) w.hinge.rotation.z = (0.15 + 1.1 * k) * w.s;
        } else if (e.move === 'whip') {
          whip.visible = true;
          const ext = st < WHIP_WINDUP ? 2 : Math.min(18, 2 + (st - WHIP_WINDUP) * 2);
          whip.scale.z = ext;
          whip.position.set(0, -0.6, -ext / 2);
          whipArm.rotation.x = st < WHIP_WINDUP ? 0.8 : 0;
        } else if (e.move === 'wave' && st >= WAVE_WINDUP) {
          const r = (st - WAVE_WINDUP) * DT * WAVE_SPEED;
          ring.visible = true;
          ring.position.set(t.x, 0.15, t.z);
          ring.scale.setScalar(Math.max(0.1, r));
        } else if (e.move === 'wave') {
          for (const w of wings) w.hinge.rotation.z = (0.15 + 0.6 * (st / WAVE_WINDUP)) * w.s;
        }
      } else if (e.ai === 'stagger') swordRot = -2.4; // 앞으로 내리찍어 다리에 박힌 칼
      if (ending) swordRot = -0.3;
      swordArm.rotation.x = swordRot;
    },
  };
}
