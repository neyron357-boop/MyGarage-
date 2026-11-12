import { canonicalMake } from './carCatalog';
import { normalizePhone } from './phone';
import type { Supplier } from './types';

/** A supplier read from someone's own list (Excel or CSV): whatever columns it has, in Russian or English. */
export type SupplierRow = Pick<Supplier, 'name' | 'phone' | 'makes' | 'condition' | 'parts' | 'service' | 'locationUrl' | 'address' | 'notes'>;

type Field = 'phone' | 'makes' | 'condition' | 'parts' | 'locationUrl' | 'address' | 'notes' | 'name';

/** Header words, the more specific first ("supplier phone" is a phone, not a name). */
const HEAD: [Field, RegExp][] = [
  ['phone', /phone|mobile|\btel\b|whats|телефон|моб|ватсап|вотсап|контакт/i],
  ['locationUrl', /\bmap|location|gps|link|карт|локац|ссылк|геолок/i],
  ['makes', /\bmake|brand|марк|бренд/i],
  ['condition', /condition|new.*used|\btype\b|тип|состояни|нов.*б\/у/i],
  ['parts', /\bpart|categor|special|product|деталь|запчаст|категор|специал|узл|товар|профил|что прода/i],
  ['address', /address|\barea\b|district|район|адрес|место|где/i],
  ['notes', /note|comment|remark|заметк|коммент|примеч/i],
  ['name', /name|supplier|shop|store|company|vendor|seller|назван|имя|магазин|компан|поставщ|продав/i],
];

const fieldOf = (header: string): Field | undefined => HEAD.find(([, re]) => re.test(header))?.[0];

/** Rows of a CSV file (comma, semicolon or tab; quoted values may hold separators and line breaks). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].map((s) => ({ s, n: firstLine.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const MAKE_SPLIT = /\s*(?:[,;/|+]|\band\b|\bи\b)\s*/i;

function makesOf(s: string): string[] | undefined {
  const list = s
    .split(MAKE_SPLIT)
    .map((m) => m.trim())
    .filter((m) => m && !/^(all|any|все|любые)$/i.test(m))
    .map((m) => canonicalMake(m));
  return list.length ? [...new Set(list)] : undefined;
}

function conditionOf(s: string): SupplierRow['condition'] {
  const used = /б\/у|\bбу\b|used|second|разбор|scrap|junk/i.test(s);
  const fresh = /\bnew\b|нов|original|ориг|genuine/i.test(s);
  return used && fresh ? 'both' : used ? 'used' : fresh ? 'new' : undefined;
}

const SERVICE = /service|repair|work(shop)?\b|мастер|работ|услуг|подряд|ремонт/i;

/**
 * Suppliers from a sheet's rows: the header row is found by its words (name, phone, makes, new/used,
 * what they sell, map, address, notes); columns it does not know go to the notes as "Header: value".
 * Without a header the first column is the name and the second the phone.
 */
export function suppliersFromRows(rows: string[][]): SupplierRow[] {
  let head = rows.findIndex((r) => {
    const f = r.map(fieldOf);
    return f.includes('name') && f.filter(Boolean).length >= 2;
  });
  let cols: (Field | undefined)[];
  let headers: string[];
  if (head < 0) {
    head = -1;
    cols = ['name', 'phone'];
    headers = [];
  } else {
    headers = rows[head];
    const taken = new Set<Field>();
    cols = headers.map((h) => {
      const f = fieldOf(h);
      // Each field from its first column; a second "phone" column goes to the notes.
      if (!f || (taken.has(f) && f !== 'notes')) return undefined;
      taken.add(f);
      return f;
    });
  }
  const out: SupplierRow[] = [];
  for (const r of rows.slice(head + 1)) {
    const v: Partial<Record<Field, string>> = {};
    const extra: string[] = [];
    r.forEach((cell, i) => {
      if (!cell) return;
      const f = cols[i];
      if (f) v[f] = v[f] ? `${v[f]}; ${cell}` : cell;
      else extra.push(headers[i] ? `${headers[i]}: ${cell}` : cell);
    });
    const name = v.name?.trim();
    if (!name) continue;
    const phone = v.phone ? normalizePhone(v.phone.split(/[;,/]/)[0]) ?? v.phone.trim() : undefined;
    // Without a header, only rows that look like "name, phone" count (not any text file).
    if (!headers.length && !(v.phone && normalizePhone(v.phone))) continue;
    const typeText = `${v.condition ?? ''} ${v.parts ?? ''}`;
    const notes = [v.notes, ...extra].filter(Boolean).join('\n') || undefined;
    const url = v.locationUrl && /^https?:\/\//i.test(v.locationUrl) ? v.locationUrl : undefined;
    out.push({
      name,
      phone,
      makes: v.makes ? makesOf(v.makes) : undefined,
      condition: conditionOf(typeText),
      parts: v.parts || undefined,
      service: SERVICE.test(v.condition ?? '') || undefined,
      locationUrl: url,
      address: [v.address, !url ? v.locationUrl : undefined].filter(Boolean).join(', ') || undefined,
      notes,
    });
  }
  return out;
}

/** Same supplier already in the list: by phone, otherwise by name. */
export function sameSupplier(a: Pick<Supplier, 'name' | 'phone'>, b: Pick<Supplier, 'name' | 'phone'>): boolean {
  if (a.phone && b.phone) return a.phone.replace(/\D/g, '') === b.phone.replace(/\D/g, '');
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
