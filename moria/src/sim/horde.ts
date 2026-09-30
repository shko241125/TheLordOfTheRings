import { DEFAULT_QUERY_FILTER, createFindNearestPolyResult, findNearestPoly, type NavMesh } from 'navcat';
import { DT } from '../core/loop';
import { angleDiff, dAtan2Angle } from '../core/trig';
import { createEnemy } from './enemy';
import type { Level } from './level';
import { lightAt } from './perception';
import type { Sim, SimLight, V3 } from './types';

/**
 * 고블린 물결 (계획서 6장 B — Vermintide 2 호드·DRG 스웜). 수백 마리가 밀려오지만 가까운 몇 마리만 '진짜' AI·물리를 갖는다.
 *
 *   진짜 고블린 (sim.enemies): FSM + Rapier KCC + navcat 경로. 공격은 여전히 공격권 2개로 제한.
 *     계획서의 T0(≤8)/T1(≤40) 구분은 하나로 합쳤다 — 공격권이 이미 '때리는 수'를 제한하고, 40마리 KCC 이동도 틱 예산 안이다.
 *   무리 (sim.horde.agents): 물리 없는 점. 1m 격자 흐름장(2Hz 갱신)을 따라 내려가고 서로 밀어낸다.
 *
 * 승격·강등은 어두운 곳(lightAt < 0.2)에서만 한다 → 모습이 바뀌는 순간(인스턴싱 ↔ 스키닝)이 보이지 않는다.
 * 무리는 밝은 곳(> 0.5)으로 들어가지 않는다 → 횃불 든 플레이어 둘레에 '빛의 경계'가 생기고, 경계 밖 어둠에서 한 마리씩 진짜가 된다.
 *
 * 결정성: 격자·거리는 정수, 이웃 순서 고정, 배열 순서대로 처리, 난수는 sim.rng, 삼각함수는 core/trig.
 */
export const HORDE_MAX = 240;
const CELL = 1;
const FIELD_EVERY = 30; // 2Hz
const SPEED = 3.9;
const ACCEL = 14;
const SEP_R = 0.75;
const FEAR_LIGHT = 0.5;
const PROMOTE_R = 12;
const PROMOTE_DARK = 0.2;
/** 진짜 고블린 상한 (살아 있는 수) */
export const REAL_CAP = 24;
const DEMOTE_R = 28;
const UNREACHED = 0x3fffffff;

export type HordeAgent = { readonly id: number; x: number; y: number; z: number; vx: number; vz: number; facing: number };

export type FlowField = {
  minX: number; minZ: number; w: number; h: number;
  /** 칸 바닥 높이 (걸을 수 없으면 NaN) */
  height: Float32Array;
  /** 플레이어 칸까지의 비용 (직선 10, 대각 14) */
  dist: Int32Array;
};

export type Horde = { agents: HordeAgent[]; field: FlowField; nextId: number; size: number };

// 이웃 8방향 (고정 순서 = 동률일 때 결정적 선택)
const NB: readonly [number, number, number][] = [
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [-1, 1, 14], [1, -1, 14], [-1, -1, 14],
];
/** 한 칸 사이 오를 수 있는 높이 (계단 0.2m/0.45m → 1m에 약 0.45m) */
const MAX_STEP = 0.6;

/** 레벨 전체를 덮는 1m 격자에 걸을 수 있는 칸과 높이를 새긴다 (내비메시 기준, 한 번만) */
export function buildField(level: Level, nav: NavMesh): FlowField {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of level.solids) {
    const hx = s.kind === 'box' ? s.half[0] : s.radius;
    const hz = s.kind === 'box' ? s.half[2] : s.radius;
    const hy = s.kind === 'box' ? s.half[1] : s.halfHeight;
    minX = Math.min(minX, s.pos[0] - hx);
    maxX = Math.max(maxX, s.pos[0] + hx);
    minZ = Math.min(minZ, s.pos[2] - hz);
    maxZ = Math.max(maxZ, s.pos[2] + hz);
    maxY = Math.max(maxY, s.pos[1] + hy);
    minY = Math.min(minY, s.pos[1] - hy);
  }
  const w = Math.ceil((maxX - minX) / CELL);
  const h = Math.ceil((maxZ - minZ) / CELL);
  const height = new Float32Array(w * h).fill(NaN);
  const res = createFindNearestPolyResult();
  // 레벨 맨 아래에서 가장 가까운 면 = 바닥. 내비메시에는 천장 지붕 윗면도 '걸을 수 있는 면'으로 들어 있어,
  // 높이 한가운데서 찾으면 기둥 홀(바닥 4m, 지붕 15m)에서 지붕이 잡혔다 → 무리가 공중에 떠서 어둡다고 승격됐다 (브라우저에서 발견).
  // ponytail: 구역 안에 층이 겹치는 곳이 없다는 전제 — 겹치는 구역이 생기면 층별 격자로
  const half: [number, number, number] = [CELL * 0.5, maxY - minY, CELL * 0.5];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = minX + (i + 0.5) * CELL;
      const z = minZ + (j + 0.5) * CELL;
      findNearestPoly(res, nav, [x, minY, z], half, DEFAULT_QUERY_FILTER);
      if (!res.success) continue;
      const [px, py, pz] = res.position;
      if ((px - x) ** 2 + (pz - z) ** 2 < 0.3 * 0.3) height[j * w + i] = py;
    }
  }
  return { minX, minZ, w, h, height, dist: new Int32Array(w * h).fill(UNREACHED) };
}

