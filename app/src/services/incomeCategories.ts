import { db, uid } from '../db/db';
import { byPlace, incomeCategoryNamed, KEPT_INCOME } from '../domain/incomeCategories';
import type { IncomeCategory } from '../domain/types';
import { AppError } from './errors';

/*
 * The garage's categories of money in (v0.26, table `incomeCategories`): added from the income sheet's chips («＋») or
 * in Settings → Categories, renamed, taken out of the sheet (`active: false`, with «Отменить»). Nothing is deleted:
 * an income keeps its category's code, and its entry shows the name the category has.
 */

/** All of them, in their order (taken out ones too — their entries show their names). */
export async function loadIncomeCategories(): Promise<IncomeCategory[]> {
  return (await db.incomeCategories.toArray()).sort(byPlace);
}

/**
 * A category of the garage's own, by its name (the same in both languages) — last among the chips. One of that name
 * already there is the one (taken out — back in the sheet), not a second.
 */
export async function addIncomeCategory(name: string): Promise<IncomeCategory> {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new AppError('err.nameRequired');
  return db.transaction('rw', db.incomeCategories, async () => {
    const list = await db.incomeCategories.toArray();
    const had = incomeCategoryNamed(list, n);
    if (had) {
      if (!had.active) await db.incomeCategories.update(had.id, { active: true });
      return { ...had, active: true };
    }
    const id = uid();
    const c: IncomeCategory = { id, code: `c_${id.slice(0, 8)}`, nameRu: n, nameEn: n, active: true, position: Math.max(-1, ...list.map((x) => x.position)) + 1 };
    await db.incomeCategories.add(c);
    return c;
  });
}

/** Its names and whether it is offered, as edited (one name at least; «Прочий приход» is always offered). */
export async function saveIncomeCategory(c: IncomeCategory): Promise<void> {
  const nameRu = c.nameRu.trim().replace(/\s+/g, ' ');
  const nameEn = c.nameEn.trim().replace(/\s+/g, ' ');
  if (!nameRu && !nameEn) throw new AppError('err.nameRequired');
  if (!c.active && c.code === KEPT_INCOME) throw new AppError('err.incomeCategoryKept');
  await db.incomeCategories.put({ ...c, nameRu, nameEn });
}

/** Out of the income sheet («Прочий приход» stays); entries that have it keep its name. Returns it for «Отменить». */
export async function removeIncomeCategory(id: string): Promise<IncomeCategory> {
  const c = await db.incomeCategories.get(id);
  if (!c) throw new AppError('err.notFound');
  if (c.code === KEPT_INCOME) throw new AppError('err.incomeCategoryKept');
  await db.incomeCategories.update(id, { active: false });
  return c;
}

/** «Отменить» of `removeIncomeCategory`: back in the sheet, in its place. */
export async function restoreIncomeCategory(c: IncomeCategory): Promise<void> {
  await db.incomeCategories.update(c.id, { active: true });
}
