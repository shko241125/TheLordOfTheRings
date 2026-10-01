import { refreshMods } from './growth';
import { EQUIP_SLOTS, INVENTORY_SIZE, MAX_UPGRADE, rollItem, upgradeCost, type Item } from './items';
import type { Enemy, Sim } from './types';

/**
 * 전리품·인벤토리·장착·강화 (계획서 8장). 규칙만 여기에, 수치는 items.ts.
 *   드롭: 고블린 25%·궁수 30% 장비 + 금화 2~6, 보스(트롤·대장)는 희귀 이상 장비 확정 + 미스릴 2 + 금화 40. 무리(점)는 떨어뜨리지 않는다.
 *   등급: 플레이어의 '어둠 비율'(최근 어둠에 머문 시간의 지수 이동 평균)이 높을수록 좋다 — 빛의 도박(계획서 6장 A).
 *   줍기: 금화·미스릴은 지나가면, 장비는 E. 인벤토리 40칸, 가득 차면 바닥에 남는다. 바닥 전리품은 2분 뒤 사라진다.
 *   명령(InputFrame.cmd): 100+i 장착, 150+s 해제, 160+i 버리기, 200+s 강화(밝힌 화로 곁, 미스릴·금화) — 리플레이가 재현한다.
 */
export type LootDrop = {
  readonly id: number;
  x: number;
  y: number;
  z: number;
  readonly kind: 'item' | 'gold' | 'mithril';
  readonly item: Item | null;
  readonly amount: number;
  ttl: number;
};

const LOOT_TTL = 120 * 60;
const AUTO_PICK_R = 1.4;
export const LOOT_PICK_R = 1.8;
/** 어둠 비율 지수 이동 평균의 틱당 계수 (≈ 8초 시간 상수) */
export const DARK_EMA = 0.998;

export const CMD_EQUIP = 100;
export const CMD_UNEQUIP = 150;
export const CMD_DROP = 160;
export const CMD_UPGRADE = 200;

function place(sim: Sim, x: number, y: number, z: number, kind: LootDrop['kind'], item: Item | null, amount: number) {
  // 겹치지 않게 조금 흩는다 (결정적 난수)
  const ox = (sim.rng.next() - 0.5) * 1.2;
  const oz = (sim.rng.next() - 0.5) * 1.2;
  sim.loot.push({ id: sim.nextLootId++, x: x + ox, y, z: z + oz, kind, item, amount, ttl: LOOT_TTL });
}

/** 적이 쓰러질 때 (enemy.damageEnemy가 부른다) */
export function dropLoot(sim: Sim, e: Enemy) {
  const t = e.body.translation();
  const floor = t.y - 0.8;
  const dark = sim.player.darkness;
  if (e.kind === 'troll' || e.kind === 'captain') {
    place(sim, t.x, floor, t.z, 'item', rollItem(sim.rng, sim.nextItemId++, dark, 2), 0);
    place(sim, t.x, floor, t.z, 'mithril', null, 2);
    place(sim, t.x, floor, t.z, 'gold', null, 40);
    return;
  }
  if (e.fromHorde) return; // 무리 출신은 떨어뜨리지 않는다 (수십 마리 — 바닥이 전리품으로 덮인다)
  place(sim, t.x, floor, t.z, 'gold', null, 2 + sim.rng.int(5));
  if (sim.rng.int(100) < (e.kind === 'archer' ? 30 : 25)) place(sim, t.x, floor, t.z, 'item', rollItem(sim.rng, sim.nextItemId++, dark), 0);
}

