import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { lightForge } from '../src/sim/forge';
import { CMD_UPGRADE } from '../src/sim/gear';
import { nearestInteractable } from '../src/sim/interact';
import { LEGEND_AXE, LEGEND_SEAL } from '../src/sim/items';
import { pathTo } from '../src/sim/nav';
import { CMD_BOOK, CMD_BUY } from '../src/sim/shop';
import { createSim, disposeSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { ZONES } from '../src/sim/zones';
import { PAGE_COUNT, PAGE_TEXTS } from '../src/pages';

/** 상인·대장장이(상점 명령), 발린의 인장, 책 조각 12개 배치 */
const cmd = (c: number): InputFrame => ({ buttons: 0, moveX: 0, moveY: 0, yaw: 0, cmd: c });
const idle: InputFrame = { buttons: 0, moveX: 0, moveY: 0, yaw: 0 };
const put = (s: Sim, x: number, y: number, z: number) => s.player.body.setTranslation({ x, y, z }, true);
const nearNpc = (s: Sim, i: number) => {
  const n = s.level.npcs![i]!;
  put(s, n.pos[0] + 1.2, n.pos[1] + 1.2, n.pos[2]);
  for (let k = 0; k < 3; k++) stepSim(s, idle);
  expect(nearestInteractable(s)).toMatchObject({ kind: 'npc', index: i });
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('상인', () => {
  it('곁에서만 판다: 예비 횃불(최대 4), 미스릴, 장비 꾸러미(정교 이상)', () => {
    const s = createSim(ZONES.zone2, 1);
    for (const e of s.enemies) e.collider.setCollisionGroups(0); // 방해 없이
    s.player.gold = 500;
    // 멀리서는 안 된다
    stepSim(s, cmd(CMD_BUY + 0));
    expect(s.player.spareTorches).toBe(2);
    nearNpc(s, 0);
    stepSim(s, cmd(CMD_BUY + 0));
    expect(s.player.spareTorches).toBe(3);
    expect(s.player.gold).toBe(485);
    stepSim(s, cmd(CMD_BUY + 0));
    stepSim(s, cmd(CMD_BUY + 0)); // 최대 4 — 이건 안 산다
    expect(s.player.spareTorches).toBe(4);
    expect(s.player.gold).toBe(470);
    stepSim(s, cmd(CMD_BUY + 1));
    expect(s.player.mithril).toBe(1);
    stepSim(s, cmd(CMD_BUY + 2));
    expect(s.player.inventory.length).toBe(1);
    expect(s.player.inventory[0]!.grade).toBeGreaterThanOrEqual(1);
    expect(s.player.gold).toBe(470 - 60 - 90);
    // 상인은 도끼를 벼리지 않는다
    s.player.mithril = 10;
    stepSim(s, cmd(CMD_BUY + 3));
    expect(s.player.inventory.length).toBe(1);
    disposeSim(s);
  });
});

describe('대장장이', () => {
  it('모루가 타오른 뒤에만 두린의 도끼를 벼린다 (한 번), 곁에서 강화도 된다', () => {
    const s = createSim(ZONES.zone4, 2);
    for (const e of s.enemies) e.collider.setCollisionGroups(0);
    s.player.gold = 1000;
    s.player.mithril = 20;
    nearNpc(s, 1);
    stepSim(s, cmd(CMD_BUY + 3));
    expect(s.player.inventory.length).toBe(0); // 모루가 식어 있다
    lightForge(s, true);
    stepSim(s, cmd(CMD_BUY + 3));
    expect(s.player.inventory.map((i) => i.legendary)).toEqual([LEGEND_AXE]);
    expect([s.player.gold, s.player.mithril]).toEqual([850, 14]);
    stepSim(s, cmd(CMD_BUY + 3));
    expect(s.player.inventory.length).toBe(1);
    // 장착하고 대장장이 곁에서 강화
    stepSim(s, cmd(100));
    expect(s.player.equipped[0]!.legendary).toBe(LEGEND_AXE);
    stepSim(s, cmd(CMD_UPGRADE + 0));
    expect(s.player.equipped[0]!.upgrade).toBe(1);
    disposeSim(s);
  });
});

describe('마자르불의 책', () => {
  it('조각 12개가 다섯 구역에 한 번씩 놓여 있고, 문장이 있고, 입구에서 걸어갈 수 있다', () => {
    const ids: number[] = [];
    for (const [z, level] of Object.entries(ZONES)) {
      const s = createSim(level, 3);
      for (const pg of level.pages ?? []) {
        ids.push(pg.id);
        const p = pathTo(s.nav, [level.spawn[0], level.spawn[1] - 1, level.spawn[2]], [pg.pos[0], pg.pos[1], pg.pos[2]]);
        expect(p.length, `${z} page ${pg.id}`).toBeGreaterThan(0);
        const e = p[p.length - 1]!;
        expect(Math.hypot(e[0] - pg.pos[0], e[2] - pg.pos[2]), `${z} page ${pg.id}`).toBeLessThan(1.5);
      }
      for (const n of level.npcs ?? []) {
        const p = pathTo(s.nav, [level.spawn[0], level.spawn[1] - 1, level.spawn[2]], [n.pos[0], n.pos[1], n.pos[2]]);
        expect(p.length, `${z} ${n.name}`).toBeGreaterThan(0);
      }
      disposeSim(s);
    }
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: PAGE_COUNT }, (_, i) => i));
    for (const id of ids) expect(PAGE_TEXTS[id]?.length).toBeGreaterThan(10);
  });

  it('다 모으면 발린의 인장 (한 번)', () => {
    const s = createSim(ZONES.zone1, 4);
    stepSim(s, cmd(CMD_BOOK));
    stepSim(s, cmd(CMD_BOOK));
    expect(s.player.inventory.map((i) => i.legendary)).toEqual([LEGEND_SEAL]);
    disposeSim(s);
  });
});
