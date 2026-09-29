import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three/webgpu';
import { createAudio } from './audio/audio';
import { createInput } from './core/input';
import { DT, createFixedStep } from './core/loop';
import { angleDiff, angleToRad } from './core/trig';
import { playerPose } from './render/actionTime';
import { createFollowCamera } from './render/camera';
import { loadCharacter, type RigId } from './render/character';
import { createGoblins } from './render/goblins';
import { createDurinUI } from './render/durin';
import { createHud, createMinimap } from './render/hud';
import { createLocomotion } from './render/locomotion';
import { createPost } from './render/post';
import { dress } from './render/props';
import { createRenderer } from './render/renderer';
import { buildScene, type LooseTorch } from './render/scene';
import { CLASS_STATS, type ClassId } from './sim/classes';
import { nearestInteractable, progressOf, restoreProgress } from './sim/interact';
import { TEST_ROOM } from './sim/level';
import { BTN_WORD, createSim, stepSim } from './sim/sim';
import { ZONE1 } from './sim/zone1';
import { clearSave, loadSave, writeSave } from './save';

const WORLD_SEED = 20260928;
/** 캡슐 중심 → 눈높이 비율 (키 대비) */
const EYE_FROM_CENTER = 0.38;
/** KCC offset: 캡슐은 바닥에서 이만큼 떠 있다 → 발을 바닥에 붙이려면 모델을 이만큼 내린다 */
const KCC_OFFSET = 0.02;
/** 모델 앞(+Z)과 시뮬레이션 facing 0(−Z)의 차이 */
const MODEL_YAW_OFFSET = Math.PI;
/** 내려놓은 횃불은 바닥에 눕힌다 (X축 90°) */
const LYING = { qx: Math.SQRT1_2, qy: 0, qz: 0, qw: Math.SQRT1_2 };
const FILL_INTENSITY = 11;

