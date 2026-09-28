import { RenderPipeline, Vector3, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { abs, float, fwidth, getViewPosition, length, pass, screenUV, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';

/**
 * 후처리 파이프라인 (TSL — WebGPU·WebGL2 양쪽에서 같은 코드).
 * 지금은 '돌의 감각' 음파 하나: 깊이 버퍼로 화면 픽셀의 월드 위치를 되살려,
 *  - 파면(반경 r) 근처를 청백색 띠로 칠하고
 *  - 이미 지나간 안쪽은 깊이 기울기(fwidth)로 윤곽을 은은하게 드러낸다 (어둠 속 기둥·계단 모양이 보인다)
 * 계획서 6장 D: "TSL 후처리 노드: 깊이 버퍼로 월드 위치를 복원하고 |dist − radius(t)|에 smoothstep".
 */
export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');

  const origin = uniform(new Vector3());
  const radius = uniform(0);
  const maxRadius = uniform(20);
  const strength = uniform(0);

  // 주의: 후처리 출력 노드 안에서 cameraProjectionMatrixInverse·cameraWorldMatrix는 '전체 화면 사각형을 그리는 카메라'를
  // 가리킨다 (첫 구현에서 음파가 보이지 않았던 원인). three의 GTAONode처럼 장면 카메라 행렬을 직접 uniform으로 넘긴다.
  // uniform은 행렬 객체를 참조하므로 카메라가 매 프레임 갱신하는 값을 그대로 따라간다.
  const projInv = uniform(camera.projectionMatrixInverse);
  const camWorld = uniform(camera.matrixWorld);
  const viewPos = getViewPosition(screenUV, depth, projInv);
  const worldPos = camWorld.mul(vec4(viewPos, 1)).xyz;
  const dist = length(worldPos.sub(origin));
  const tint = vec3(0.5, 0.72, 1.0);
  // 파면: 두께 약 0.8m의 띠
  const ring = smoothstep(float(0.8), float(0), abs(dist.sub(radius)));
  // 안쪽 윤곽: 깊이가 '끊기는' 곳(모서리)만. fwidth(z)는 비스듬한 평면에서도 거리에 비례해 커지므로
  // 깊이로 나눈 상대값에 임계를 건다 (절대값을 쓴 첫 구현은 바닥 전체가 하얗게 떴다)
  const rel = fwidth(viewPos.z).div(abs(viewPos.z).max(0.1));
  const edge = smoothstep(float(0.04), float(0.12), rel);
  const inside = step(dist, radius).mul(step(dist, maxRadius));
  const glow = tint.mul(ring.mul(1.6).add(edge.mul(inside).mul(0.7))).mul(strength);
  pipeline.outputNode = vec4(color.rgb.add(glow), color.a);

  return {
    pipeline,
    /** t: 발동 후 경과 초. 1초 동안 퍼지고 2초 유지, 0.5초에 걸쳐 사라진다 */
    setSense(x: number, y: number, z: number, maxR: number, t: number) {
      origin.value.set(x, y, z);
      maxRadius.value = maxR;
      radius.value = maxR * Math.min(1, t / 1.0);
      strength.value = t < 0 ? 0 : t < 3 ? 1 : Math.max(0, 1 - (t - 3) / 0.5);
    },
    render() {
      pipeline.render();
    },
  };
}
