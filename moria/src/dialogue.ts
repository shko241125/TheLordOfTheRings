import { PAGE_COUNT } from './pages';
import type { Sim } from './sim/types';

/**
 * NPC 대화 (계획서 8장 NPC 레벨 2 상호작용: 분기 선택지 최대 3개, 상점 열기로 이어진다. 호감도·도덕성은 1.0 범위 밖).
 * 대화는 데이터 트리다: 마디 = 말 한 줄 + 선택지(최대 3) — 선택지는 다른 마디로 가거나, 상점을 열거나, 닫는다.
 * 말과 선택지는 게임 상태(모루·광부·책 조각)를 보고 고른다 — 상태를 바꾸지 않으므로 시뮬레이션·저장과 무관하다 (UI 전용).
 */
export type Ctx = { sim: Sim; pages: number };
type Text = string | ((c: Ctx) => string);
export type Choice = { label: Text; to?: string; action?: 'shop' | 'close'; when?: (c: Ctx) => boolean };
export type Node = { say: Text; choices: Choice[] };
export type Tree = { start: string; nodes: Record<string, Node> };

const t = (x: Text, c: Ctx) => (typeof x === 'function' ? x(c) : x);
const bye: Choice = { label: '다음에 보세.', action: 'close' };

export const TREES: Record<'merchant' | 'smith' | 'miner', Tree> = {
  merchant: {
    start: 'hi',
    nodes: {
      hi: {
        say: '어둠 속에서 장사라니, 미쳤다고들 하지. 그래도 금은 금이야. 뭘 찾나?',
        choices: [
          { label: '물건을 보자.', action: 'shop' },
          { label: '이 근처 소식은?', to: 'news' },
          bye,
        ],
      },
      news: {
        say: (c) =>
          c.sim.escort.state === 'saved' ? '핀을 데려와 줬다지? 그 친구 말이, 홀 구석구석에 아직 우리 사람들 기록이 흩어져 있다더군.'
          : c.sim.level.escort ? '홀 북동쪽 구석에서 누가 곡괭이로 벽을 두드려. 갇힌 광부일 거야 — 고블린 틈을 뚫고 데려올 배짱이 있다면.'
          : c.sim.forge.lit ? '모루가 다시 노래하는 소리가 여기까지 들려. 그로르가 신이 났겠군.'
          : '대장간 모루가 식은 지 오래야. 발판 셋을 한꺼번에 눌러야 깨어난다던데, 혼자서는 어림없지.',
        choices: [
          { label: '마자르불의 책 조각을 아나?', to: 'book' },
          { label: '물건을 보자.', action: 'shop' },
          bye,
        ],
      },
      book: {
        say: (c) => c.pages >= PAGE_COUNT ? '열두 장을 다 모았다고? 발린 공도 편히 쉬시겠군.' : `발린 원정대의 기록 말인가. 지금 ${c.pages}장… 구석과 막다른 굴을 살펴. 그들은 숨어서 적었으니까.`,
        choices: [{ label: '고맙네.', to: 'hi' }, bye],
      },
    },
  },
  smith: {
    start: 'hi',
    nodes: {
      hi: {
        say: (c) => (c.sim.forge.lit ? '모루가 다시 노래하는군! 미스릴만 가져오면 왕의 도끼를 벼려 주지.' : '모루가 식었다. 이대로는 쇠 한 조각 못 다룬다.'),
        choices: [
          { label: '도끼를 벼려 주게.', action: 'shop', when: (c) => c.sim.forge.lit },
          { label: '모루를 어떻게 깨우나?', to: 'forge', when: (c) => !c.sim.forge.lit },
          { label: '두린의 도끼란?', to: 'axe' },
          bye,
        ],
      },
      forge: {
        say: '발판 셋이 한꺼번에 눌려야 해. 셋이 아니면… 횃불이라도 올려놓게. 불은 무게가 없지만 모루는 불을 알아본다네.',
        choices: [{ label: '해 보지.', action: 'close' }, { label: '도끼 이야기를 해 주게.', to: 'axe' }],
      },
      axe: {
        say: '두린 왕의 도끼를 본떠 벼린 것이지. 미스릴 여섯, 금화 백오십. 베는 맛이 다르다네. 곁에서라면 다른 무기도 손봐 주지.',
        choices: [{ label: '보여 주게.', action: 'shop', when: (c) => c.sim.forge.lit }, bye],
      },
    },
  },
  miner: {
    start: 'hi',
    nodes: {
      hi: {
        say: '살았다… 고맙소. 갇혀 있는 동안 고블린 발소리를 세며 버텼지.',
        choices: [
          { label: '왜 혼자 남았나?', to: 'why' },
          { label: '도움이 될 이야기는?', to: 'tip' },
          bye,
        ],
      },
      why: {
        say: '광맥을 쫓다 굴이 무너졌소. 동료들은 동문 쪽으로 갔는데… 그 뒤로 소식이 없소.',
        choices: [{ label: '다른 이야기를.', to: 'hi' }, bye],
      },
      tip: {
        say: '무리는 횃불빛 안으로 잘 안 들어오오. 등을 벽에 붙이고, 동료를 부를 힘은 아껴 두시오 — 이제는 더 빨리 찰 거요.',
        choices: [{ label: '고맙네.', to: 'hi' }, bye],
      },
    },
  },
};

/** 화면에 보일 마디: 말과, 지금 고를 수 있는 선택지(조건을 통과한 것, 최대 3) */
export function view(tree: Tree, id: string, c: Ctx) {
  const n = tree.nodes[id]!;
  return { say: t(n.say, c), choices: n.choices.filter((x) => !x.when || x.when(c)).slice(0, 3).map((x) => ({ ...x, label: t(x.label, c) })) };
}
