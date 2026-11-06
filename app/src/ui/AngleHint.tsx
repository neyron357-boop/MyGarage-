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
