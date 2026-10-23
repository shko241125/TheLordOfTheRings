import { CanvasTexture, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, type Object3D } from 'three/webgpu';
import { MAX_PER_ZONE, type Stain } from '../replay/stains';

/** Stains of the current zone: a faint dark-red rune lying on the floor, pulsing slowly.
 *  Unlit material only — no light sources (WebGL2 forward-lighting budget). One instanced draw. */
function runeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2); // outer ring
  g.stroke();
  g.lineWidth = 7;
  g.beginPath(); // a simple angular glyph: vertical stave with two crossing branches
  g.moveTo(64, 26);
  g.lineTo(64, 102);
  g.moveTo(40, 44);
  g.lineTo(88, 74);
  g.moveTo(88, 44);
  g.lineTo(40, 74);
  g.stroke();
  return new CanvasTexture(c);
}

export function createStainView(parent: Object3D, stains: Stain[]) {
  const mat = new MeshBasicMaterial({
    color: 0x4a0604,
    map: runeTexture(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new InstancedMesh(new PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), mat, MAX_PER_ZONE);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  const m4 = new Matrix4();
  const shown = stains.slice(-MAX_PER_ZONE);
  shown.forEach((s, i) => mesh.setMatrixAt(i, m4.makeRotationY(s.at % 6.283).setPosition(s.x, s.y + 0.02, s.z)));
  mesh.count = shown.length;
  mesh.visible = shown.length > 0;
  parent.add(mesh);
  return {
    /** now: ms (performance.now) — slow 5 s breathing pulse */
    update(now: number) {
      if (mesh.visible) mat.opacity = 0.4 + 0.2 * (0.5 + 0.5 * Math.sin((now / 5000) * Math.PI * 2));
    },
  };
}
