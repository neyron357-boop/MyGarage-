import { Kbd, Menu, Modal, Text } from '@mantine/core';
import { useHotkeys, type HotkeyItem } from '@mantine/hooks';
import type { Icon } from '@tabler/icons-react';
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

/*
 * The computer (v0.41): the PC's own layout and keys. Everything here runs in the PC shell only (`DesktopShell` in
 * App.tsx); every style of it is under `html.desk` (styles.css, «Desk»), which the phone never has — the phone does
 * not change by a pixel.
 */

/**
 * Inside the PC shell (provided by `DesktopShell`): a shared component that has something of the computer's own (a
 * row's swipes as buttons under the mouse) asks this — no media query per row; the phone's shell never provides it.
 */
export const DeskContext = createContext(false);
export const useDesk = () => useContext(DeskContext);

/** Marks the document as the PC's while the PC shell is on (before the first paint: no frame without its layout). */
export function useDeskShell() {
  useLayoutEffect(() => {
    document.documentElement.classList.add('desk');
    return () => document.documentElement.classList.remove('desk');
  }, []);
}

/**
 * A sideways row of chips or tabs (car makes, suppliers, the steps) scrolls with the mouse's wheel on a PC: an ordinary
 * wheel only goes up and down, and the chips past the edge could not be reached. At the row's end the wheel scrolls
 * the page again.
 */
export function useDeskWheel() {
  useLayoutEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const row = (e.target as Element | null)?.closest?.<HTMLElement>('.chip-row:not(.wrap), .scroll-tabs');
      if (!row || row.scrollWidth <= row.clientWidth + 1) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      const max = row.scrollWidth - row.clientWidth;
      if ((dy > 0 && row.scrollLeft >= max - 1) || (dy < 0 && row.scrollLeft <= 0)) return;
      e.preventDefault();
      row.scrollLeft = Math.max(0, Math.min(max, row.scrollLeft + dy));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
}

/**
 * Which screen is open, for the PC's widths (`.page-shell[data-page]` in styles.css): the board takes the whole
 * window, a job two columns, the lists their tables, a form a readable column.
 */
export function deskPage(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean);
  if (!seg.length) return 'board';
  if (seg[0] === 'orders') return seg[1] === 'new' ? 'new' : seg[2] === 'claim' || seg[2] === 'suppliers' ? seg[2] : 'job';
  return seg[1] ? `${seg[0]}-one` : seg[0];
}

/**
 * Is a sheet, a dialog or a menu open? Keys of the page wait while one is (they would act behind it). A closed modal
 * keeps its root in the page; an open one has its content (as `ui/escapeTop.ts` finds the top one).
 */
export const sheetOpen = () => !!document.querySelector('.mantine-Modal-content, .mantine-Menu-dropdown, .mantine-Popover-dropdown');

/**
 * Keys on a PC: what the hand on the keyboard reaches without the mouse. Not in a field (Mantine skips inputs),
 * not while a sheet is open. Letters by their place on the keyboard: N is N in the Russian layout too.
 */
export function useDeskHotkeys(keys: [string, () => void][], enabled = true) {
  const items: HotkeyItem[] = enabled
    ? keys.map(([key, fn]) => [
        key,
        () => {
          // A job shown to its customer (v0.67): the keys do nothing — no new job, no search over the lock.
          if (!sheetOpen() && !document.documentElement.hasAttribute('data-client-lock')) fn();
        },
        // Letters and signs by their place (KeyN, Slash — the same keys in the Russian layout); digits by what they
        // type (a digit is a digit in every layout, and Mantine names their places Digit1…).
        { preventDefault: true, usePhysicalKeys: !/\d$/.test(key) },
      ])
    : [];
  useHotkeys(items);
}

/** The PC's own keys, everywhere: a new job, the search, this list («?»). */
export function DeskKeys() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [help, setHelp] = useState(false);
  useDeskHotkeys([
    ['n', () => pathname !== '/orders/new' && navigate('/orders/new')],
    ['shift+/', () => setHelp(true)],
  ]);
  const rows: [ReactNode, string][] = [
    [<Kbd key="n">N</Kbd>, t('nav.newOrder')],
    [
      <>
        <Kbd>/</Kbd> <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd>
      </>,
      t('nav.search'),
    ],
    [
      <>
        <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd>
      </>,
      t('desk.keyLines'),
    ],
    [<Kbd key="esc">Esc</Kbd>, t('desk.keyClose')],
    [<Kbd key="q">?</Kbd>, t('desk.keys')],
  ];
  return (
    <Modal opened={help} onClose={() => setHelp(false)} title={t('desk.keys')} size="sm">
      <div className="desk-keys">
        {rows.map(([k, label]) => (
          <div key={label} className="desk-keys-row">
            <span className="desk-keys-k">{k}</span>
            <Text span size="sm">
              {label}
            </Text>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Two columns on a wide PC: `side` (the card of a customer, a car) beside `main` (what it has: cars, visits, money) —
 * desk.css `.desk-split`. On a phone (`desk` false) the two one after the other, as they always were: no element of
 * its own, the page exactly as before.
 */
export function DeskSplit({ desk, side, main, className }: { desk: boolean; side: ReactNode; main: ReactNode; className?: string }) {
  if (!desk)
    return (
      <>
        {side}
        {main}
      </>
    );
  return (
    <div className={className ? `desk-split ${className}` : 'desk-split'}>
      <div className="desk-split-side">{side}</div>
      <div className="desk-split-main">{main}</div>
    </div>
  );
}

export interface DeskMenuItem {
  key: string;
  label: string;
  icon?: Icon;
  color?: string;
  onClick: () => void;
  /** A line above it (the destructive ones, apart). */
  divided?: boolean;
}

/**
 * A right click's menu on a PC, where the mouse is (as a desktop app shows it), not a sheet in the middle. `at` —
 * the point of the click; null — closed (nothing is in the page then: a list's rows keep their neighbours). It lives
 * in the body, so a row's list never gets an element between its rows.
 */
export function DeskMenu({ at, items, onClose, label }: { at: { x: number; y: number } | null; items: DeskMenuItem[]; onClose: () => void; label?: string }) {
  if (!at) return null;
  return createPortal(
    <Menu opened onChange={(o) => !o && onClose()} position="bottom-start" offset={2} width={240} withinPortal closeOnItemClick returnFocus={false}>
      <Menu.Target>
        <span aria-hidden className="desk-menu-anchor" style={{ left: at.x, top: at.y }} />
      </Menu.Target>
      <Menu.Dropdown aria-label={label}>
        {items.map((it) => [
          it.divided ? <Menu.Divider key={`${it.key}-d`} /> : null,
          <Menu.Item key={it.key} color={it.color} leftSection={it.icon ? <it.icon size={18} stroke={1.9} /> : undefined} onClick={it.onClick}>
            {it.label}
          </Menu.Item>,
        ])}
      </Menu.Dropdown>
    </Menu>,
    document.body,
  );
}