/** 틱마다: 금화·미스릴 자동 줍기, 오래된 전리품 치우기 */
export function stepLoot(sim: Sim) {
  if (sim.loot.length === 0) return;
  const p = sim.player;
  const t = p.body.translation();
  sim.loot = sim.loot.filter((l) => {
    if (--l.ttl <= 0) return false;
    if (l.kind === 'item' || p.action === 'dead') return true;
    if ((l.x - t.x) ** 2 + (l.z - t.z) ** 2 > AUTO_PICK_R * AUTO_PICK_R || Math.abs(l.y - (t.y - 1)) > 1.5) return true;
    if (l.kind === 'gold') p.gold += l.amount;
    else p.mithril += l.amount;
    sim.events.push({ type: 'pickup', tick: sim.tick, kind: l.kind, amount: l.amount, name: '', grade: -1 });
    return false;
  });
}

/** E로 장비 줍기 */
export function pickupItem(sim: Sim, lootId: number) {
  const p = sim.player;
  const i = sim.loot.findIndex((l) => l.id === lootId);
  const l = sim.loot[i];
  if (!l || !l.item) return;
  if (p.inventory.length >= INVENTORY_SIZE) {
    sim.events.push({ type: 'pickup', tick: sim.tick, kind: 'full', amount: 0, name: l.item.name, grade: l.item.grade });
    return;
  }
  p.inventory.push(l.item);
  sim.loot.splice(i, 1);
  sim.events.push({ type: 'pickup', tick: sim.tick, kind: 'item', amount: 1, name: l.item.name, grade: l.item.grade });
}

/** 장착 칸: 같은 종류 칸 중 빈 칸, 없으면 첫 칸 */
function slotFor(p: Sim['player'], it: Item): number {
  const idx = EQUIP_SLOTS.flatMap((k, i) => (k === it.slot ? [i] : []));
  return idx.find((i) => !p.equipped[i]) ?? idx[0]!;
}

/** 장비 명령. 처리했으면 true */
export function applyGearCommand(sim: Sim, cmd: number, nearLitBrazier: boolean): boolean {
  const p = sim.player;
  if (cmd >= CMD_EQUIP && cmd < CMD_EQUIP + INVENTORY_SIZE) {
    const it = p.inventory[cmd - CMD_EQUIP];
    if (!it) return true;
    const s = slotFor(p, it);
    p.inventory.splice(cmd - CMD_EQUIP, 1);
    const old = p.equipped[s];
    if (old) p.inventory.push(old);
    p.equipped[s] = it;
    refreshMods(sim);
    sim.events.push({ type: 'gear', tick: sim.tick, what: 'equip', name: it.name });
    return true;
  }
  if (cmd >= CMD_UNEQUIP && cmd < CMD_UNEQUIP + EQUIP_SLOTS.length) {
    const s = cmd - CMD_UNEQUIP;
    const it = p.equipped[s];
    if (!it || p.inventory.length >= INVENTORY_SIZE) return true;
    p.equipped[s] = null;
    p.inventory.push(it);
    refreshMods(sim);
    sim.events.push({ type: 'gear', tick: sim.tick, what: 'unequip', name: it.name });
    return true;
  }
  if (cmd >= CMD_DROP && cmd < CMD_DROP + INVENTORY_SIZE) {
    const it = p.inventory[cmd - CMD_DROP];
    if (!it) return true;
    p.inventory.splice(cmd - CMD_DROP, 1);
    const t = p.body.translation();
    place(sim, t.x, t.y - 1, t.z, 'item', it, 0);
    sim.events.push({ type: 'gear', tick: sim.tick, what: 'drop', name: it.name });
    return true;
  }
  if (cmd >= CMD_UPGRADE && cmd < CMD_UPGRADE + EQUIP_SLOTS.length) {
    const it = p.equipped[cmd - CMD_UPGRADE];
    if (!it || !nearLitBrazier || it.upgrade >= MAX_UPGRADE) return true;
    const c = upgradeCost(it.upgrade + 1);
    if (p.mithril < c.mithril || p.gold < c.gold) return true;
    p.mithril -= c.mithril;
    p.gold -= c.gold;
    it.upgrade++;
    refreshMods(sim);
    sim.events.push({ type: 'gear', tick: sim.tick, what: 'upgrade', name: `${it.name} +${it.upgrade}` });
    return true;
  }
  return false;
}
