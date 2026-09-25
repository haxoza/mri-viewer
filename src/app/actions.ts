import { useSession } from './store';
import {
  controllers,
  changeLayout,
  openMpr,
  chooseCrosshair,
  sync,
} from '../imaging/rendering/controller';
import type { Plane } from '../imaging/types';
import { panView, windowView, zoomView } from './viewActions';
/** Shared application operations. Callers choose scheduling; controllers own rendering. */
export const viewerActions = {
  setLayout: changeLayout,
  setActivePane: (index: number) => useSession.setState({ active: index }),
  assignView: (index: number, setId: string, mode: 'stack' | Plane = 'stack') =>
    controllers[index].assign(setId, mode),
  setSlice: (index: number, position: number) => controllers[index].navigate(position),
  reset: (index: number, window = true) => controllers[index].reset(window),
  pan: panView,
  window: windowView,
  zoom: zoomView,
  setLinked: (index: number, linked: boolean) => {
    useSession.getState().patch(index, { linked, linkStatus: undefined });
    sync(index);
  },
  openMpr,
  setCrosshair: chooseCrosshair,
};
