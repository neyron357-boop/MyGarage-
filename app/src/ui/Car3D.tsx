import { ActionIcon } from '@mantine/core';
import { IconZoomReset } from '@tabler/icons-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DamageMark, DamageView } from '../domain/types';
import type { CarScene, CarView } from './car3d/scene';

export type { CarView };

export interface Car3DHandle {
  /** Turn to a side, or back to the three-quarter view. */
  turnTo(view: CarView): void;
  /** Turn to face a point. */
  face(mark: DamageMark): void;
}

interface Props {
  marks: DamageMark[];
  picked: string | null;
  /** A signed act: its points are only looked at (a tap on the car puts none). */
  locked: boolean;
  onAdd: (at: { view: DamageView; x: number; y: number }) => void;
  onPick: (id: string) => void;
  /** The finger turned the car (the side picked above it is no longer the one in view). */
  onTurn: () => void;
  /** What a device without WebGL shows instead (the drawings). */
  fallback: ReactNode;
}

/**
 * The job card's car in 3D (./car3d/scene.ts — three.js, loaded with the job card only, not with the app): turned
 * by one finger, brought closer by two; a tap on the car puts a point (`onAdd`: the side and the place on its
 * drawing), a tap on a pin picks the point. Close up, a round button in the corner brings the whole car back. While
 * the 3D part loads — a quiet frame in its place; a device without WebGL keeps the drawings.
 */
export const Car3D = forwardRef<Car3DHandle, Props>(function Car3D(props, ref) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<CarScene | null>(null);
  // The scene keeps calling the latest handlers (it is made once).
  const live = useRef(props);
  live.current = props;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [closeUp, setCloseUp] = useState(false);
  useImperativeHandle(ref, () => ({ turnTo: (v) => scene.current?.turnTo(v), face: (m) => scene.current?.face(m) }), []);
  useEffect(() => {
    let alive = true;
    let made: CarScene | undefined;
    import('./car3d/scene')
      .then(({ createCarScene, webglOk }) => {
        if (!alive || !host.current) return;
        if (!webglOk()) return setState('failed');
        made = createCarScene(host.current, {
          onTap: (at) => live.current.onAdd(at),
          onPick: (id) => live.current.onPick(id),
          onTurn: () => live.current.onTurn(),
          onZoom: setCloseUp,
          locked: live.current.locked,
        });
        scene.current = made;
        made.setMarks(live.current.marks, live.current.picked);
        setState('ready');
      })
      .catch((e) => {
        console.warn('3D car:', e);
        if (alive) setState('failed');
      });
    return () => {
      alive = false;
      scene.current = null;
      made?.dispose();
    };
  }, []);
  useEffect(() => {
    scene.current?.setMarks(props.marks, props.picked);
  }, [props.marks, props.picked]);
  if (state === 'failed') return <>{props.fallback}</>;
  return (
    <div ref={host} className="car3d" data-loading={state === 'loading' || undefined} role="img" aria-label="3D">
      {closeUp && (
        <ActionIcon size={40} radius="xl" variant="default" className="car3d-whole glass pop-in" aria-label={t('jobCard.whole')} onClick={() => scene.current?.resetZoom()}>
          <IconZoomReset size={20} stroke={2} />
        </ActionIcon>
      )}
    </div>
  );
});
