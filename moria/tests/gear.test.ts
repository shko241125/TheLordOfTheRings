import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { CMD_DROP, CMD_EQUIP, CMD_UNEQUIP, CMD_UPGRADE, dropLoot } from '../src/sim/gear';
import { createEnemy, damageEnemy } from '../src/sim/enemy';
import { INVENTORY_SIZE, rollGrade, rollItem, type Item } from '../src/sim/items';
import type { Level } from '../src/sim/level';
import { BTN_INTERACT, BTN_LIGHT, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';

/** 장비·전리품 (계획서 8장): 드롭·어둠 등급·줍기·장착·효과·강화·스냅샷 */
const FLAT: Level = {
  solids: [{ kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' }, { kind: 'cylinder', pos: [6, 0.45, 0], radius: 0.45, halfHeight: 0.45, surface: 'stone' }],
  torches: [],
  spawn: [0, 1.2, 0],
  braziers: [[6, 0, 0]],
};
const idle = (buttons = 0, cmd = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0, ...(cmd ? { cmd } : {}) });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
const weapon = (id: number, grade: number): Item => ({ id, slot: 'weapon', grade, name: '시험 검', affixes: [], legendary: -1, upgrade: 0 });

beforeAll(async () => {
  await RAPIER.init();
});

describe('전리품', () => {
  it('어둠에 오래 머물수록 좋은 등급이 잘 나온다 (빛의 도박)', () => {
    const avg = (dark: number) => {
      const r = createRng(42);
      let sum = 0;
      for (let i = 0; i < 4000; i++) sum += rollGrade(r, dark);
      return sum / 4000;
    };
    expect(avg(1)).toBeGreaterThan(avg(0) + 0.3);
    expect(rollGrade(createRng(1), 0, 2)).toBeGreaterThanOrEqual(2); // 보스: 희귀 이상
    const leg = Array.from({ length: 2000 }, (_, i) => rollItem(createRng(i), i, 1)).find((it) => it.grade === 4)!;
    expect(leg.legendary).toBeGreaterThanOrEqual(0);
  });

  it('고블린은 금화를 떨어뜨리고(자동 줍기), 보스는 희귀 이상 장비 + 미스릴 2 + 금화 40', () => {
    const s = createSim(FLAT, 1);
    run(s, idle(), 10);
    const g = createEnemy(s, s.nextEnemyId++, [0, 1, -3], [[0, 1, -3]]);
    s.enemies.push(g);
    damageEnemy(s, g, 999);
    expect(s.loot.filter((l) => l.kind === 'gold').length).toBe(1);
    const boss = createEnemy(s, s.nextEnemyId++, [0, 1.8, -8], [[0, 1.8, -8]], 'troll');
    s.enemies.push(boss);
    damageEnemy(s, boss, 9999);
    const bossItem = s.loot.find((l) => l.kind === 'item' && Math.abs(l.z + 8) < 1.5)!;
    expect(bossItem.item!.grade).toBeGreaterThanOrEqual(2);
    expect(s.loot.some((l) => l.kind === 'mithril' && l.amount === 2)).toBe(true);
    // 금화·미스릴은 지나가면 줍는다
    const gold0 = s.player.gold;
    for (const l of s.loot.filter((x) => x.kind !== 'item')) {
      s.player.body.setTranslation({ x: l.x, y: 1.2, z: l.z }, true);
      run(s, idle(), 3);
    }
    expect(s.player.gold).toBeGreaterThanOrEqual(gold0 + 42);
    expect(s.player.mithril).toBe(2);
    disposeSim(s);
  });

  it('장비는 E로 줍는다. 인벤토리가 가득 차면 바닥에 남는다', () => {
    const s = createSim(FLAT, 2);
    run(s, idle(), 10);
    s.loot.push({ id: 99, x: 0, y: 0, z: -1, kind: 'item', item: weapon(500, 1), amount: 0, ttl: 1000 });
    stepSim(s, idle(BTN_INTERACT));
    expect(s.player.inventory.map((i) => i.id)).toEqual([500]);
    s.player.inventory = Array.from({ length: INVENTORY_SIZE }, (_, i) => weapon(1000 + i, 0));
    s.loot.push({ id: 100, x: 0, y: 0, z: -1, kind: 'item', item: weapon(600, 2), amount: 0, ttl: 1000 });
    run(s, idle(), 2);
    stepSim(s, idle(BTN_INTERACT));
    expect(s.loot.some((l) => l.id === 100)).toBe(true);
    disposeSim(s);
  });
});

describe('장착·강화', () => {
  it('장착·교체·해제·버리기 (명령 입력), 무기 등급이 실제 피해를 올린다', () => {
    const s = createSim(FLAT, 3);
    run(s, idle(), 10);
    s.player.inventory.push(weapon(1, 2), weapon(2, 4 - 1));
    stepSim(s, idle(0, CMD_EQUIP + 0));
    expect(s.player.equipped[0]!.id).toBe(1);
    expect(s.player.mods.dmg).toBeCloseTo(1.08, 6);
    stepSim(s, idle(0, CMD_EQUIP + 0)); // 인벤토리 0번 = 2번 검 → 교체, 1번 검은 인벤토리로
    expect(s.player.equipped[0]!.id).toBe(2);
    expect(s.player.inventory.map((i) => i.id)).toEqual([1]);
    stepSim(s, idle(0, CMD_UNEQUIP + 0));
    expect(s.player.equipped[0]).toBeNull();
    expect(s.player.mods.dmg).toBeCloseTo(1, 6);
    stepSim(s, idle(0, CMD_DROP + 0));
    expect(s.player.inventory.length).toBe(1);
    expect(s.loot.some((l) => l.item?.id === 1)).toBe(true);
    disposeSim(s);
  });

  it('강화: 밝힌 화로 곁에서만, 미스릴 n + 금화 40·n', () => {
    const s = createSim(FLAT, 4);
    run(s, idle(), 10);
    s.player.inventory.push(weapon(1, 1));
    stepSim(s, idle(0, CMD_EQUIP));
    s.player.mithril = 3;
    s.player.gold = 200;
    stepSim(s, idle(0, CMD_UPGRADE)); // 화로에서 멀다
    expect(s.player.equipped[0]!.upgrade).toBe(0);
    s.player.body.setTranslation({ x: 6, y: 1.2, z: 1.5 }, true);
    run(s, idle(), 10);
    stepSim(s, idle(BTN_INTERACT)); // 화로 밝히기
    run(s, idle(), 2);
    stepSim(s, idle(0, CMD_UPGRADE));
    run(s, idle(), 1);
    stepSim(s, idle(0, CMD_UPGRADE));
    expect(s.player.equipped[0]!.upgrade).toBe(2);
    expect(s.player.mithril).toBe(0);
    expect(s.player.gold).toBe(200 - 40 - 80);
    stepSim(s, idle(0, CMD_UPGRADE)); // 미스릴 부족
    expect(s.player.equipped[0]!.upgrade).toBe(2);
    expect(s.player.mods.dmg).toBeCloseTo(1 + 0.04 + 0.06, 6);
    disposeSim(s);
  });

  it('장비 효과는 실제 타격 피해에 들어간다', () => {
    const hit = (withSword: boolean) => {
      const s = createSim(FLAT, 5);
      run(s, idle(), 10);
      if (withSword) {
        s.player.inventory.push(weapon(1, 3));
        stepSim(s, idle(0, CMD_EQUIP));
      }
      const g = createEnemy(s, s.nextEnemyId++, [0, 1, -1.4], [[0, 1, -1.4]]);
      g.hp = 1000;
      s.enemies.push(g);
      stepSim(s, idle(BTN_LIGHT));
      run(s, idle(), 30);
      const d = 1000 - g.hp;
      disposeSim(s);
      return d;
    };
    expect(hit(true)).toBeGreaterThan(hit(false));
  });

  it('스냅샷은 인벤토리·장착·바닥 전리품을 담는다', () => {
    const s = createSim(FLAT, 6);
    run(s, idle(), 5);
    s.player.inventory.push(weapon(1, 2));
    stepSim(s, idle(0, CMD_EQUIP));
    const g = createEnemy(s, s.nextEnemyId++, [0, 1, -3], [[0, 1, -3]]);
    s.enemies.push(g);
    dropLoot(s, g);
    const b = restoreSim(FLAT, 6, 'human', takeSnapshot(s));
    run(s, idle(), 20);
    run(b, idle(), 20);
    expect(hashSim(b)).toBe(hashSim(s));
    expect(b.player.equipped[0]!.id).toBe(1);
    [s, b].forEach(disposeSim);
  });
});
