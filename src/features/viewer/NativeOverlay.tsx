import { getSet, paneCount, useSession } from '../../app/store';
import { controllers } from '../../imaging/rendering/controller';
import {
  nativeCompatibility,
  nativeReference,
  nativeReferenceLabel,
  nativeReferenceColors,
  nearestNative,
  planeOffset,
  projectToNativePlane,
  insideNativeImage,
} from '../../imaging/nativeGeometry';

export function NativeOverlay({ index }: { index: number }) {
  const state = useSession();
  const p = state.panes[index],
    set = getSet(p.setId),
    shared = state.nativePoint;
  const source = getSet(shared?.setId),
    v = controllers[index].viewport;
  if (!state.nativeLinks || !p.linked || p.mode !== 'stack' || !set || !v) return null;
  if (!shared || !source)
    return (
      <div className="native-status">
        Link stacks and choose Crosshair to select a shared point.
      </div>
    );
  const match = nearestNative(source, set, shared.point);
  if (match.reason)
    return (
      <div className="native-status" role="status">
        {match.reason}
      </div>
    );
  if (p.displayed < 0 || p.pending || p.error) return null;
  const frame = set.frames[p.displayed];
  const offset = Math.abs(planeOffset(frame, shared.point));
  const outside = match.outside || !insideNativeImage(frame, shared.point);
  const cross = insideNativeImage(frame, shared.point)
    ? v.worldToCanvas(projectToNativePlane(frame, shared.point))
    : undefined;
  const references = state.panes.slice(0, paneCount(state.layout)).flatMap((other, i) => {
    if (
      i === index ||
      !other.linked ||
      other.mode !== 'stack' ||
      other.pending ||
      other.error ||
      other.displayed < 0 ||
      !controllers[i].viewport
    )
      return [];
    const target = getSet(other.setId);
    if (!target || nativeCompatibility(set, target)) return [];
    const reference = nativeReference(frame, target.frames[other.displayed]);
    return [{ pane: i + 1, reference }];
  });
  const lines = references.flatMap(({ pane, reference }) =>
    reference.relation === 'intersecting'
      ? [{ pane, points: reference.segment.map((point) => v.worldToCanvas(point)) }]
      : [],
  );
  return (
    <>
      <svg className="crosshair native-crosshair" aria-hidden="true">
        {lines.map(({ pane, points: [a, b] }, lineIndex) => (
          <g key={pane} style={{ stroke: nativeReferenceColors[pane - 1] }}>
            <line
              style={{ stroke: nativeReferenceColors[pane - 1] }}
              data-reference-pane={pane}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
            />
            <text
              style={{ fill: nativeReferenceColors[pane - 1] }}
              x={(a[0] + b[0]) / 2 + 8}
              y={(a[1] + b[1]) / 2 - 8 - lineIndex * 16}
            >
              Pane {pane}
            </text>
          </g>
        ))}
        {cross && (
          <g className={offset > 0.01 || outside ? 'approximate' : ''}>
            <path d={`M ${cross[0] - 12} ${cross[1]} h 24 M ${cross[0]} ${cross[1] - 12} v 24`} />
            <circle cx={cross[0]} cy={cross[1]} r="5" />
          </g>
        )}
      </svg>
      <div className="native-status" role="status">
        Native · {p.displayed === match.index ? 'nearest-slice' : 'displayed-slice'} offset{' '}
        {offset.toFixed(2)} mm
        {outside && ' · Outside acquired coverage (nearest edge/plane shown)'}
        <small>Cross = projected shared point; lines = acquired planes (may overlap)</small>
        {references
          .filter(({ reference }) => reference.relation !== 'intersecting')
          .map(({ pane, reference }) => (
            <div key={pane} className="native-reference-status">
              Pane {pane}: {nativeReferenceLabel(reference)}
            </div>
          ))}
      </div>
    </>
  );
}
