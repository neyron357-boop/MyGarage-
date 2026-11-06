import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ru } from './ru';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|ts)$/.test(f) && !f.endsWith('.test.ts') && !p.includes('i18n') ? [p] : [];
  });
}

describe('translations', () => {
  const ruKeys = new Set(keys(ru));
  it('Russian and English have the same keys', () => {
    expect(keys(en).sort()).toEqual([...ruKeys].sort());
  });
  it('every literal key used in the code exists', () => {
    const src = join(__dirname, '..');
    const used = new Set<string>();
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bt[c]?\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
      for (const m of text.matchAll(/'((?:err|stageErr|common|payment|debt|invoice|decision|estimate|sign|qc|cash|settings)\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !ruKeys.has(k));
    expect(missing).toEqual([]);
  });
  it('no empty strings', () => {
    const empty = keys(en).filter((k) => !k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], en));
    expect(empty).toEqual([]);
  });
});
