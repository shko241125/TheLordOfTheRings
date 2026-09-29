import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import Stats from 'stats-gl';
import type { WebGPURenderer } from 'three/webgpu';
import type { GameScene } from './render/scene';
import type { Backend } from './render/renderer';
import { TEST_ROOM, type Level } from './sim/level';
import { ZONE1 } from './sim/zone1';
import { ZONE1_TICKS, scriptedInputs, zone1Inputs } from './sim/scripted';
import { createSim, disposeSim, hashSim, stepSim } from './sim/sim';

/** 개발 빌드 전용: 성능 패널 + 조명 튜닝 패널. main.ts가 import.meta.env.DEV일 때만 동적 import 한다. */
export async function attachDev(renderer: WebGPURenderer, gs: GameScene, backend: Backend) {
  const stats = new Stats({ trackGPU: false });
  await stats.init(renderer);
  document.body.appendChild(stats.dom);

  const gui = new GUI({ title: `dev · ${backend}` });
  const fog = gs.scene.fog as { density: number };
  gui.add(fog, 'density', 0, 0.12, 0.001).name('안개 밀도');
  gui.add(gs.playerTorch, 'distance', 4, 30, 0.5).name('횃불 거리');
  gui.add(renderer, 'toneMappingExposure', 0.2, 3, 0.05).name('노출');
  gui.close();

  return { update: () => stats.update() };
}

/**
 * tests/determinism.test.ts와 같은 조건으로 브라우저 엔진에서 해시를 계산한다.
 * 렌더러 없이도 돌도록 Rapier 초기화를 직접 한다 (init은 중복 호출해도 안전함을 확인).
 */
export async function runDeterminism(): Promise<{ hashes: number[]; longHashes: number[]; zone1: number[] }> {
  await RAPIER.init();
  const seed = 20260928;
  const run = (ticks: number, every: number, level: Level = TEST_ROOM, inputs = scriptedInputs) => {
    const sim = createSim(level, seed);
    const out: number[] = [];
    for (const f of inputs(seed, ticks)) {
      stepSim(sim, f);
      sim.events.length = 0;
      if (sim.tick % every === 0) out.push(hashSim(sim));
    }
    disposeSim(sim);
    return out;
  };
  return { hashes: run(600, 60), longHashes: run(6000, 600), zone1: run(ZONE1_TICKS, 300, ZONE1, zone1Inputs) };
}

/** 캐릭터 이동 클립 분석 결과 (무미끄럼 속도·발 위상) — 에셋 교체 시 확인용 */
export async function inspectCharacter(classId: 'human' | 'dwarf' | 'elf', rigId: 'ual' | 'kaykit') {
  const { loadCharacter } = await import('./render/character');
  const rig = await loadCharacter(classId, rigId);
  const out = Object.fromEntries(
    Object.entries(rig.loco).map(([k, v]) => [k, { clip: v.clip.name, dur: +v.clip.duration.toFixed(3), noSlip: +v.noSlip.toFixed(2), phase: +v.footPhase.toFixed(3) }]),
  );
  rig.dispose();
  return { scale: +rig.scale.toFixed(3), torchLayer: rig.torchLayer?.tracks.length ?? 0, loco: out };
}

/** 공격 클립의 휘두르기 구간 분석 (개발용): 손 속도 곡선에서 봉우리(휘두르기)를 찾는다 */
export async function swingProfile(url: string, clipName: string, handName: string, samples = 120) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { AnimationMixer, Vector3, PropertyBinding } = await import('three/webgpu');
  const gltf = await new GLTFLoader().loadAsync(url);
  const clip = gltf.animations.find((c) => c.name === clipName);
  if (!clip) return 'missing';
  const mixer = new AnimationMixer(gltf.scene);
  const a = mixer.clipAction(clip).play();
  const hand = gltf.scene.getObjectByName(PropertyBinding.sanitizeNodeName(handName))!;
  const p = new Vector3(), q = new Vector3();
  const speed: number[] = [];
  for (let i = 0; i <= samples; i++) {
    a.time = (clip.duration * i) / samples;
    mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
    hand.getWorldPosition(p);
    if (i > 0) speed.push(+(p.distanceTo(q) / (clip.duration / samples)).toFixed(2));
    q.copy(p);
  }
  const peaks = speed.map((v, i) => ({ t: +((clip.duration * (i + 1)) / samples).toFixed(2), v }))
    .filter((s, i) => s.v > 2 && s.v >= (speed[i - 1] ?? 0) && s.v >= (speed[i + 1] ?? 0));
  return { duration: clip.duration, maxSpeed: Math.max(...speed), peaks };
}
