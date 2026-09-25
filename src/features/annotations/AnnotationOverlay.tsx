import { useRef, useState } from 'react';
import { useSession } from '../../app/store';
import { editMarks, useMarks, type Ellipse } from './model';
export function AnnotationOverlay({ index }: { index: number }) {
  const marks = useMarks((s) => s.panes[index]);
  const color = useMarks((s) => s.color);
  const drawing = useSession((s) => s.tool === 'ellipse' && !!s.panes[index].setId);
  const start = useRef<[number, number] | null>(null);
  const [draft, setDraft] = useState<Ellipse>();
  const point = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  };
  return (
    <svg
      className={`annotations ${drawing ? 'drawing' : ''}`}
      aria-label={`Pane ${index + 1} screen marks`}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        if (!drawing || e.button !== 0) return;
        e.stopPropagation();
        useSession.setState({ active: index });
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const [x, y] = point(e),
          [sx, sy] = start.current;
        setDraft({
          id: crypto.randomUUID(),
          x: (x + sx) / 2,
          y: (y + sy) / 2,
          rx: Math.abs(x - sx) / 2,
          ry: Math.abs(y - sy) / 2,
          color,
        });
      }}
      onPointerUp={() => {
        if (draft && draft.rx > 0.002 && draft.ry > 0.002)
          editMarks(index, { action: 'add', ellipse: draft });
        start.current = null;
        setDraft(undefined);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDraft(undefined);
      }}
    >
      {[...marks, ...(draft ? [draft] : [])].map((m) => (
        <ellipse
          key={m.id}
          cx={m.x}
          cy={m.y}
          rx={m.rx}
          ry={m.ry}
          stroke={m.color}
          fill="none"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
