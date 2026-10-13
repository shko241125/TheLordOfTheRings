import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { CMD_STORY_OFF, CMD_STORY_ON, restoreGrowth } from '../src/sim/growth';
import { hitPlayer } from '../src/sim/player';
import { createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONES } from '../src/sim/zones';

/** 스토리 난이도 (계획서 M5 3번): 명령으로 켜고 끄며, 받는 피해가 절반이 되고, 스냅샷·저장에 남는다 */
const idle = (cmd = 0): InputFrame => ({ buttons: 0, moveX: 0, moveY: 0, yaw: 0, ...(cmd ? { cmd } : {}) });
const lost = (s: Sim, dmg: number) => {
  const hp = s.player.hp;
  hitPlayer(s, dmg, 0, -50, 0, { unparryable: true });
  return hp - s.player.hp;
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('스토리 난이도', () => {
  it('켜면 받는 피해가 절반, 끄면 원래대로', () => {
    const s = createSim(ZONES.zone1, 1);
    expect(lost(s, 20)).toBe(20);
    stepSim(s, idle(CMD_STORY_ON));
    expect(s.player.perks).toEqual(['story']);
    expect(lost(s, 20)).toBe(10);
    stepSim(s, idle(CMD_STORY_ON)); // 두 번 켜도 한 번
    expect(s.player.perks).toEqual(['story']);
    stepSim(s, idle(CMD_STORY_OFF));
    expect(lost(s, 20)).toBe(20);
    disposeSim(s);
  });

  it('스냅샷과 저장(perks)으로 이어진다', () => {
    const a = createSim(ZONES.zone1, 2);
    stepSim(a, idle(CMD_STORY_ON));
    const b = restoreSim(ZONES.zone1, 2, 'human', takeSnapshot(a));
    expect(lost(a, 20)).toBe(10);
    expect(lost(b, 20)).toBe(10);
    for (let i = 0; i < 60; i++) {
      stepSim(a, idle());
      stepSim(b, idle());
    }
    expect(hashSim(b)).toBe(hashSim(a));
    const c = createSim(ZONES.zone1, 3);
    restoreGrowth(c, { level: 1, xp: 0, points: 0, skills: [], perks: ['story', 'miner'] });
    expect(c.player.mods.taken).toBe(0.5);
    expect(c.player.mods.ally).toBeCloseTo(1.25);
    [a, b, c].forEach(disposeSim);
  });
});
