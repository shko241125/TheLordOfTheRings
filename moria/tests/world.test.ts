import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { restoreProgress } from '../src/sim/interact';
import type { ZoneId } from '../src/sim/level';
import { pathTo } from '../src/sim/nav';
import { createSim, disposeSim, stepSim } from '../src/sim/sim';
import { ZONES } from '../src/sim/zones';

/**
 * 세계 연결 무결성 (G2 '새 게임부터 엔딩까지 완주'의 자동 점검 몫): 구역 다섯의 출구·입구·화로·보스가 서로 맞물리는가.
 *   - 출구마다 가는 구역에 그 입구가 있다. 출구는 'end' 하나뿐(구역 5)이고, 새 게임(구역 1)에서 출구를 따라가면 끝에 닿는다.
 *   - 입구에 서면 바닥에 선다(떨어지지 않는다). 출구 상자·화로는 그 구역 시작점에서 걸어갈 수 있다.
 */
const reach = (z: ZoneId, from: readonly number[], to: readonly number[]) => {
  const s = createSim(ZONES[z], 1);
  const p = pathTo(s.nav, [from[0]!, from[1]! - 1, from[2]!], [to[0]!, to[1]!, to[2]!]);
  disposeSim(s);
  return p.length ? Math.hypot(p[p.length - 1]![0] - to[0]!, p[p.length - 1]![2] - to[2]!) : Infinity;
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('세계 연결', () => {
  it('출구마다 가는 구역에 입구가 있고, 구역 1에서 출구를 따라가면 엔딩에 닿는다', () => {
    let ends = 0;
    for (const [z, level] of Object.entries(ZONES)) {
      for (const x of level.exits ?? []) {
        if (x.to === 'end') {
          ends++;
          continue;
        }
        expect(ZONES[x.to].entries?.[x.entry], `${z} → ${x.to}.${x.entry}`).toBeDefined();
      }
    }
    expect(ends).toBe(1);
    // 앞으로만 가는 길: 각 구역에서 '돌아가는' 출구가 아닌 것을 따라간다
    const order: string[] = ['zone1'];
    let cur: ZoneId = 'zone1';
    for (let i = 0; i < 10; i++) {
      const fwd = (ZONES[cur].exits ?? []).find((x) => x.to === 'end' || !order.includes(x.to));
      expect(fwd, cur).toBeDefined();
      if (fwd!.to === 'end') break;
      cur = fwd!.to;
      order.push(cur);
    }
    expect(order).toEqual(['zone1', 'zone2', 'zone3', 'zone4', 'zone5']);
  });

  it('입구에 서면 바닥에 선다 (2초 뒤에도 그 자리)', () => {
    for (const [z, level] of Object.entries(ZONES)) {
      for (const [name, en] of Object.entries(level.entries ?? {})) {
        const s = createSim(level, 2);
        restoreProgress(s, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [] }, name);
        for (const e of s.enemies) e.collider.setCollisionGroups(0);
        for (let i = 0; i < 120; i++) stepSim(s, { buttons: 0, moveX: 0, moveY: 0, yaw: 0 });
        const t = s.player.body.translation();
        expect(Math.abs(t.y - en.pos[1]), `${z}.${name}`).toBeLessThan(0.5);
        expect(s.player.action, `${z}.${name}`).not.toBe('dead');
        disposeSim(s);
      }
    }
  });

  it('출구 상자·화로는 시작점에서 걸어갈 수 있다', () => {
    for (const [z, level] of Object.entries(ZONES) as [ZoneId, (typeof ZONES)[ZoneId]][]) {
      for (const x of level.exits ?? []) {
        const c = [(x.min[0] + x.max[0]) / 2, Math.max(x.min[1], 0), (x.min[2] + x.max[2]) / 2];
        // 출구 상자 중심까지 (상자 반폭 안이면 닿은 것)
        expect(reach(z, level.spawn, c), `${z} exit → ${x.to}`).toBeLessThan(Math.max(1.5, (x.max[2] - x.min[2]) / 2 + 0.5));
      }
      for (const b of level.braziers ?? []) expect(reach(z, level.spawn, [b[0], b[1], b[2] + 1.2]), `${z} brazier`).toBeLessThan(1);
    }
  });
});