function param<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(location.search).get(name);
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
}

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hudText = document.getElementById('hud')!;
  const start = document.getElementById('start')!;
  const qs = new URLSearchParams(location.search);
  const forceWebGL = qs.get('backend') === 'webgl';
  const shakeOn = qs.get('shake') !== '0'; // 접근성: 화면 흔들림 끄기
  // 구역: 기본은 구역 1. ?zone=test 는 M0~M1 시험 방 (결정성 골든·전투 검증용 — 저장하지 않는다)
  const testRoom = qs.get('zone') === 'test';
  const level = testRoom ? TEST_ROOM : ZONE1;
  if (qs.get('new') === '1') clearSave();
  const save = testRoom ? null : loadSave();
  // 이어하기면 저장의 종족을 따른다 (URL로 바꾸려면 ?new=1)
  const classId = save?.classId ?? param<ClassId>('class', ['human', 'dwarf', 'elf'], 'human');
  const rigId = param<RigId>('rig', ['ual', 'kaykit'], 'ual');
  const stats = CLASS_STATS[classId];

  await RAPIER.init();
  const { renderer, backend } = await createRenderer(canvas, forceWebGL);
  const sim = createSim(level, WORLD_SEED, classId);
  if (save) restoreProgress(sim, save.progress);
  const gs = buildScene(level, renderer, backend);
  const minimap = createMinimap(level);
  const rig = await loadCharacter(classId, rigId);
  const dressing = dress(rig, classId);
  const loco = createLocomotion(rig, stats);
  gs.scene.add(rig.root);
  const goblins = await createGoblins(sim, gs.scene);
  const hud = createHud();
  const follow = createFollowCamera();
  const input = createInput(canvas);
  const durin = createDurinUI(
    () => input.pulse(BTN_WORD),
    () => input.release(),
  );
  if (save) start.insertAdjacentHTML('beforeend', '<small>이어하기: 마지막으로 쉰 화로에서 · <a href="?new=1" style="color:#cbbd9e">새 게임</a></small>');
  const loop = createFixedStep();
  const post = createPost(renderer, gs.scene, follow.camera);
  const audio = createAudio();
  // 절정의 북 박자에 맞춰 게임패드 진동 (지원하는 브라우저·패드만 — Firefox는 미지원)
  audio.onBeat((strong) => {
    const pad = navigator.getGamepads?.().find((g) => g?.mapping === 'standard');
    void pad?.vibrationActuator?.playEffect('dual-rumble', { duration: 90, strongMagnitude: strong ? 0.6 : 0.3, weakMagnitude: 0.15 }).catch(() => {});
  });
  let sense = { x: 0, y: 0, z: 0, maxR: 0, start: -1 };

  // 보간용: 직전 틱과 현재 틱의 상태
  const footDrop = stats.capsuleHalf + stats.capsuleRadius + KCC_OFFSET;
  const height = 2 * (stats.capsuleHalf + stats.capsuleRadius);
  const prev = { pos: new Vector3(), facing: 0, vx: 0, vz: 0 };
  const curr = { pos: new Vector3(), facing: 0, vx: 0, vz: 0 };
  const capture = (o: typeof prev) => {
    const t = sim.player.body.translation();
    o.pos.set(t.x, t.y, t.z);
    o.facing = sim.player.facing;
    o.vx = sim.player.vx;
    o.vz = sim.player.vz;
  };
  capture(prev);
  capture(curr);
  let lastLandedTick = sim.player.landedTick;
  let visualY = curr.pos.y;
  let sprintAmount = 0;
  let shake = 0;

  const view = new Vector3();
  const eye = new Vector3();
  const flame = new Vector3();
  const looseList: LooseTorch[] = [];

  start.addEventListener('click', () => {
    void input.lock();
    void audio.unlock(); // 자동재생 정책: 사용자 클릭 안에서만 소리를 켤 수 있다
  });
  document.addEventListener('pointerlockchange', () => {
    start.style.display = document.pointerLockElement === canvas ? 'none' : 'grid';
  });
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    follow.resize();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    // 쓰러지면 새로고침 → 저장(마지막 화로)에서 다시 시작
    if (e.code === 'KeyR' && sim.player.action === 'dead') location.reload();
    if (e.code === 'KeyE' && nearestInteractable(sim)?.kind === 'door') {
      e.preventDefault(); // 이 E가 방금 포커스를 받은 입력창에 'e'로 들어가지 않게
      durin.open();
    }
  });

  const dev = import.meta.env.DEV ? await import('./dev').then((m) => m.attachDev(renderer, gs, backend)) : null;

  let last = performance.now();
  let fpsAcc = 0;
  let fpsFrames = 0;
  let landedAirThisFrame = 0;
  // 개발 전용: 자동 검증이 포인터 잠금 없이 버튼을 누를 수 있게 (프로덕션 빌드에서는 항상 0)
  let devButtons = 0;
  let devButtonsUntil = 0;
  let devPose: import('./render/locomotion').ActionPose = null;

  renderer.setAnimationLoop((now: number) => {
    const frameMs = now - last;
    last = now;
    const dt = Math.min(frameMs, 100) / 1000;
    input.frame(now);

    // 락온: 카메라가 대상을 향해 돈다 (카메라 요는 입력의 기준이므로 이동도 대상 기준이 된다)
    const lockT = sim.player.lockTarget >= 0 ? sim.enemies.find((e) => e.id === sim.player.lockTarget) : undefined;
    if (lockT) {
      const t = lockT.body.translation();
      const me = sim.player.body.translation();
      const want = Math.atan2(-(t.x - me.x), -(t.z - me.z)); // 렌더 전용 → Math.atan2 허용
      let d = want - input.view.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      input.view.yaw += d * (1 - Math.exp(-8 * dt));
      input.view.pitch += (-0.22 - input.view.pitch) * (1 - Math.exp(-4 * dt));
    }

    const { steps, alpha } = loop.advance(frameMs);
    for (let i = 0; i < steps; i++) {
      Object.assign(prev, { facing: curr.facing, vx: curr.vx, vz: curr.vz });
      prev.pos.copy(curr.pos);
      const frame = input.sample();
      if (import.meta.env.DEV && now < devButtonsUntil) frame.buttons |= devButtons;
      stepSim(sim, frame);
      capture(curr);
      goblins.capture();
      if (sim.player.landedTick !== lastLandedTick) {
        lastLandedTick = sim.player.landedTick;
        landedAirThisFrame = sim.player.landedAirTicks * DT;
      }
    }

    // --- 시뮬레이션 사건 → 연출 ---
    for (const ev of sim.events.splice(0)) {
      goblins.onEvent(ev);
      audio.event(ev);
      if (ev.type === 'rest') {
        const saved = !testRoom && writeSave(classId, progressOf(sim));
        hud.toast(`${ev.first ? '화로가 타오른다' : '불 곁에서 쉬었다'}${saved ? ' · 저장됨' : ''}`, 1.6);
      } else if (ev.type === 'door') hud.toast('두린의 문이 열린다', 1.6);
      if (ev.type === 'sense') sense = { x: ev.x, y: ev.y, z: ev.z, maxR: ev.radius, start: now };
      else if (ev.type === 'hit' && ev.dark >= 1.35) hud.toast('어둠의 일격', 0.45);
      if (ev.type === 'parry') {
        hud.toast('패링!');
        shake = Math.max(shake, 0.12);
      } else if (ev.type === 'playerHit') shake = Math.max(shake, 0.3);
      else if (ev.type === 'hit' && ev.heavy) shake = Math.max(shake, 0.15);
    }

    // 히트스톱 중에는 애니메이션도 멈춘다 (시뮬레이션이 멈춘 만큼 화면도 멈춰야 타격이 '박힌다')
    const animDt = sim.hitstop > 0 ? 0 : dt;

    // --- 플레이어 보간·애니메이션 ---
    view.lerpVectors(prev.pos, curr.pos, alpha);
    const facing = angleToRad(prev.facing + angleDiff(prev.facing, curr.facing) * alpha);
    const vx = prev.vx + (curr.vx - prev.vx) * alpha;
    const vz = prev.vz + (curr.vz - prev.vz) * alpha;
    const speed = Math.hypot(vx, vz);
    // 계단 autostep은 틱마다 0.2m씩 튄다 → 접지 중에는 화면 높이만 부드럽게 따라간다 (물리는 그대로)
    visualY = sim.player.grounded ? visualY + (view.y - visualY) * (1 - Math.exp(-20 * dt)) : view.y;
    rig.root.position.set(view.x, visualY - footDrop, view.z);
    rig.root.rotation.y = facing + MODEL_YAW_OFFSET;
    const fx = -Math.sin(facing);
    const fz = -Math.cos(facing);
    const forwardAccel = ((curr.vx - prev.vx) * fx + (curr.vz - prev.vz) * fz) / DT;
    const turnRate = angleToRad(angleDiff(prev.facing, curr.facing)) / DT;
    const sprinting = speed > stats.jogSpeed + 0.3 && sim.player.action === 'free';
    sprintAmount += ((sprinting ? 1 : 0) - sprintAmount) * (1 - Math.exp(-4 * dt));

    loco.update(
      animDt,
      {
        speed,
        grounded: sim.player.grounded,
        crouching: sim.player.crouching,
        airTime: sim.player.airTicks * DT,
        landedAir: landedAirThisFrame,
        forwardAccel,
        turnRate,
      },
      import.meta.env.DEV && devPose ? devPose : playerPose(sim.player, rig.actions, sim.hitstop > 0 ? 0 : alpha),
    );
    landedAirThisFrame = 0;
    const grip = dressing.weapon;
    if (grip?.combat) grip.group.quaternion.slerpQuaternions(grip.rest, grip.combat, loco.weaponActionWeight());

    // 손의 횃불 (들고 있을 때만) + 광원을 손의 불꽃 위치로
    const holding = sim.player.heldTorch >= 0;
    dressing.torch.group.visible = holding;
    rig.root.updateMatrixWorld(true);
    dressing.torch.flame.getWorldPosition(flame);
    gs.playerTorch.position.copy(flame);

    // 떨어진·날아가는 횃불
    looseList.length = 0;
    for (const t of sim.torches) {
      if (t.state === 'held') continue;
      const q = t.body ? t.body.rotation() : null;
      looseList.push(q ? { x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w } : { x: t.x, y: t.y - 0.1, z: t.z, ...LYING });
    }
    gs.update(view, looseList, holding);
    gs.props(dt, sim.doors.map((d) => d.open), sim.braziers.map((b) => b.lit), view);

    // --- 돌의 감각 (후처리 음파 + 움직이는 고블린 드러내기) ---
    const st = sense.start < 0 ? -1 : (now - sense.start) / 1000;
    post.setSense(sense.x, sense.y, sense.z, sense.maxR, st);
    const senseR = st < 0 ? 0 : sense.maxR * Math.min(1, st);
    const senseS = st < 0 ? 0 : st < 3 ? 1 : Math.max(0, 1 - (st - 3) / 0.5);
    Object.assign(goblins.sense, { x: sense.x, z: sense.z, radius: senseR, strength: senseS });

    // --- 적 ---
    goblins.update(animDt, sim.hitstop > 0 ? 1 : alpha, follow.camera, gs.seen); // 방 가시성은 지난 프레임 cull 결과 (1프레임 지연)

    // --- 스팅 경보: 20m 안에 살아 있는 적이 있으면 칼날이 푸르게 (가까울수록 밝게) ---
    if (dressing.blade) {
      let nearest = Infinity;
      for (const e of sim.enemies) {
        if (e.ai === 'dead') continue;
        const t = e.body.translation();
        nearest = Math.min(nearest, Math.hypot(t.x - view.x, t.z - view.z));
      }
      const k = Math.max(0, Math.min(1, (20 - nearest) / 15));
      dressing.blade.emissive.setRGB(0.12 * k, 0.35 * k, 1.1 * k);
    }

    audio.update(sim.director.bpm, sim.director.phase);

    // --- 카메라 ---
    eye.set(view.x, visualY + height * EYE_FROM_CENTER, view.z);
    follow.update(dt, eye, input.view.yaw, input.view.pitch, sprintAmount, sim.world, sim.player.collider);
    if (shakeOn && shake > 0.001) {
      follow.camera.position.x += (Math.random() - 0.5) * shake * 0.3; // 렌더 전용 흔들림 (시뮬레이션과 무관)
      follow.camera.position.y += (Math.random() - 0.5) * shake * 0.3;
    }
    shake = Math.max(0, shake - dt * 1.8);
    gs.fill.position.copy(follow.camera.position).y += 0.6;
    // 보조광은 카메라에 달려 있다 → 카메라가 벽에 걸려 다가오면 캐릭터가 하얗게 탄다(스크린샷).
    // 점광원 조도 ∝ 세기/거리² 이므로 거리² 비율로 줄여 캐릭터가 받는 밝기를 일정하게 한다.
    gs.fill.intensity = FILL_INTENSITY * (follow.arm / follow.armMax) ** 2;

    hud.update(dt, sim, lockT ? goblins.screenPos(lockT.id, follow.camera) : null);
    const target = nearestInteractable(sim);
    hud.prompt(target, durin.isOpen || sim.player.action !== 'free');
    const hint = durin.update(dt, target?.kind === 'door');
    if (hint) hud.toast(hint, 6);
    const room = gs.roomAt(view);
    minimap?.visit(room);
    minimap?.draw(sim, view.x, view.z, input.view.yaw);
    const visibleRooms = gs.cull(follow.camera, view);
    post.render();
    dev?.update();

    fpsAcc += frameMs;
    fpsFrames++;
    if (fpsAcc >= 500) {
      const fps = (fpsFrames * 1000) / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
      const s = gs.stats();
      const alive = sim.enemies.filter((e) => e.ai !== 'dead').length;
      hudText.textContent =
        `${backend.toUpperCase()} · ${fps.toFixed(0)} FPS · 조명 ${s.lightingMode}(${s.torchLights}) · ${classId}/${rigId}\n` +
        `속도 ${speed.toFixed(2)} m/s · ${sim.player.action} · 고블린 ${alive}/${sim.enemies.length} · 공격권 ${sim.tokens} · ` +
        `북 ${sim.director.phase} ${sim.director.bpm.toFixed(0)}bpm 긴장 ${sim.director.intensity.toFixed(2)} · ` +
        `tick ${sim.tick} · draw ${renderer.info.render.drawCalls} · 방 ${room >= 0 ? level.rooms![room]!.name : '-'} (보임 ${visibleRooms.join(',')})`;
    }
  });

  if (import.meta.env.DEV) {
    // 자동화 검증용 (Playwright). 프로덕션 빌드에는 포함되지 않는다.
    (window as unknown as { __moria: unknown }).__moria = {
      backend,
      classId,
      rigId,
      sim,
      rig,
      audio,
      renderer,
      input,
      loco: () => loco.debug(),
      lighting: () => gs.stats(),
      determinism: async () => (await import('./dev')).runDeterminism(),
      /** 전투 클립의 특정 시각 자세로 고정 (검증 스크린샷용). null이면 해제 */
      posePreview: (slot: import('./render/character').ActionSlot | null, time = 0) => {
        devPose = slot ? { slot, time } : null;
      },
      actionInfo: () => Object.fromEntries(Object.entries(rig.actions).map(([k, v]) => [k, { dur: +v.clip.duration.toFixed(2), impact: +v.impact.toFixed(2), tracks: v.clip.tracks.length }])),
      press: (bits: number, ms: number) => {
        devButtons = bits;
        devButtonsUntil = performance.now() + ms;
      },
      teleport: (x: number, y: number, z: number, facing = 0) => {
        sim.player.body.setTranslation({ x, y, z }, true);
        sim.player.facing = facing;
        sim.player.vx = sim.player.vz = 0;
        capture(prev);
        capture(curr);
        visualY = y;
      },
    };
  }
}

boot().catch((err: unknown) => {
  const el = document.getElementById('error')!;
  el.style.display = 'grid';
  el.textContent = `시작하지 못했습니다.\n\n${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`;
  console.error(err);
});
