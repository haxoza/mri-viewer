import { controllers } from '../imaging/rendering/controller';
import type { Vec3 } from '../imaging/types';
export function panView(index: number, dx: number, dy: number) {
  const v = controllers[index].viewport;
  if (!v) return;
  const a = v.canvasToWorld([0, 0]),
    b = v.canvasToWorld([dx, dy]),
    camera = v.getCamera();
  const delta = a.map((x, i) => x - b[i]);
  v.setCamera({
    position: camera.position!.map((x, i) => x + delta[i]) as Vec3,
    focalPoint: camera.focalPoint!.map((x, i) => x + delta[i]) as Vec3,
  });
  v.render();
}
export function zoomView(index: number, zoom: number) {
  const v = controllers[index].viewport;
  v?.setZoom(Math.max(0.05, Math.min(30, zoom)));
  v?.render();
}
export function windowView(index: number, width: number, center: number) {
  const v = controllers[index].viewport;
  v?.setProperties({ voiRange: { lower: center - width / 2, upper: center + width / 2 } });
  v?.render();
}
