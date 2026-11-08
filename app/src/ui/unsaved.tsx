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
