import type { ZoneId } from './sim/level';
import { LEGEND_AXE, LEGEND_SEAL } from './sim/items';
import { PAGE_COUNT } from './pages';
import type { Sim } from './sim/types';

/**
 * 퀘스트 엔진 (계획서 7장: 퀘스트는 데이터로 정의하고 같은 엔진이 처리한다. 유형 6종 — 도달·처치·수집·호위·방어·퍼즐).
 * 퀘스트 상태를 따로 저장하지 않는다: 단계마다 '시뮬레이션 상태에서 다 됐는가'를 읽는 조건이라, 저장·리플레이·구역 이동이
 * 이미 되살리는 상태(문·화로·보스·등불·방어전·모루·추격)에서 그대로 다시 계산된다. 시뮬레이션은 퀘스트를 모른다(렌더·UI 전용).
 * 호위 유형은 아직 쓰는 퀘스트가 없다.
 */
export type QuestKind = '도달' | '처치' | '수집' | '호위' | '방어' | '퍼즐';

/** 단계 완료 조건 (시뮬레이션 상태를 읽기만 한다) */
type Cond =
  | { c: 'door'; i: number }
  | { c: 'brazier'; i: number }
  | { c: 'bosses' }
  | { c: 'lamps' }
  | { c: 'defenseStarted' }
  | { c: 'defense' }
  | { c: 'forge' }
  | { c: 'chase' }
  | { c: 'never' };

type Step = { text: string; done: Cond };
export type Quest = { id: string; zone: ZoneId | 'all'; title: string; kind: QuestKind; main: boolean; steps: Step[] };

/** 메인 퀘스트: 구역마다 하나, 마지막 단계는 다음 구역으로 가는 길 (그 구역 안에서는 끝나지 않는다) */
export const QUESTS: readonly Quest[] = [
  {
    id: 'z1', zone: 'zone1', title: '서문과 거대 계단', kind: '처치', main: true,
    steps: [
      { text: '서문의 비문을 읽고(E) 문을 열어라', done: { c: 'door', i: 0 } },
      { text: '입구 홀의 화로를 밝혀라(E) — 쉬면 저장된다', done: { c: 'brazier', i: 0 } },
      { text: '트롤 굴의 동굴 트롤을 쓰러뜨려라', done: { c: 'bosses' } },
      { text: '트롤 굴 북쪽 통로로 — 21번째 홀', done: { c: 'never' } },
    ],
  },
  {
    id: 'z2', zone: 'zone2', title: '21번째 홀의 등불', kind: '퍼즐', main: true,
    steps: [
      { text: '기둥 사이의 등불 셋을 밝혀라(E)', done: { c: 'lamps' } },
      { text: '북문 앞의 고블린 대장을 쓰러뜨려라', done: { c: 'bosses' } },
      { text: '북문 너머 동문 가는 길로 — 마자르불의 방', done: { c: 'never' } },
    ],
  },
  {
    id: 'z3', zone: 'zone3', title: '봉쇄된 문 지키기', kind: '방어', main: true,
    steps: [
      { text: '방 가운데 발린의 무덤에서 책을 펼쳐라(E)', done: { c: 'defenseStarted' } },
      { text: '양쪽 굴에서 오는 물결을 막아라 — 굴 입구의 금 간 기둥을 무너뜨리면 그쪽이 막힌다', done: { c: 'defense' } },
      { text: '북쪽 쇠문 너머로 — 대장간', done: { c: 'never' } },
    ],
  },
  {
    id: 'z4', zone: 'zone4', title: '드워프 모루 재가동', kind: '퍼즐', main: true,
    steps: [
      { text: '모루 둘레 발판 셋을 한꺼번에 눌러라 — 횃불을 내려놓아도(F) 눌린다', done: { c: 'forge' } },
      { text: '모루 앞의 우루크 대장을 쓰러뜨려라', done: { c: 'bosses' } },
      { text: '북쪽 쇠문 너머로 — 크하잣둠의 다리', done: { c: 'never' } },
    ],
  },
  {
    id: 'z5', zone: 'zone5', title: '크하잣둠의 다리', kind: '도달', main: true,
    steps: [
      { text: '불길에 따라잡히기 전에 다리까지 달려라', done: { c: 'chase' } },
      { text: '두린의 재앙을 버텨라 — 내리찍은 칼이 박혀 있을 때 가슴을 쳐라', done: { c: 'bosses' } },
      { text: '동문으로 빠져나가라', done: { c: 'never' } },
    ],
  },
];

/** 사이드 퀘스트 (구역을 가리지 않는다) — 진행은 게임 전체 상태(책 조각·장비)에서 */
export type SideStatus = { id: string; title: string; kind: QuestKind; detail: string; done: boolean };

function met(sim: Sim, d: Cond): boolean {
  switch (d.c) {
    case 'door': return sim.doors[d.i]?.open ?? true;
    case 'brazier': return sim.braziers[d.i]?.lit ?? true;
    case 'bosses': return sim.bosses.every((id) => sim.enemies.find((e) => e.id === id)?.ai === 'dead');
    case 'lamps': return sim.lamps.every((l) => l.lit);
    case 'defenseStarted': return sim.defense.state !== 'idle';
    case 'defense': return sim.defense.state === 'done';
    case 'forge': return sim.forge.lit;
    case 'chase': return sim.chase.state === 'done';
    case 'never': return false;
  }
}

/** 단계 뒤에 붙는 진행도 (등불 2/3, 물결 2/3, 발판 1/3) */
function progress(sim: Sim, d: Cond): string {
  if (d.c === 'lamps') return ` (${sim.lamps.filter((l) => l.lit).length}/${sim.lamps.length})`;
  if (d.c === 'defense' && sim.defense.state !== 'idle') return ` (물결 ${Math.min(sim.defense.wave + 1, sim.level.defense?.waves.length ?? 0)}/${sim.level.defense?.waves.length ?? 0})`;
  if (d.c === 'forge') return ` (${sim.forge.plates.filter(Boolean).length}/${sim.forge.plates.length})`;
  return '';
}

export type MainStatus = { quest: Quest; current: number; text: string };

/** 이 구역 메인 퀘스트의 지금 단계 (앞 단계가 다 돼야 다음 단계 — 단계는 순서대로 읽힌다) */
export function mainStatus(sim: Sim): MainStatus | null {
  const q = QUESTS.find((x) => x.main && x.zone === sim.level.id);
  if (!q) return null;
  let i = 0;
  while (i < q.steps.length - 1 && met(sim, q.steps[i]!.done)) i++;
  const s = q.steps[i]!;
  return { quest: q, current: i, text: s.text + progress(sim, s.done) };
}

export function sideStatus(sim: Sim, pages: number): SideStatus[] {
  const owns = (l: number) => [...sim.player.inventory, ...sim.player.equipped].some((i) => i?.legendary === l);
  return [
    { id: 'book', title: '마자르불의 책', kind: '수집', detail: `구역마다 흩어진 조각 ${pages}/${PAGE_COUNT} — 다 모으면 발린의 인장`, done: pages >= PAGE_COUNT || owns(LEGEND_SEAL) },
    { id: 'axe', title: '두린의 도끼', kind: '수집', detail: '대장간의 모루를 지핀 뒤 대장장이 그로르에게 — 미스릴 6 · 금화 150', done: owns(LEGEND_AXE) },
  ];
}
