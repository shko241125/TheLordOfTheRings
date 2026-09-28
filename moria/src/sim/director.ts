import RAPIER from '@dimforge/rapier3d-compat';
import { angleDiff, dAtan2Angle } from '../core/trig';
import { createEnemy } from './enemy';
import { pathTo } from './nav';
import { lightAt } from './perception';
import { G_LEVEL, groups, type DirectorState, type Sim, type SimLight, type V3 } from './types';

/**
 * 북소리 디렉터 (계획서 6장 기둥 2). Left 4 Dead AI Director의 긴장 곡선(고조 → 절정 → 소강 → 휴식)을
 * 쓰되, 그 상태를 '북소리'로 들려준다. 보이지 않는 디렉터가 들리는 디렉터가 되면 플레이어는 조종당한다고
 * 느끼는 대신 예측하고 대비한다 (Vermintide 2의 "뒤에서 갑자기 솟았다" 불만을 피한다).
 *
 *   relax(30~45초, 스폰 없음) → buildup(40~70초 또는 긴장도 ≥ 0.7, 북 60→90 BPM)
 *   → warn(8초 예고, 120 BPM) → peak(물결, 150 BPM, 최소 3초) → fade(소강) → relax
 *
 * 스폰 규칙 3개: ① 플레이어 시야 밖(카메라 앞 70° 안이면서 시선이 트였으면 안 됨) ② 어두운 곳(lightAt < 0.2)
 *               ③ 내비메시 경로 거리 15m 이상
 */
export const RELAX_MIN = 30 * 60;
export const RELAX_MAX = 45 * 60;
export const WARN_TICKS = 8 * 60;
const BUILDUP_MIN = 40 * 60;
const BUILDUP_MAX = 70 * 60;
const PEAK_MAX = 30 * 60;
/** 소강 최대 길이 — 플레이어가 계속 도망쳐 물결이 살아 있어도 다음 순환은 시작된다 */
const FADE_MAX = 60 * 60;
const INTENSITY_TRIGGER = 0.7;
/** 초당 5% 감쇠 → 틱당 (1 − 0.05/60). Math.pow는 명세상 근사라 쓰지 않는다 */
const DECAY_PER_TICK = 1 - 0.05 / 60;
const CALM_RADIUS = 15;
export const SPAWN_MIN_PATH = 15;
export const SPAWN_MAX_LIGHT = 0.2;
export const VIEW_HALF_ANGLE = 796; // 70° (정수 각도)
const WAVE_SIZE = 3;
const MAX_ALIVE = 12;
const CORPSE_TICKS = 20 * 60;

export function createDirector(): DirectorState {
  return { phase: 'relax', phaseTick: 0, phaseLen: RELAX_MIN, intensity: 0, peakMax: 0, cameraYaw: 0, wave: [], bpm: 0 };
}

function enter(sim: Sim, phase: DirectorState['phase'], len = 0) {
  const d = sim.director;
  d.phase = phase;
  d.phaseTick = 0;
  d.phaseLen = len;
  sim.events.push({ type: 'drums', tick: sim.tick, phase });
}

function pathLength(from: V3, pts: readonly V3[]): number {
  let len = 0;
  let prev = from;
  for (const p of pts) {
    len += Math.sqrt((p[0] - prev[0]) ** 2 + (p[1] - prev[1]) ** 2 + (p[2] - prev[2]) ** 2);
    prev = p;
  }
  return len;
}

/** 규칙 3개를 모두 통과하는가 (테스트가 같은 함수로 검증한다) */
export function spawnAllowed(sim: Sim, pt: V3, lights: readonly SimLight[]): boolean {
  const me = sim.player.body.translation();
  // ② 어두운 곳
  if (lightAt(pt[0], pt[1] + 0.3, pt[2], lights) >= SPAWN_MAX_LIGHT) return false;
  // ③ 경로 거리 (직선이 이미 가까우면 경로도 가깝다 → 비싼 경로 탐색 생략)
  const dx = pt[0] - me.x, dz = pt[2] - me.z;
  if (dx * dx + dz * dz < SPAWN_MIN_PATH * SPAWN_MIN_PATH * 0.25) return false;
  const path = pathTo(sim.nav, [me.x, me.y, me.z], pt);
  if (path.length === 0 || pathLength([me.x, me.y, me.z], path) < SPAWN_MIN_PATH) return false;
  // ① 시야 밖: 카메라가 보는 방향 ±70° 안이고 시선이 트였으면 '보이는 곳'
  const off = Math.abs(angleDiff(sim.director.cameraYaw, dAtan2Angle(-dx, -dz)));
  if (off <= VIEW_HALF_ANGLE) {
    const eyeY = me.y + 0.6;
    const ddy = pt[1] + 0.5 - eyeY;
    const d = Math.sqrt(dx * dx + ddy * ddy + dz * dz);
    const hit = sim.world.castRay(new RAPIER.Ray({ x: me.x, y: eyeY, z: me.z }, { x: dx / d, y: ddy / d, z: dz / d }), d, true, undefined, groups(0xffff, G_LEVEL));
    if (!hit || hit.timeOfImpact >= d - 0.1) return false;
  }
  return true;
}

