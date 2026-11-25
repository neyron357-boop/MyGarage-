import type { Icon } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { useScreen } from './stack';

/*
 * «＋» on a job's screen is that job's own quick actions (v0.85, the owner: «когда я открываю карточку заказа, этот плюс с
 * быстрыми действиями должен замениться быстрыми действиями конкретно этого заказа — отправить смету или инвойс, в
 * рабочую группу, боссу или клиенту… чтобы пару секунд занимали действия»). The job's screen says what it offers now
 * (`useJobQuick`); «＋» (features/quick/QuickActions.tsx) asks the screen in front at the moment it is touched — the
 * others in the stack, under it, say nothing. A phone's screens only; elsewhere «＋» is as it was.
 */

export interface JobQuick {
  key: string;
  icon: Icon;
  /** A theme colour of the plate (as the «…» tiles). */
  color: string;
  run: () => void;
}

type Entry = { front: () => boolean; list: () => JobQuick[] };
const entries = new Set<Entry>();

/** The job's actions, read when «＋» is touched (`list` is the screen's latest). */
export function useJobQuick(list: React.MutableRefObject<() => JobQuick[]>) {
  const screen = useScreen();
  const ref = useRef(list);
  ref.current = list;
  useEffect(() => {
    if (!screen) return;
    const e: Entry = { front: screen.front, list: () => ref.current.current() };
    entries.add(e);
    return () => void entries.delete(e);
  }, [screen]);
}

/** The actions of the job in front now — none when no job is. */
export function jobQuickNow(): JobQuick[] | undefined {
  for (const e of entries) {
    if (!e.front()) continue;
    const l = e.list();
    return l.length ? l : undefined;
  }
  return undefined;
}
