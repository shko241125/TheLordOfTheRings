import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { QUESTS, mainStatus, sideStatus } from '../src/quests';
import { lightForge } from '../src/sim/forge';
import { lightLamp, openDoor } from '../src/sim/interact';
import { createSim, disposeSim, type Sim } from '../src/sim/sim';
import { ZONES } from '../src/sim/zones';

/** 퀘스트 엔진: 구역마다 메인 퀘스트 하나, 단계는 시뮬레이션 상태에서 순서대로 넘어간다 */
const killBosses = (s: Sim) => {
  for (const id of s.bosses) {
    const e = s.enemies.find((x) => x.id === id)!;
    e.hp = 0;
    e.ai = 'dead';
  }
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('퀘스트', () => {
  it('구역 다섯에 메인 퀘스트가 하나씩, 유형은 계획서의 6종 안에서', () => {
    for (const z of Object.keys(ZONES)) expect(QUESTS.filter((q) => q.main && q.zone === z).length, z).toBe(1);
    for (const q of QUESTS) expect(['도달', '처치', '수집', '호위', '방어', '퍼즐']).toContain(q.kind);
  });

  it('구역 1: 문 → 화로 → 트롤 → 북쪽 통로', () => {
    const s = createSim(ZONES.zone1, 1);
    expect(mainStatus(s)!.current).toBe(0);
    openDoor(s, 0);
    expect(mainStatus(s)!.current).toBe(1);
    // 화로를 건너뛰고 트롤을 쓰러뜨려도 화로 단계에 머문다 (순서대로)
    killBosses(s);
    expect(mainStatus(s)!.current).toBe(1);
    s.braziers[0]!.lit = true;
    expect(mainStatus(s)!.current).toBe(3);
    expect(mainStatus(s)!.text).toContain('21번째 홀');
    disposeSim(s);
  });

  it('구역 2: 등불 진행도 (1/3) → 대장 → 동문 길', () => {
    const s = createSim(ZONES.zone2, 2);
    lightLamp(s, 0, true);
    expect(mainStatus(s)!.text).toContain('(1/3)');
    lightLamp(s, 1, true);
    lightLamp(s, 2, true);
    expect(mainStatus(s)!.current).toBe(1);
    killBosses(s);
    expect(mainStatus(s)!.current).toBe(2);
    disposeSim(s);
  });

  it('구역 3·4·5: 방어전 물결, 발판 진행도, 추격', () => {
    const z3 = createSim(ZONES.zone3, 3);
    z3.defense.state = 'wave';
    z3.defense.wave = 1;
    expect(mainStatus(z3)!.text).toContain('물결 2/3');
    z3.defense.state = 'done';
    expect(mainStatus(z3)!.current).toBe(2);
    const z4 = createSim(ZONES.zone4, 4);
    z4.forge.plates[0] = true;
    expect(mainStatus(z4)!.text).toContain('(1/3)');
    lightForge(z4, true);
    expect(mainStatus(z4)!.current).toBe(1);
    const z5 = createSim(ZONES.zone5, 5);
    expect(mainStatus(z5)!.current).toBe(0);
    z5.chase.state = 'done';
    expect(mainStatus(z5)!.current).toBe(1);
    [z3, z4, z5].forEach(disposeSim);
  });

  it('사이드: 책 조각 수, 두린의 도끼', () => {
    const s = createSim(ZONES.zone1, 6);
    expect(sideStatus(s, 5).find((x) => x.id === 'book')).toMatchObject({ done: false });
    expect(sideStatus(s, 5)[0]!.detail).toContain('5/12');
    expect(sideStatus(s, 12)[0]!.done).toBe(true);
    disposeSim(s);
  });
});
