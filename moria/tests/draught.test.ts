import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { restoreGear } from '../src/sim/growth';
import { nearestInteractable } from '../src/sim/interact';
import { CMD_BUY, DRAUGHT_HEAL, MAX_DRAUGHTS, OFFERS } from '../src/sim/shop';
import { createSim, disposeSim, hashSim, stepSim, type InputFrame } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { BTN_DRINK } from '../src/sim/types';
import { ZONES } from '../src/sim/zones';
import { migrate } from '../src/save';

/** 치유 약초 (계획서 8장 상인의 소모품): 사고, R로 먹고, 스냅샷·저장에 남는다 */
const idle: InputFrame = { buttons: 0, moveX: 0, moveY: 0, yaw: 0 };
const drink: InputFrame = { ...idle, buttons: BTN_DRINK };
const DRAUGHT = OFFERS.findIndex((o) => o.name === '치유 약초');

beforeAll(async () => {
  await RAPIER.init();
});

describe('치유 약초', () => {
  it('상인 곁에서 최대 3개까지 산다 (옛 품목 번호는 그대로)', () => {
    expect(DRAUGHT).toBe(4);
    const s = createSim(ZONES.zone2, 1);
    for (const e of s.enemies) e.collider.setCollisionGroups(0);
    s.player.gold = 500;
    const n = s.level.npcs!.findIndex((x) => x.kind === 'merchant');
    const pos = s.level.npcs![n]!.pos;
    s.player.body.setTranslation({ x: pos[0] + 1.2, y: pos[1] + 1.2, z: pos[2] }, true);
    for (let k = 0; k < 3; k++) stepSim(s, idle);
    expect(nearestInteractable(s)).toMatchObject({ kind: 'npc', index: n });
    for (let k = 0; k < MAX_DRAUGHTS + 1; k++) stepSim(s, { ...idle, cmd: CMD_BUY + DRAUGHT });
    expect(s.player.draughts).toBe(MAX_DRAUGHTS);
    expect(s.player.gold).toBe(500 - MAX_DRAUGHTS * OFFERS[DRAUGHT]!.gold);
    disposeSim(s);
  });

  it('누른 순간 하나 먹는다: 체력이 찼거나 행동 중이면 아끼고, 없으면 아무 일도 없다', () => {
    const s = createSim(ZONES.zone1, 2);
    s.player.draughts = 2;
    stepSim(s, idle);
    stepSim(s, drink); // 체력이 가득 — 아낀다
    expect(s.player.draughts).toBe(2);
    stepSim(s, idle);
    s.player.hp = 30;
    stepSim(s, drink);
    expect(s.player.hp).toBe(30 + DRAUGHT_HEAL);
    expect(s.player.draughts).toBe(1);
    stepSim(s, drink); // 누르고 있는 동안은 한 번
    expect(s.player.draughts).toBe(1);
    stepSim(s, idle);
    s.player.hp = 90;
    stepSim(s, drink); // 넘치지 않는다
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.player.draughts).toBe(0);
    stepSim(s, idle);
    s.player.hp = 50;
    stepSim(s, drink); // 다 먹었다
    expect(s.player.hp).toBe(50);
    disposeSim(s);
  });

  it('스냅샷·저장으로 이어진다, 손상된 값은 걸러낸다', () => {
    const a = createSim(ZONES.zone1, 3);
    a.player.draughts = 2;
    const b = restoreSim(ZONES.zone1, 3, 'human', takeSnapshot(a));
    expect(b.player.draughts).toBe(2);
    for (let i = 0; i < 30; i++) {
      stepSim(a, idle);
      stepSim(b, idle);
    }
    expect(hashSim(b)).toBe(hashSim(a));
    const gear = { inventory: [], equipped: [null, null, null, null, null, null], gold: 0, mithril: 0 };
    const save = (g: object) => ({ v: 5, classId: 'human', zone: 'zone1', entry: null, progress: {}, growth: { level: 1, xp: 0, points: 0, skills: [] }, gear: g, pages: [] });
    expect(migrate(save({ ...gear, draughts: 2 }))?.gear.draughts).toBe(2);
    expect(migrate(save({ ...gear, draughts: 99 }))?.gear.draughts).toBe(MAX_DRAUGHTS);
    expect(migrate(save(gear))?.gear.draughts ?? 0).toBe(0); // 약초 전의 저장 (0이면 필드를 두지 않는다)
    const c = createSim(ZONES.zone1, 4);
    restoreGear(c, { ...gear, draughts: 3 });
    expect(c.player.draughts).toBe(3);
    [a, b, c].forEach(disposeSim);
  });
});