const cellOf = (f: FlowField, x: number, z: number) => {
  const i = Math.floor((x - f.minX) / CELL);
  const j = Math.floor((z - f.minZ) / CELL);
  return i < 0 || j < 0 || i >= f.w || j >= f.h ? -1 : j * f.w + i;
};
const walkable = (f: FlowField, c: number) => c >= 0 && !Number.isNaN(f.height[c]!);

/** 잔해가 덮은 칸을 막는다 (붕괴 E). 이미 그 칸에 있던 무리는 갇힌다 — 다음 흐름장 갱신부터 반영 */
export function blockCells(sim: Sim, minX: number, minZ: number, maxX: number, maxZ: number) {
  const f = sim.horde?.field;
  if (!f) return;
  for (let z = minZ; z <= maxZ; z += CELL) {
    for (let x = minX; x <= maxX; x += CELL) {
      const c = cellOf(f, x, z);
      if (c >= 0) f.height[c] = NaN;
    }
    const c = cellOf(f, maxX, z);
    if (c >= 0) f.height[c] = NaN;
  }
  for (let x = minX; x <= maxX; x += CELL) {
    const c = cellOf(f, x, maxZ);
    if (c >= 0) f.height[c] = NaN;
  }
}

/** 플레이어 칸에서 퍼지는 정수 비용 다익스트라 (버킷 큐 — 비용이 작은 정수라 힙이 필요 없다) */
export function updateField(f: FlowField, px: number, pz: number) {
  f.dist.fill(UNREACHED);
  const start = cellOf(f, px, pz);
  if (!walkable(f, start)) return;
  const buckets: number[][] = [[start]];
  f.dist[start] = 0;
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (const c of b) {
      if (f.dist[c] !== d) continue;
      const ci = c % f.w;
      const cj = (c - ci) / f.w;
      for (const [di, dj, cost] of NB) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= f.w || nj >= f.h) continue;
        const n = nj * f.w + ni;
        if (!walkable(f, n) || Math.abs(f.height[n]! - f.height[c]!) > MAX_STEP) continue;
        // 대각선은 두 옆 칸이 모두 걸을 수 있어야 (모서리 뚫기 방지)
        if (di !== 0 && dj !== 0 && (!walkable(f, cj * f.w + ni) || !walkable(f, nj * f.w + ci))) continue;
        const nd = d + cost;
        if (nd < f.dist[n]!) {
          f.dist[n] = nd;
          (buckets[nd] ??= []).push(n);
        }
      }
    }
  }
}

export function createHorde(level: Level, nav: NavMesh): Horde | null {
  if (!level.horde) return null;
  return { agents: [], field: buildField(level, nav), nextId: 0, size: level.horde.size };
}

/**
 * 한 굴 입구에서 무리를 쏟아낸다: 입구 칸에서 걸을 수 있는 칸을 넓혀 가며(BFS, 이웃 순서 고정) 한 칸에 4마리씩.
 * (처음의 나선 배치는 폭 2m 굴에서 자리가 모자라 40마리를 다 세우지 못했다 — 테스트로 발견)
 */
