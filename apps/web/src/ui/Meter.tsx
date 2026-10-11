import { formatCost } from './model';

/** The budget as a row of perforations: twelve holes, lit from the left as the run spends. */
export function Meter({ spent, budget, hole = 9, height = 13, gap = 5 }: { spent: number; budget: number; hole?: number; height?: number; gap?: number }) {
  const n = 12;
  const lit = budget > 0 ? Math.min(spent / budget, 1) * n : 0;
  const width = n * (hole + gap) - gap;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${formatCost(spent, budget)} spent`} style={{ display: 'block', flex: 'none' }}>
      {Array.from({ length: n }, (_, i) => {
        const part = Math.max(0, Math.min(1, lit - i));
        const x = i * (hole + gap);
        return (
          <g key={i}>
            <rect x={x} width={hole} height={height} rx="2.2" fill="#1e2b27" />
            {part > 0 ? <rect x={x} width={hole * part} height={height} rx={part === 1 ? 2.2 : 1} fill="#dfe6e3" /> : null}
          </g>
        );
      })}
    </svg>
  );
}
