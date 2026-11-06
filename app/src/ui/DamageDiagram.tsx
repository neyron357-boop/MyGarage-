import { Box, SegmentedControl } from '@mantine/core';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DamageMark, DamageType, DamageView } from '../domain/types';

export const DAMAGE_COLORS: Record<DamageType, string> = {
  scratch: '#f08c00',
  dent: '#1c7ed6',
  chip: '#e8b600',
  crack: '#e03131',
  rust: '#a0522d',
  other: '#868e96',
};

const BODY = { fill: 'var(--mantine-color-gray-1)', stroke: 'var(--mantine-color-gray-6)', strokeWidth: 2 } as const;
const GLASS = { fill: 'var(--mantine-color-blue-1)', stroke: 'var(--mantine-color-gray-6)', strokeWidth: 1.5 } as const;
const WHEEL = { fill: 'var(--mantine-color-gray-7)' } as const;

const VIEWBOX: Record<DamageView, string> = {
  top: '0 0 200 400',
  left: '0 0 400 200',
  right: '0 0 400 200',
  front: '0 0 300 220',
  rear: '0 0 300 220',
};

function Side() {
  return (
    <>
      <path
        d="M20 130 L30 95 Q40 85 70 82 L120 78 L160 45 Q170 38 190 38 L270 38 Q290 38 305 50 L340 80 L375 88 Q385 92 385 105 L385 130 Q385 140 375 140 L30 140 Q20 140 20 130 Z"
        {...BODY}
      />
      <path d="M130 80 L165 50 L215 50 L215 80 Z" {...GLASS} />
      <path d="M225 50 L280 50 Q292 52 300 60 L322 80 L225 80 Z" {...GLASS} />
      <line x1="220" y1="80" x2="220" y2="138" stroke="var(--mantine-color-gray-5)" />
      <circle cx="95" cy="140" r="26" {...WHEEL} />
      <circle cx="310" cy="140" r="26" {...WHEEL} />
      <circle cx="95" cy="140" r="10" fill="var(--mantine-color-gray-3)" />
      <circle cx="310" cy="140" r="10" fill="var(--mantine-color-gray-3)" />
    </>
  );
}

function Drawing({ view }: { view: DamageView }) {
  if (view === 'top')
    return (
      <>
        <rect x="40" y="20" width="120" height="360" rx="45" {...BODY} />
        <path d="M55 115 Q100 90 145 115 L138 155 L62 155 Z" {...GLASS} />
        <rect x="62" y="162" width="76" height="118" rx="10" fill="var(--mantine-color-gray-2)" stroke="var(--mantine-color-gray-5)" />
        <path d="M62 290 L138 290 L145 322 Q100 342 55 322 Z" {...GLASS} />
        <rect x="27" y="70" width="14" height="52" rx="5" {...WHEEL} />
        <rect x="159" y="70" width="14" height="52" rx="5" {...WHEEL} />
        <rect x="27" y="282" width="14" height="52" rx="5" {...WHEEL} />
        <rect x="159" y="282" width="14" height="52" rx="5" {...WHEEL} />
        <path d="M92 8 L100 0 L108 8 Z" fill="var(--mantine-color-gray-6)" />
      </>
    );
  if (view === 'left') return <Side />;
  if (view === 'right')
    return (
      <g transform="translate(405 0) scale(-1 1)">
        <Side />
      </g>
    );
  const rear = view === 'rear';
  return (
    <>
      <path
        d="M40 170 L40 110 Q45 95 60 90 L85 50 Q90 40 105 40 L195 40 Q210 40 215 50 L240 90 Q255 95 260 110 L260 170 Z"
        {...BODY}
      />
      <path d={rear ? 'M100 55 L200 55 L220 88 L80 88 Z' : 'M95 55 L205 55 L228 90 L72 90 Z'} {...GLASS} />
      <ellipse cx="72" cy="122" rx="18" ry="10" fill={rear ? '#fa5252' : '#fff3bf'} stroke="var(--mantine-color-gray-6)" />
      <ellipse cx="228" cy="122" rx="18" ry="10" fill={rear ? '#fa5252' : '#fff3bf'} stroke="var(--mantine-color-gray-6)" />
      {rear ? (
        <rect x="115" y="128" width="70" height="18" rx="3" fill="#fff" stroke="var(--mantine-color-gray-6)" />
      ) : (
        <rect x="110" y="112" width="80" height="26" rx="4" fill="var(--mantine-color-gray-4)" stroke="var(--mantine-color-gray-6)" />
      )}
      <rect x="45" y="170" width="38" height="28" rx="5" {...WHEEL} />
      <rect x="217" y="170" width="38" height="28" rx="5" {...WHEEL} />
      <rect x="22" y="88" width="20" height="12" rx="3" {...BODY} />
      <rect x="258" y="88" width="20" height="12" rx="3" {...BODY} />
    </>
  );
}

export function DamageDiagram({
  view,
  marks,
  onAdd,
  onSelect,
  height = 260,
}: {
  view: DamageView;
  marks: DamageMark[];
  onAdd?: (x: number, y: number) => void;
  onSelect?: (m: DamageMark) => void;
  height?: number;
}) {
  const [, , vw, vh] = VIEWBOX[view].split(' ').map(Number);
  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!onAdd) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    onAdd(Math.min(1, Math.max(0, p.x / vw)), Math.min(1, Math.max(0, p.y / vh)));
  };
  const viewMarks = marks.filter((m) => m.view === view);
  return (
    <Box style={{ display: 'flex', justifyContent: 'center' }}>
      <svg
        viewBox={VIEWBOX[view]}
        style={{ height, maxWidth: '100%', cursor: onAdd ? 'crosshair' : 'default', touchAction: 'manipulation' }}
        onClick={handleClick}
        role="img"
      >
        <Drawing view={view} />
        {viewMarks.map((m) => (
          <g
            key={m.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(m);
            }}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            <circle cx={m.x * vw} cy={m.y * vh} r={11} fill={DAMAGE_COLORS[m.type]} stroke="#fff" strokeWidth={2} />
            <text x={m.x * vw} y={m.y * vh + 4} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="bold">
              {marks.indexOf(m) + 1}
            </text>
          </g>
        ))}
      </svg>
    </Box>
  );
}

export function ViewPicker({ value, onChange, marks }: { value: DamageView; onChange: (v: DamageView) => void; marks?: DamageMark[] }) {
  const { t } = useTranslation();
  const views: DamageView[] = ['top', 'left', 'right', 'front', 'rear'];
  return (
    <SegmentedControl
      fullWidth
      size="xs"
      value={value}
      onChange={(v) => onChange(v as DamageView)}
      data={views.map((v) => {
        const n = marks?.filter((m) => m.view === v).length ?? 0;
        return { value: v, label: `${t(`damage.view.${v}`)}${n ? ` (${n})` : ''}` };
      })}
    />
  );
}
