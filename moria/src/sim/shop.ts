import { INVENTORY_SIZE, LEGEND_AXE, LEGEND_SEAL, rollItem, type Item } from './items';
import type { Sim } from './types';

/**
 * 상점과 대장장이 (계획서 8장 NPC — 레벨 2 상호작용: 대화 = 상점 열기).
 * 사고파는 것도 입력 명령(InputFrame.cmd = 210 + 물건 번호)이라 리플레이가 재현한다. 시뮬레이션이 '그 NPC 곁인가'를 다시 확인한다.
 *   상인: 예비 횃불(최대 4), 미스릴, 장비 꾸러미(정교 이상 하나).
 *   대장장이(구역 4 모루가 타오른 뒤): 전설 무기 '두린의 도끼' 제작 — 미스릴 6 + 금화 150, 한 번.
 *   책을 모두 모으면(12조각) 화면이 CMD_BOOK을 보내 '발린의 인장'을 받는다 (조각은 구역마다 흩어져 있어 시뮬레이션 하나는 전체 수를 모른다).
 */
export type NpcKind = 'merchant' | 'smith';
export const CMD_BUY = 210;
export const CMD_BOOK = 209;
export const MAX_SPARE = 4;

export type Offer = { npc: NpcKind; name: string; desc: string; gold: number; mithril: number };
export const OFFERS: readonly Offer[] = [
  { npc: 'merchant', name: '예비 횃불', desc: '들고 다닐 예비 횃불 하나 (최대 4)', gold: 15, mithril: 0 },
  { npc: 'merchant', name: '미스릴 한 덩이', desc: '강화·제작 재료', gold: 60, mithril: 0 },
  { npc: 'merchant', name: '장비 꾸러미', desc: '정교 이상 장비 하나 (무엇이 들었는지는 열어 봐야 안다)', gold: 90, mithril: 0 },
  { npc: 'smith', name: '두린의 도끼 제작', desc: '전설 무기 — 피해 +30%, 강공격 +25% (한 번만)', gold: 150, mithril: 6 },
];

const owns = (sim: Sim, legendary: number) =>
  [...sim.player.inventory, ...sim.player.equipped].some((i) => i?.legendary === legendary);

/** 지금 살 수 없는 까닭 (살 수 있으면 null) — 창과 시뮬레이션이 같은 판정을 쓴다 */
export function cannotBuy(sim: Sim, k: number): string | null {
  const o = OFFERS[k];
  const p = sim.player;
  if (!o) return '없는 물건';
  if (p.gold < o.gold || p.mithril < o.mithril) return '값이 모자란다';
  if (k === 0 && p.spareTorches >= MAX_SPARE) return '더 들 수 없다';
  if ((k === 2 || k === 3) && p.inventory.length >= INVENTORY_SIZE) return '가방이 가득 찼다';
  if (k === 3 && owns(sim, LEGEND_AXE)) return '이미 만들었다';
  if (o.npc === 'smith' && !sim.forge.lit) return '모루가 식어 있다';
  return null;
}

function give(sim: Sim, it: Item) {
  sim.player.inventory.push(it);
  sim.events.push({ type: 'pickup', tick: sim.tick, kind: 'item', amount: 1, name: it.name, grade: it.grade });
}

/** 상점 명령. 처리했으면 true. npc = 지금 곁에 있는 NPC 종류 */
export function applyShopCommand(sim: Sim, cmd: number, npc: NpcKind | null): boolean {
  const p = sim.player;
  if (cmd === CMD_BOOK) {
    if (!owns(sim, LEGEND_SEAL) && p.inventory.length < INVENTORY_SIZE) {
      give(sim, { id: sim.nextItemId++, slot: 'trinket', grade: 4, name: '발린의 인장', affixes: [], legendary: LEGEND_SEAL, upgrade: 0 });
    }
    return true;
  }
  if (cmd < CMD_BUY || cmd >= CMD_BUY + OFFERS.length) return false;
  const k = cmd - CMD_BUY;
  const o = OFFERS[k]!;
  if (npc !== o.npc || cannotBuy(sim, k)) return true;
  p.gold -= o.gold;
  p.mithril -= o.mithril;
  if (k === 0) p.spareTorches++;
  else if (k === 1) p.mithril++;
  else if (k === 2) give(sim, rollItem(sim.rng, sim.nextItemId++, 0, 1));
  else give(sim, { id: sim.nextItemId++, slot: 'weapon', grade: 4, name: '두린의 도끼', affixes: [], legendary: LEGEND_AXE, upgrade: 0 });
  sim.events.push({ type: 'gear', tick: sim.tick, what: 'buy', name: o.name });
  return true;
}
