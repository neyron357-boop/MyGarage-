/**
 * Tiny top-view diagram that shows where to stand for a photo: the car seen from above
 * (front at the top) and a camera marker at the shooting position.
 */
const POS: Record<string, [number, number]> = {
  front: [50, 7],
  front_right: [87, 13],
  right: [93, 50],
  rear_right: [87, 87],
  rear: [50, 93],
  rear_left: [13, 87],
  left: [7, 50],
  front_left: [13, 13],
  roof: [50, 50],
};

const HIGHLIGHT: Record<string, JSX.Element> = {
  wheels: (
    <g fill="var(--mantine-color-cobalt-6)">
      <rect x="30" y="30" width="5" height="12" rx="2" />
      <rect x="65" y="30" width="5" height="12" rx="2" />
      <rect x="30" y="58" width="5" height="12" rx="2" />
      <rect x="65" y="58" width="5" height="12" rx="2" />
    </g>
  ),
  windshield: <path d="M40 34 Q50 29 60 34 L58 41 L42 41 Z" fill="var(--mantine-color-cobalt-6)" />,
  interior: <rect x="42" y="42" width="16" height="20" rx="3" fill="var(--mantine-color-cobalt-6)" />,
  dashboard: <rect x="41" y="40" width="18" height="5" rx="2" fill="var(--mantine-color-cobalt-6)" />,
  obd: <rect x="41" y="40" width="18" height="5" rx="2" fill="var(--mantine-color-cobalt-6)" />,
};

/** Whether there is a "where to stand" drawing for this slot. */
export const hasAngleHint = (slot: string) => !!POS[slot] || !!HIGHLIGHT[slot];

/**
 * The whole walk-around at a glance (in the camera): the car from above, every shooting position —
 * taken ones green, the current one a blue camera that glides to the next position.
 */
export function WalkMap({ slots, current, done, size = 76 }: { slots: readonly string[]; current: string; done: Set<string>; size?: number }) {
  const pos = POS[current];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="walk-map">
      <rect x="34" y="22" width="32" height="56" rx="11" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" />
      <path d="M40 34 Q50 29 60 34 L58 41 L42 41 Z" fill="rgba(255,255,255,0.55)" />
      <path d="M42 66 L58 66 L60 72 Q50 75 40 72 Z" fill="rgba(255,255,255,0.35)" />
      {HIGHLIGHT[current] && <g style={{ opacity: 0.95 }}>{HIGHLIGHT[current]}</g>}
      {slots.map((s) => {
        const p = POS[s];
        if (!p || s === current) return null;
        return done.has(s) ? (
          <circle key={s} cx={p[0]} cy={p[1]} r="5" fill="var(--mantine-color-green-5)" />
        ) : (
          <circle key={s} cx={p[0]} cy={p[1]} r="4" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" />
        );
      })}
      {pos && (
        <g className="walk-map-cam" style={{ transform: `translate(${pos[0]}px, ${pos[1]}px)` }}>
          <circle r="11" fill="var(--mantine-color-cobalt-5)" opacity="0.35" className="walk-map-pulse" />
          <circle r="7.5" fill="var(--mantine-color-cobalt-5)" stroke="#fff" strokeWidth="2" />
          <circle r="2.6" fill="#fff" />
        </g>
      )}
    </svg>
  );
}

export function AngleHint({ slot, size = 54 }: { slot: string; size?: number }) {
  const pos = POS[slot];
  if (!pos && !HIGHLIGHT[slot]) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <rect x="34" y="22" width="32" height="56" rx="11" fill="var(--app-card)" stroke="var(--mantine-color-gray-5)" strokeWidth="2.5" />
      <path d="M40 34 Q50 29 60 34 L58 41 L42 41 Z" fill="var(--mantine-color-gray-3)" />
      <path d="M42 66 L58 66 L60 72 Q50 75 40 72 Z" fill="var(--mantine-color-gray-3)" />
      {HIGHLIGHT[slot]}
      {pos && slot !== 'roof' && <line x1={pos[0]} y1={pos[1]} x2="50" y2="50" stroke="var(--mantine-color-cobalt-4)" strokeWidth="2" strokeDasharray="3 3" />}
      {pos && (
        <g>
          <circle cx={pos[0]} cy={pos[1]} r="7.5" fill="var(--mantine-color-cobalt-6)" />
          <circle cx={pos[0]} cy={pos[1]} r="2.8" fill="#fff" />
        </g>
      )}
    </svg>
  );
}
