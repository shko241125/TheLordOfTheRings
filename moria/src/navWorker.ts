import { buildNavMesh } from './sim/nav';
import { ZONES } from './sim/zones';
import { TEST_ROOM } from './sim/level';

/**
 * 내비메시 굽기 워커 (계획서 14장 로딩 전략): 구역 하나 굽는 데 0.2~0.8초(데스크톱) — 모바일에서는 그 몇 배다.
 * 메인 스레드는 그동안 캐릭터 파일 받기·Rapier·렌더러 준비를 한다. 결과는 평범한 객체·배열뿐이라 구조화 복제로 그대로 넘어간다.
 */
self.onmessage = (e: MessageEvent<string>) => {
  const level = e.data === 'test' ? TEST_ROOM : ZONES[e.data as keyof typeof ZONES];
  self.postMessage(buildNavMesh(level));
};
