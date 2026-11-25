/**
 * Money writes that read what is owed and then write (audit 25/11) run one after another: the second reads what the
 * first wrote — two quick taps never pay the same debt twice or issue a second invoice over the first. The buttons
 * guard it too (`useAction exclusive`, `tapGuard`); this holds for any path that does not. Per key; a failure does not
 * block the next. Never call one guarded function from another under the same key — it would wait for itself.
 */
const tails = new Map<string, Promise<unknown>>();

export function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = tails.get(key) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
