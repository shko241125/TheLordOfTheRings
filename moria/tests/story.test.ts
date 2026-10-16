import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CMD_EASY, CMD_HARD, CMD_STORY_OFF, CMD_STORY_ON, difficultyOf, restoreGrowth } from '../src/sim/growth';
import { loadSettings } from '../src/settings';
import { PARRY_WINDOW_FROM, PARRY_WINDOW_TO } from '../src/sim/combat';
import { hitPlayer } from '../src/sim/player';
import { createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONES } from '../src/sim/zones';

/** 스토리 난이도 (계획서 13장·M5 3번): 명령으로 켜고 끄며, 받는 피해가 절반·패링 창이 2배가 되고, 스냅샷·저장에 남는다 */
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

  it('패링 창이 2배: 기본 창이 끝난 뒤에도 같은 길이만큼 더 받아 낸다', () => {
    const s = createSim(ZONES.zone1, 4);
    const at = s.player.body.translation();
    // 바라보는 쪽 2m 앞의 공격자 (방향 규칙은 hitPlayer가 정한다 — 기본 창 안에서 패링되는 자리를 찾는다)
    const tryParry = (tick: number, x: number, z: number) => {
      s.player.action = 'parry';
      s.player.actionTick = tick;
      s.player.hp = s.player.maxHp;
      return hitPlayer(s, 10, x, z, 0, {});
    };
    const spots = [[0, 2], [0, -2], [2, 0], [-2, 0]].map(([dx, dz]) => [at.x + dx!, at.z + dz!] as const);
    const front = spots.find(([x, z]) => tryParry(PARRY_WINDOW_FROM, x, z) === 'parry')!;
    expect(front).toBeDefined();
    const late = PARRY_WINDOW_TO + 5; // 기본 창(12틱) 밖, 2배 창(24틱) 안
    expect(tryParry(late, ...front)).toBe('hit');
    stepSim(s, idle(CMD_STORY_ON));
    expect(s.player.mods.parry).toBe(PARRY_WINDOW_TO - PARRY_WINDOW_FROM);
    expect(tryParry(late, ...front)).toBe('parry');
    expect(tryParry(PARRY_WINDOW_TO + (PARRY_WINDOW_TO - PARRY_WINDOW_FROM), ...front)).toBe('hit'); // 2배 창의 끝
    disposeSim(s);
  });

  it('난이도 3단계 + 스토리: 하나만 켜지고, 받는 피해가 0.5 / 0.75 / 1 / 1.5배', () => {
    const s = createSim(ZONES.zone1, 5);
    restoreGrowth(s, { level: 1, xp: 0, points: 0, skills: [], perks: ['miner'] });
    const seen: [string, number][] = [];
    for (const cmd of [CMD_STORY_ON, CMD_EASY, CMD_STORY_OFF, CMD_HARD]) {
      stepSim(s, idle(cmd));
      seen.push([difficultyOf(s.player.perks), lost(s, 20)]);
      s.player.hp = s.player.maxHp;
    }
    expect(seen).toEqual([['story', 10], ['easy', 15], ['normal', 20], ['hard', 30]]);
    expect(s.player.perks).toEqual(['miner', 'hard']); // 다른 영구 보상은 그대로, 난이도는 하나
    disposeSim(s);
  });
});

describe('난이도 설정', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stored = (v: object) => vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(v) });
  it('M5-E의 story: true는 스토리로 이어 받고, 모르는 값은 보통', () => {
    stored({ story: true });
    expect(loadSettings().difficulty).toBe('story');
    stored({ difficulty: 'hard' });
    expect(loadSettings().difficulty).toBe('hard');
    stored({ difficulty: 'nightmare' });
    expect(loadSettings().difficulty).toBe('normal');
  });
});
