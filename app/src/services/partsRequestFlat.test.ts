import { describe, expect, it } from 'vitest';
import { partsRequestFlat } from './messages';

describe('the parts request on one line (v0.59.2)', () => {
  it('numbers the parts, each ends in a semicolon, the question last — no line breaks', () => {
    const t = partsRequestFlat({ make: 'Toyota', model: 'Camry', year: 2018, vin: 'VIN1', engine: '' } as never, [
      { titleEn: 'FRONT BRAKE PADS', titleRu: '', partNumber: '04465', qty: 1 },
      { titleEn: 'TIE ROD END', titleRu: '', partNumber: undefined, qty: 2 },
    ] as never);
    expect(t).toBe('Toyota Camry 2018 · VIN VIN1: 1. FRONT BRAKE PADS (04465); 2. TIE ROD END × 2. Price and availability, please: original / aftermarket?');
    expect(t).not.toContain('\n');
  });
});
