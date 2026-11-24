import { waUnread } from '../services/whatsapp';
import { useWaSel } from './waSel';

/**
 * How many WhatsApp messages wait, as a number of its own (v0.80.2): as they come, only it draws again — not the tab bar,
 * the side menu or «Ещё» around it. None waiting — nothing.
 */
export function WaCount({ className, label }: { className: string; label?: (n: number) => string }) {
  const n = useWaSel(waUnread);
  if (n <= 0) return null;
  return (
    <span className={className} aria-label={label?.(n)} aria-hidden={label ? undefined : true}>
      {n > 99 ? '99+' : n}
    </span>
  );
}
