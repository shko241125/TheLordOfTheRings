import type { Level, ZoneId } from './level';
import { ZONE1 } from './zone1';
import { ZONE2 } from './zone2';

/** 구역 id → 레벨 데이터 (저장·리플레이·구역 이동이 쓴다) */
export const ZONES: Record<ZoneId, Level> = { zone1: ZONE1, zone2: ZONE2 };
export const ZONE_NAMES: Record<ZoneId, string> = { zone1: '서문과 거대 계단', zone2: '21번째 홀' };
