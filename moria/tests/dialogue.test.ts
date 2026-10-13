import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { TREES, view, type Ctx } from '../src/dialogue';
import { createSim, disposeSim, type Sim } from '../src/sim/sim';
import { ZONES } from '../src/sim/zones';

/** 대화 트리 데이터 검사: 잇는 마디가 있고, 모든 마디에 닿을 수 있고, 어떤 상태에서도 선택지가 1~3개, 상점은 갈 수 있을 때만 */
let sims: Sim[] = [];
beforeAll(async () => {
  await RAPIER.init();
  sims = [createSim(ZONES.zone2, 1), createSim(ZONES.zone4, 1), createSim(ZONES.zone5, 1, 'dwarf')];
});

/** 상태 조합: 모루 꺼짐/켜짐 × 광부 기다림/구함 × 책 0/12 */
function contexts(): Ctx[] {
  const out: Ctx[] = [];
  for (const sim of sims) {
    for (const lit of [false, true]) {
      for (const es of ['waiting', 'saved'] as const) {
        for (const pages of [0, 12]) {
          sim.forge.lit = lit;
          sim.escort.state = es;
          out.push({ sim: { ...sim, forge: { ...sim.forge }, escort: { ...sim.escort } } as Sim, pages });
        }
      }
    }
  }
  return out;
}

describe('대화', () => {
  it('선택지가 가리키는 마디가 있고, 시작에서 모든 마디에 닿는다', () => {
    for (const [name, tree] of Object.entries(TREES)) {
      expect(tree.nodes[tree.start], name).toBeDefined();
      const seen = new Set([tree.start]);
      const queue = [tree.start];
      while (queue.length) {
        for (const ch of tree.nodes[queue.shift()!]!.choices) {
          if (!ch.to) continue;
          expect(tree.nodes[ch.to], `${name} → ${ch.to}`).toBeDefined();
          if (!seen.has(ch.to)) {
            seen.add(ch.to);
            queue.push(ch.to);
          }
        }
      }
      expect([...seen].sort(), name).toEqual(Object.keys(tree.nodes).sort());
    }
  });

  it('어떤 상태에서도 보이는 선택지는 1~3개, 말은 비어 있지 않다 (계획서: 분기 최대 3)', () => {
    for (const c of contexts()) {
      for (const [name, tree] of Object.entries(TREES)) {
        for (const id of Object.keys(tree.nodes)) {
          const v = view(tree, id, c);
          expect(v.say.length, `${name}.${id}`).toBeGreaterThan(5);
          expect(v.choices.length, `${name}.${id}`).toBeGreaterThanOrEqual(1);
          // 조건을 통과한 선택지가 3개를 넘는 마디는 없어야 한다 (잘라내기에 기대지 않는다)
          const raw = tree.nodes[id]!.choices.filter((x) => !x.when || x.when(c)).length;
          expect(raw, `${name}.${id}`).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('상인은 늘 상점으로 가고, 대장장이는 모루가 타오른 뒤에만', () => {
    const shop = (name: keyof typeof TREES, c: Ctx) => view(TREES[name], TREES[name].start, c).choices.some((x) => x.action === 'shop');
    for (const c of contexts()) {
      expect(shop('merchant', c)).toBe(true);
      expect(shop('smith', c)).toBe(c.sim.forge.lit);
    }
  });

  it('말이 상태를 따라 바뀐다 (책 조각 수, 광부)', () => {
    const [c0] = contexts();
    const book = view(TREES.merchant, 'book', { ...c0!, pages: 3 }).say;
    expect(book).toContain('3장');
    const saved = contexts().find((c) => c.sim.escort.state === 'saved' && c.sim.level.id === 'zone2')!;
    expect(view(TREES.merchant, 'news', saved).say).toContain('핀');
  });

  it('원정대원: 종족의 동료가 말하고 (구역 5), 발로그 요령을 준다', () => {
    const c = contexts().find((x) => x.sim.level.id === 'zone5')!;
    expect(view(TREES.fellow, 'hi', c).say).toContain('김리');
    expect(view(TREES.fellow, 'balrog', c).say).toContain('가슴');
    const z5 = sims[2]!;
    expect(z5.level.npcs?.some((n) => n.kind === 'fellow')).toBe(true);
  });

  it('정리', () => sims.forEach(disposeSim));
});