function spawnWave(sim: Sim, lights: readonly SimLight[]): boolean {
  const alive = sim.enemies.filter((e) => e.ai !== 'dead').length;
  const room = Math.min(WAVE_SIZE, MAX_ALIVE - alive);
  if (room <= 0) return false;
  const ok = sim.spawnPoints.filter((p) => spawnAllowed(sim, p, lights));
  if (ok.length === 0) return false;
  const at = ok[sim.rng.int(ok.length)]!;
  // 한 굴 입구에서 줄지어 나온다 (0.9m 간격). 입구 중앙만 검사하면 줄 끝의 한 마리가 기둥 옆으로 보일 수 있다
  // (테스트로 발견) → 한 마리씩 규칙을 다시 확인하고 통과한 자리에만 세운다
  const spots: V3[] = [];
  for (let i = 0; i < room; i++) {
    const pos: V3 = [at[0] + (i - (room - 1) / 2) * 0.9, at[1], at[2]];
    if (i === (room - 1) / 2 || spawnAllowed(sim, pos, lights)) spots.push(pos);
  }
  if (spots.length === 0) return false;
  sim.director.wave = [];
  for (const pos of spots) {
    const e = createEnemy(sim, sim.nextEnemyId++, pos, [pos]);
    // 북소리를 듣고 온 무리 — 처음부터 플레이어를 찾아 나선다
    e.ai = 'chase';
    e.awareness = 1;
    sim.enemies.push(e);
    sim.director.wave.push(e.id);
  }
  sim.events.push({ type: 'wave', tick: sim.tick, count: spots.length });
  return true;
}

/** 오래된 시체 치우기 (물리 바디 제거 — 순서 유지로 결정적) */
function clearCorpses(sim: Sim) {
  for (let i = sim.enemies.length - 1; i >= 0; i--) {
    const e = sim.enemies[i]!;
    if (e.ai === 'dead' && e.aiTick > CORPSE_TICKS) {
      sim.world.removeRigidBody(e.body);
      sim.enemies.splice(i, 1);
    }
  }
}

export function stepDirector(sim: Sim, lights: readonly SimLight[]) {
  const d = sim.director;
  d.phaseTick++;
  const me = sim.player.body.translation();

  // 긴장도 감쇠: 주변 15m에 살아 있는 적이 없을 때만
  const near = sim.enemies.some((e) => {
    if (e.ai === 'dead') return false;
    const t = e.body.translation();
    return (t.x - me.x) ** 2 + (t.z - me.z) ** 2 < CALM_RADIUS * CALM_RADIUS;
  });
  if (!near) d.intensity *= DECAY_PER_TICK;
  const waveAlive = d.wave.filter((id) => sim.enemies.some((e) => e.id === id && e.ai !== 'dead')).length;

  switch (d.phase) {
    case 'relax':
      d.bpm = 0;
      if (d.phaseTick >= d.phaseLen) enter(sim, 'buildup', BUILDUP_MIN + sim.rng.int(BUILDUP_MAX - BUILDUP_MIN + 1));
      break;
    case 'buildup':
      d.bpm = 60 + (30 * Math.min(d.phaseTick, d.phaseLen)) / d.phaseLen;
      // 1초마다 확인: 긴장이 차올랐거나 시간이 됐고, 규칙을 통과하는 자리가 하나라도 있으면 예고 시작
      if ((d.intensity >= INTENSITY_TRIGGER || d.phaseTick >= d.phaseLen) && d.phaseTick % 60 === 0) {
        if (sim.spawnPoints.some((p) => spawnAllowed(sim, p, lights))) enter(sim, 'warn');
      }
      break;
    case 'warn':
      d.bpm = 120;
      if (d.phaseTick >= WARN_TICKS && d.phaseTick % 30 === 0) {
        // 예고가 끝난 순간에도 규칙을 다시 본다 — 그새 플레이어가 그쪽을 보고 있으면 30틱 뒤 다시
        if (spawnWave(sim, lights)) {
          enter(sim, 'peak');
          d.peakMax = d.intensity;
        }
      }
      break;
    case 'peak':
      // 절정은 물결을 치를 때까지: 전멸 / 긴장이 한 번 올랐다(≥0.5) 내려감(<0.3) / 30초
      // (처음엔 '3초 뒤 긴장도 < 0.3이면 끝'이었는데, 물결이 닿기도 전에 끝나 버렸다 — 테스트로 발견)
      d.bpm = 150;
      d.peakMax = Math.max(d.peakMax, d.intensity);
      if (waveAlive === 0 || (d.peakMax >= 0.5 && d.intensity < 0.3) || d.phaseTick >= PEAK_MAX) enter(sim, 'fade');
      break;
    case 'fade':
      d.bpm = Math.max(0, 90 - d.phaseTick * 0.1);
      if ((d.intensity < 0.2 && waveAlive <= 1) || d.phaseTick >= FADE_MAX) enter(sim, 'relax', RELAX_MIN + sim.rng.int(RELAX_MAX - RELAX_MIN + 1));
      break;
  }
  if (sim.tick % 60 === 0) clearCorpses(sim);
}

/** 긴장도 입력: 맞은 피해 비율 */
export function addIntensity(sim: Sim, amount: number) {
  sim.director.intensity = Math.min(1, sim.director.intensity + amount);
}
