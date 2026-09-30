import type { WebGPURenderer } from 'three/webgpu';
import type { Backend } from './renderer';
import type { GameScene } from './scene';

/**
 * 품질 단계 (계획서 11장 성능 예산: Low는 draw call ≤ 100).
 * 비용 대부분은 들고 있는 횃불의 점광원 그림자다 — 그림자 지도 6면마다 그림자를 드리우는 물체를 다시 그린다.
 *   low    그림자 없음, 픽셀 비율 1
 *   medium 그림자 512², 픽셀 비율 ≤ 1.5
 *   high   그림자 1024², 픽셀 비율 ≤ 2
 * 자동 감지: 터치 기기 → low, 코어 4개 이하 또는 WebGL2 폴백 → medium, 그 밖 → high.
 * 실행 중 감시: 처음 5초 평균 FPS가 40 미만이면 한 단계 내린다 (최대 두 번). ?quality= 로 고정하면 감시하지 않는다.
 */
export type Quality = 'low' | 'medium' | 'high';
const ORDER: Quality[] = ['low', 'medium', 'high'];

export function detectQuality(backend: Backend): Quality {
  if (matchMedia('(pointer: coarse)').matches) return 'low';
  if ((navigator.hardwareConcurrency ?? 4) <= 4 || backend === 'webgl2') return 'medium';
  return 'high';
}

export function applyQuality(q: Quality, renderer: WebGPURenderer, gs: GameScene) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const t = gs.playerTorch;
  t.castShadow = q !== 'low';
  const size = q === 'high' ? 1024 : 512;
  if (t.shadow.mapSize.x !== size) {
    t.shadow.mapSize.set(size, size);
    t.shadow.map?.dispose(); // 크기가 바뀌면 그림자 지도를 새로 만든다
    t.shadow.map = null;
  }
}

/** FPS 감시: 한 구간(5초) 평균이 기준 미만이면 한 단계 낮춘 값을 돌려준다 */
export function createQualityGuard(start: Quality, fixed: boolean) {
  let q = start;
  let acc = 0;
  let frames = 0;
  let drops = 0;
  return {
    get quality() {
      return q;
    },
    /** 게임이 실제로 돌 때(시작 화면이 닫힌 뒤)만 부른다. 단계를 바꿔야 하면 새 단계를 돌려준다 */
    frame(dtMs: number): Quality | null {
      if (fixed || drops >= 2) return null;
      acc += dtMs;
      frames++;
      if (acc < 5000) return null;
      const fps = (frames * 1000) / acc;
      acc = 0;
      frames = 0;
      if (fps >= 40 || q === 'low') return null;
      q = ORDER[ORDER.indexOf(q) - 1]!;
      drops++;
      return q;
    },
  };
}
