import { Text } from '@mantine/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from './components';

let dirty = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** A form with a "Save" bar reports whether it has unsaved edits. */
export function useMarkUnsaved(flag: boolean) {
  useEffect(() => {
    dirty = flag;
    emit();
    return () => {
      dirty = false;
      emit();
    };
  }, [flag]);
}

export function hasUnsaved(): boolean {
  return dirty;
}

/** The guard's question, opened from navigation that is not a click (a slide along the tab bar). */
let ask: ((to: string) => void) | null = null;

/**
 * Before a navigation that is not a click on a link: true when it may go now; while a form has unsaved
 * edits it opens the guard's question instead (which navigates if the user leaves) and returns false.
 */
export function mayLeave(to: string): boolean {
  if (!dirty || !ask) return true;
  ask(to);
  return false;
}

export function useHasUnsaved(): boolean {
  return useSyncExternalStore(subscribe, () => dirty);
}

/**
 * While a form has unsaved edits: asks before following an in-app link (menus, tab bar, logo) and
 * before closing or reloading the page.
 */
export function UnsavedGuard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const active = useHasUnsaved();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    ask = setTarget;
    return () => {
      if (ask === setTarget) ask = null;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // In-app links, and the phone tab bar (buttons with the path in data-href).
      const el = (e.target as HTMLElement | null)?.closest?.('a[href], [data-href]') as HTMLElement | null;
      const href = el?.getAttribute('data-href') ? `#${el.getAttribute('data-href')}` : (el?.getAttribute('href') ?? '');
      if (!el || !href.startsWith('#/') || (el as HTMLAnchorElement).target === '_blank') return;
      // The click a browser may add after a slide along the tab bar: the slide has asked already.
      if (el.closest('.tab-bar[data-slid]')) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(href.slice(1));
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [active]);
  return (
    <ConfirmModal
      opened={!!target}
      onClose={() => setTarget(null)}
      title={t('settings.leaveTitle')}
      confirmLabel={t('settings.leave')}
      color="red"
      onConfirm={async () => {
        const to = target;
        dirty = false;
        emit();
        if (to) navigate(to);
        return true;
      }}
    >
      <Text size="sm">{t('settings.leaveText')}</Text>
    </ConfirmModal>
  );
}