export function spawnHorde(sim: Sim, at: V3, count: number): number {
  const h = sim.horde;
  if (!h) return 0;
  const f = h.field;
  const start = cellOf(f, at[0], at[2]);
  if (!walkable(f, start)) return 0;
  const seen = new Set<number>([start]);
  const queue = [start];
  const SLOTS: readonly [number, number][] = [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25]];
  let made = 0;
  for (let q = 0; q < queue.length && made < count && h.agents.length < HORDE_MAX; q++) {
    const c = queue[q]!;
    const ci = c % f.w, cj = (c - ci) / f.w;
    const cx = f.minX + (ci + 0.5) * CELL, cz = f.minZ + (cj + 0.5) * CELL;
    for (const [ox, oz] of SLOTS) {
      if (made >= count || h.agents.length >= HORDE_MAX) break;
      h.agents.push({ id: h.nextId++, x: cx + ox, y: f.height[c]!, z: cz + oz, vx: 0, vz: 0, facing: 0 });
      made++;
    }
    for (const [di, dj] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= f.w || nj >= f.h) continue;
      const n = nj * f.w + ni;
      if (seen.has(n) || !walkable(f, n) || Math.abs(f.height[n]! - f.height[c]!) > MAX_STEP) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return made;
}

/** 원 안의 무리를 없앤다 (트롤 내려찍기·붕괴·광역기). 없앤 수 */
export function killHordeIn(sim: Sim, x: number, z: number, r: number): number {
  const h = sim.horde;
  if (!h) return 0;
  const before = h.agents.length;
  h.agents = h.agents.filter((a) => (a.x - x) ** 2 + (a.z - z) ** 2 >= r * r);
  return before - h.agents.length;
}

export function stepHorde(sim: Sim, lights: readonly SimLight[]) {
  const h = sim.horde;
  if (!h) return;
  const f = h.field;
  const pt = sim.player.body.translation();
  if (sim.tick % FIELD_EVERY === 0) updateField(f, pt.x, pt.z);
  demote(sim, lights);
  if (h.agents.length === 0) return;

  // 공간 해시 (1m 칸 → 요원 목록). 배열 순서대로 넣어 결정적
  const bucket = new Map<number, HordeAgent[]>();
  for (const a of h.agents) {
    const c = cellOf(f, a.x, a.z);
    let l = bucket.get(c);
    if (!l) bucket.set(c, (l = []));
    l.push(a);
  }

  for (const a of h.agents) {
    const c = cellOf(f, a.x, a.z);
    let wx = 0, wz = 0;
    if (walkable(f, c) && f.dist[c]! < UNREACHED) {
      // 흐름장: 비용이 가장 낮은 이웃 칸 중심으로 (플레이어 칸이면 플레이어에게)
      let best = c;
      const ci = c % f.w, cj = (c - ci) / f.w;
      for (const [di, dj] of NB) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= f.w || nj >= f.h) continue;
        const n = nj * f.w + ni;
        if (f.dist[n]! < f.dist[best]!) best = n;
      }
      const bi = best % f.w, bj = (best - bi) / f.w;
      const tx = best === c ? pt.x : f.minX + (bi + 0.5) * CELL;
      const tz = best === c ? pt.z : f.minZ + (bj + 0.5) * CELL;
      const dx = tx - a.x, dz = tz - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      // 빛을 꺼린다: 다음 걸음이 밝으면 멈추고, 이미 밝은 곳이면 물러난다
      if (d > 0.05) {
        const sp = SPEED * (0.85 + ((a.id * 37) % 30) / 100); // 개체마다 조금씩 다른 걸음
        const nx = a.x + (dx / d) * 0.8, nz = a.z + (dz / d) * 0.8;
        const ahead = lightAt(nx, a.y + 0.8, nz, lights);
        if (ahead < FEAR_LIGHT) {
          wx = (dx / d) * sp;
          wz = (dz / d) * sp;
        } else if (lightAt(a.x, a.y + 0.8, a.z, lights) >= FEAR_LIGHT) {
          wx = (-dx / d) * sp * 0.5;
          wz = (-dz / d) * sp * 0.5;
        }
      }
    }
    // 분리: 가까운 동료에게서 밀려난다 (3×3 칸만 본다)
    const ci = c % f.w, cj = (c - ci) / f.w;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const l = bucket.get((cj + dj) * f.w + ci + di);
        if (!l) continue;
        for (const o of l) {
          if (o === a) continue;
          const dx = a.x - o.x, dz = a.z - o.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 1e-6 && d2 < SEP_R * SEP_R) {
            const d = Math.sqrt(d2);
            const push = (SEP_R - d) * 6;
            wx += (dx / d) * push;
            wz += (dz / d) * push;
          }
        }
      }
    }
    // 가속 한계
    const ax = wx - a.vx, az = wz - a.vz;
    const al = Math.sqrt(ax * ax + az * az);
    const max = ACCEL * DT;
    if (al > max) {
      a.vx += (ax / al) * max;
      a.vz += (az / al) * max;
    } else {
      a.vx = wx;
      a.vz = wz;
    }
    // 이동: 걸을 수 없는 칸·높이 차가 큰 칸으로는 그 축 성분을 버린다 (벽을 따라 미끄러진다)
    const hc = f.height[c] ?? a.y;
    const okAt = (x: number, z: number) => {
      const n = cellOf(f, x, z);
      return walkable(f, n) && Math.abs(f.height[n]! - hc) <= MAX_STEP;
    };
    const nx = a.x + a.vx * DT;
    const nz = a.z + a.vz * DT;
    if (okAt(nx, a.z)) a.x = nx;
    else a.vx = 0;
    if (okAt(a.x, nz)) a.z = nz;
    else a.vz = 0;
    const nc = cellOf(f, a.x, a.z);
    if (walkable(f, nc)) a.y += (f.height[nc]! - a.y) * 0.3;
    if (a.vx * a.vx + a.vz * a.vz > 0.05) {
      const want = dAtan2Angle(-a.vx, -a.vz);
      const d = angleDiff(a.facing, want);
      a.facing = (a.facing + (d > 90 ? 90 : d < -90 ? -90 : d)) & 4095;
    }
  }
  promote(sim, lights);
}

