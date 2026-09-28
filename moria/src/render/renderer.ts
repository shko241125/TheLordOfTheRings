import { NeutralToneMapping, PCFShadowMap, WebGPURenderer } from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

/**
 * WebGPURenderer 하나로 WebGPU와 WebGL2를 모두 다룬다. 백엔드는 init() 이후에만 확정된다.
 * forceWebGL은 폴백 경로 검증용 (?backend=webgl).
 */
export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL: boolean) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // AgX는 밝은 색을 흰색 쪽으로 채도를 빼서 불꽃·횃불빛이 창백해진다(스크린샷 확인).
  // Khronos PBR Neutral은 색상(hue)과 채도를 보존하도록 설계된 톤매핑이다.
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap은 r186 WebGPURenderer에서 제거됨 (지정하면 경고 후 PCF로 대체)
  renderer.shadowMap.type = PCFShadowMap;
  // isWebGPUBackend는 WebGPUBackend 하위 클래스에만 선언돼 있어 in으로 좁힌다
  const backend: Backend = 'isWebGPUBackend' in renderer.backend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
