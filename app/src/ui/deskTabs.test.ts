import { describe, expect, it } from 'vitest';
import { closeTab, deskTabs, focusTab, MAIN_TAB, noteTab, openTab, resetDeskTabs } from './deskTabs';

/* v0.89: the PC's own tabs — opened in front or behind, brought to the front, closed (the window's own one too). */
describe('the PC’s tabs', () => {
  it('a tab beside the one in front; the wheel’s — behind; closed — its neighbour comes', () => {
    resetDeskTabs();
    const a = openTab('/customers');
    expect(deskTabs().active).toBe(a);
    const b = openTab('/orders/1', { front: false });
    expect(deskTabs().active).toBe(a);
    // Beside the one in front, as a browser puts it.
    expect(deskTabs().tabs.map((t) => t.id)).toEqual([MAIN_TAB, a, b]);
    noteTab(a, { title: 'Клиенты', path: '/customers/7' });
    expect(deskTabs().tabs[1]).toMatchObject({ path: '/customers/7', title: 'Клиенты' });
    closeTab(a);
    expect(deskTabs().active).toBe(b);
    focusTab(MAIN_TAB);
    expect(deskTabs().active).toBe(MAIN_TAB);
  });

  it('the window’s own tab closed: it takes the next one’s screen; the last one is never closed', () => {
    resetDeskTabs();
    const a = openTab('/whatsapp');
    expect(closeTab(MAIN_TAB)).toEqual({ mainTo: '/whatsapp' });
    expect(deskTabs().tabs).toEqual([{ id: MAIN_TAB, path: '/whatsapp', title: undefined }]);
    expect(deskTabs().tabs.some((t) => t.id === a)).toBe(false);
    expect(closeTab(MAIN_TAB)).toEqual({});
    expect(deskTabs().tabs).toHaveLength(1);
  });

  it('a dozen at most: the oldest behind makes room', () => {
    resetDeskTabs();
    const ids = Array.from({ length: 14 }, (_, i) => openTab(`/orders/${i}`, { front: false }));
    expect(deskTabs().tabs).toHaveLength(12);
    expect(deskTabs().tabs[0].id).toBe(MAIN_TAB);
    expect(deskTabs().tabs.some((t) => t.id === ids[13])).toBe(true);
  });
});
