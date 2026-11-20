import { useEffect, useRef, useState, type ReactNode } from 'react';

/*
 * A long list drawn as it is scrolled (v0.60.1, the user: «когда добавил свыше 1000 контактов, список поставщиков начинает
 * глючить» — measured: 1200 rows drawn at once held a phone's screen for 10 s): the first thirty rows with the screen, the next
 * ones when the end comes near (an observer, 800 px ahead — the finger never reaches the end). What is shown starts over
 * when what is asked changes (a search, a filter, a sort).
 */

export const PAGE = 30;

export function useMoreRows(total: number, reset: string, page = PAGE): { limit: number; more: (as?: 'div' | 'tr', cols?: number) => ReactNode } {
  const [limit, setLimit] = useState(page);
  const asked = useRef(reset);
  useEffect(() => {
    if (asked.current === reset) return;
    asked.current = reset;
    setLimit(page);
  }, [reset, page]);
  const more = (as: 'div' | 'tr' = 'div', cols = 1) =>
    limit < total ? <MoreRows key={limit} as={as} cols={cols} onMore={() => setLimit((l) => Math.min(total, l + page))} /> : null;
  return { limit, more };
}

/** The end of what is drawn: in sight (or near it) — the next rows. A new one each time, so a sentinel still in sight asks again. */
function MoreRows({ onMore, as, cols }: { onMore: () => void; as: 'div' | 'tr'; cols: number }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      onMore();
      return;
    }
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && onMore(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return as === 'tr' ? (
    <tr ref={(e) => void (ref.current = e)} className="more-rows" aria-hidden>
      <td colSpan={cols} />
    </tr>
  ) : (
    <div ref={(e) => void (ref.current = e)} className="more-rows" aria-hidden />
  );
}
