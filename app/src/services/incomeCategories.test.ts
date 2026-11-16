import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { incomeCategoryName, incomeCategoryNamed, renamedIn } from '../domain/incomeCategories';
import { addIncomeCategory, loadIncomeCategories, removeIncomeCategory, restoreIncomeCategory, saveIncomeCategory } from './incomeCategories';
import { addIncome, loadLedger, updateIncome } from './ledger';
import { importMoneyPlan, moneySheetOfBook, planMoneyImport } from './moneySheet';
import { buildMoneyWorkbook } from '../domain/moneySheet';
import { ensureSeed } from './seed';

/*
 * v0.26 — the user: «в категории прихода добавить ещё одну категорию Emil — также добавить возможность добавлять свои
 * категории». Income categories are a table made like the expense ones: names, offered or not; an income keeps the code.
 */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

const offered = async () => (await loadIncomeCategories()).filter((c) => c.active).map((c) => c.nameRu);

describe('income categories (v0.26)', () => {
  it('the app starts with its three and «Emil» (the same name in both languages); a second start adds nothing', async () => {
    expect(await offered()).toEqual(['Работа / ремонт', 'Продажа', 'Прочий приход', 'Emil']);
    const emil = (await loadIncomeCategories()).find((c) => c.code === 'emil')!;
    expect([emil.nameRu, emil.nameEn]).toEqual(['Emil', 'Emil']);
    await ensureSeed();
    expect(await db.incomeCategories.count()).toBe(4);
  });

  it('«Emil» is picked for an income and its entry in the book says so', async () => {
    const i = await addIncome({ category: 'emil', amountFils: 50_000, method: 'cash' });
    const e = (await loadLedger()).entries.find((x) => x.id === i.id)!;
    expect(e.category).toBe('emil');
    const c = (await loadIncomeCategories()).find((x) => x.code === e.category)!;
    expect(incomeCategoryName(c, 'ru')).toBe('Emil');
    expect(incomeCategoryName(c, 'en')).toBe('Emil');
  });

  it('one of the garage’s own is added last and offered at once; the same name again is that one, not a second', async () => {
    const tips = await addIncomeCategory('  Чаевые ');
    expect(tips.code).toMatch(/^c_/);
    expect([tips.nameRu, tips.nameEn]).toEqual(['Чаевые', 'Чаевые']);
    expect(await offered()).toEqual(['Работа / ремонт', 'Продажа', 'Прочий приход', 'Emil', 'Чаевые']);
    expect((await addIncomeCategory('чаевые')).id).toBe(tips.id);
    expect(await db.incomeCategories.count()).toBe(5);
    await expect(addIncomeCategory('   ')).rejects.toThrow();
    // An income of it, and one moved to it.
    const i = await addIncome({ category: tips.code, amountFils: 2_000, method: 'card' });
    expect((await db.incomes.get(i.id))!.category).toBe(tips.code);
    const j = await addIncome({ category: 'sales', amountFils: 1_000, method: 'cash' });
    await updateIncome(j.id, { category: tips.code });
    expect((await db.incomes.get(j.id))!.category).toBe(tips.code);
  });

  it('renamed: a name the same in both languages changes in both, the app’s own — in the language typed', async () => {
    const list = await loadIncomeCategories();
    const emil = list.find((c) => c.code === 'emil')!;
    await saveIncomeCategory(renamedIn(emil, 'Эмиль', 'ru'));
    const sales = list.find((c) => c.code === 'sales')!;
    await saveIncomeCategory(renamedIn(sales, 'Продажа масла', 'ru'));
    const now = await loadIncomeCategories();
    expect(now.find((c) => c.code === 'emil')).toMatchObject({ nameRu: 'Эмиль', nameEn: 'Эмиль' });
    expect(now.find((c) => c.code === 'sales')).toMatchObject({ nameRu: 'Продажа масла', nameEn: 'Sale' });
    await expect(saveIncomeCategory({ ...emil, nameRu: ' ', nameEn: '' })).rejects.toThrow();
  });

  it('taken out: not offered, its entries keep its name; «Отменить» brings it back in its place; «Прочий приход» stays', async () => {
    const own = await addIncomeCategory('Аренда подъёмника');
    const i = await addIncome({ category: own.code, amountFils: 10_000, method: 'cash' });
    const removed = await removeIncomeCategory(own.id);
    expect(await offered()).not.toContain('Аренда подъёмника');
    // The entry still has it, by name.
    const code = (await loadLedger()).entries.find((e) => e.id === i.id)!.category;
    expect(incomeCategoryName((await loadIncomeCategories()).find((c) => c.code === code)!, 'ru')).toBe('Аренда подъёмника');
    await restoreIncomeCategory(removed);
    expect(await offered()).toEqual(['Работа / ремонт', 'Продажа', 'Прочий приход', 'Emil', 'Аренда подъёмника']);
    // Taken out again and added by the same name: back, not a second one.
    await removeIncomeCategory(own.id);
    expect((await addIncomeCategory('Аренда подъёмника')).id).toBe(own.id);
    expect(await offered()).toContain('Аренда подъёмника');
    // «Emil» goes and does not come back with the next start.
    const emil = (await loadIncomeCategories()).find((c) => c.code === 'emil')!;
    await removeIncomeCategory(emil.id);
    await ensureSeed();
    expect(await offered()).not.toContain('Emil');
    const other = (await loadIncomeCategories()).find((c) => c.code === 'other')!;
    await expect(removeIncomeCategory(other.id)).rejects.toThrow();
    await expect(saveIncomeCategory({ ...other, active: false })).rejects.toThrow();
  });

  it('the money sheet: the garage’s own goes out by its name and comes back in as it; old codes as before', async () => {
    const tips = await addIncomeCategory('Tips');
    await addIncome({ date: '2026-11-10', category: 'emil', amountFils: 50_000, method: 'cash' });
    await addIncome({ date: '2026-11-10', category: tips.code, amountFils: 2_000, method: 'card' });
    await addIncome({ date: '2026-11-10', category: 'sales', amountFils: 1_000, method: 'cash' });
    await addIncome({ date: '2026-11-10', category: 'other', amountFils: 3_000, method: 'cash' });
    const sheet = await moneySheetOfBook();
    expect(sheet.rows.map((r) => [r.category, r.amountFils])).toEqual([
      ['Emil', 50_000],
      ['Tips', 2_000],
      ['Sales', 1_000],
      ['Other', 3_000],
    ]);
    // Into a book without them: the rows come back with their categories.
    db.close();
    setDb(new GarageDB(`test-${uid()}`));
    await ensureSeed();
    const again = await addIncomeCategory('tips');
    await importMoneyPlan(await planMoneyImport(buildMoneyWorkbook(sheet)));
    const incomes = (await db.incomes.toArray()).sort((a, b) => b.amountFils - a.amountFils);
    expect(incomes.map((i) => [i.category, i.amountFils, i.note ?? ''])).toEqual([
      ['emil', 50_000, ''],
      ['other', 3_000, ''],
      [again.code, 2_000, ''],
      ['sales', 1_000, ''],
    ]);
  });

  it('a name in either language, whatever the case and spaces', () => {
    const list = [{ id: '1', code: 'sales', nameRu: 'Продажа', nameEn: 'Sale', active: true, position: 1 }];
    expect(incomeCategoryNamed(list, '  sale ')?.code).toBe('sales');
    expect(incomeCategoryNamed(list, 'ПРОДАЖА')?.code).toBe('sales');
    expect(incomeCategoryNamed(list, 'Sales')).toBeUndefined();
    expect(incomeCategoryNamed(list, '')).toBeUndefined();
  });
});