/** 어둠 속, 플레이어 12m 안의 무리를 가까운 순서로 진짜 고블린으로 (상한까지) */
function promote(sim: Sim, lights: readonly SimLight[]) {
  const h = sim.horde!;
  const pt = sim.player.body.translation();
  let real = sim.enemies.filter((e) => e.ai !== 'dead' && e.kind === 'goblin').length;
  if (real >= REAL_CAP) return;
  const cand: { a: HordeAgent; d: number }[] = [];
  for (const a of h.agents) {
    const d = (a.x - pt.x) ** 2 + (a.z - pt.z) ** 2;
    if (d < PROMOTE_R * PROMOTE_R && lightAt(a.x, a.y + 0.8, a.z, lights) < PROMOTE_DARK) cand.push({ a, d });
  }
  cand.sort((p, q) => p.d - q.d || p.a.id - q.a.id);
  const gone = new Set<HordeAgent>();
  for (const { a } of cand) {
    if (real >= REAL_CAP) break;
    const e = createEnemy(sim, sim.nextEnemyId++, [a.x, a.y + 0.8, a.z], [[a.x, a.y + 0.8, a.z]]);
    e.ai = 'chase';
    e.awareness = 1;
    e.facing = a.facing;
    e.vx = a.vx;
    e.vz = a.vz;
    e.fromHorde = true;
    sim.enemies.push(e);
    sim.director.wave.push(e.id);
    gone.add(a);
    real++;
  }
  if (gone.size) h.agents = h.agents.filter((a) => !gone.has(a));
}

/** 멀어진(28m+) 무리 출신 고블린은 어둠 속에서 다시 무리로 (싸우는 중이 아닐 때) */
function demote(sim: Sim, lights: readonly SimLight[]) {
  const h = sim.horde!;
  const pt = sim.player.body.translation();
  for (let i = sim.enemies.length - 1; i >= 0; i--) {
    const e = sim.enemies[i]!;
    if (!e.fromHorde || (e.ai !== 'chase' && e.ai !== 'suspicious' && e.ai !== 'patrol') || h.agents.length >= HORDE_MAX) continue;
    const t = e.body.translation();
    if ((t.x - pt.x) ** 2 + (t.z - pt.z) ** 2 < DEMOTE_R * DEMOTE_R || lightAt(t.x, t.y + 0.3, t.z, lights) >= PROMOTE_DARK) continue;
    const c = cellOf(h.field, t.x, t.z);
    if (!walkable(h.field, c)) continue;
    h.agents.push({ id: h.nextId++, x: t.x, y: h.field.height[c]!, z: t.z, vx: e.vx, vz: e.vz, facing: e.facing });
    sim.world.removeRigidBody(e.body);
    sim.enemies.splice(i, 1);
  }
}
