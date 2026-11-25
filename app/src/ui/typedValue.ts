import { startTransition, useCallback, useLayoutEffect, useRef, useState } from 'react';

/** How many values handed to the page are remembered as this field's own (the page may draw any of them later). */
const KEEP = 32;

/**
 * A value typed fast (v0.89, the owner: «если быстро вбиваю номер… цифру набрал — она исчезает, приходится медленно»):
 * what is typed is drawn at once by the field's own small state, and the page hears of it as a transition — its whole
 * drawing (≈35 ms a key on «Новый заказ», measured) yields to the next key instead of holding the phone busy while keys
 * come. A value the page puts in by itself (read off a photo) is taken over; a value the page hands back that this field
 * gave it — an older one drawn late — is not: the field never goes back to fewer digits than were typed.
 *
 * The page's own state lags a little behind; whatever acts on a tap reads what was typed from a ref the setter fills at
 * once (see `typePlate` in NewOrderPage), not from the page's last drawing.
 */
export function useTypedValue<T>(value: T, onChange: (v: T) => void): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);
  const given = useRef<T[]>([]);
  const changed = useRef(onChange);
  changed.current = onChange;
  // Taken over only after the page has drawn it, and only when it is not one of ours (no state set while drawing: an
  // update made then is replayed later over newer keys).
  useLayoutEffect(() => {
    if (!given.current.some((v) => Object.is(v, value))) setLocal(value);
  }, [value]);
  const set = useCallback((v: T) => {
    given.current.push(v);
    if (given.current.length > KEEP) given.current.shift();
    setLocal(v);
    startTransition(() => changed.current(v));
  }, []);
  return [local, set];
}
