import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
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
 * by the finger; a tap on the car puts a point (`onAdd`: the side and the place on its drawing), a tap on a pin picks
 * the point. While the 3D part loads — a quiet frame in its place; a device without WebGL keeps the drawings.
 */
export const Car3D = forwardRef<Car3DHandle, Props>(function Car3D(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<CarScene | null>(null);
  // The scene keeps calling the latest handlers (it is made once).
  const live = useRef(props);
  live.current = props;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
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
  return <div ref={host} className="car3d" data-loading={state === 'loading' || undefined} role="img" aria-label="3D" />;
});
