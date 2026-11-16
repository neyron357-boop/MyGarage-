import { describe, expect, it } from 'vitest';
import { actWithoutScan, odometerKm, parseObdReport } from './obdReport';
import { OBD_REPORT_ITEMS } from './obdReport.testdata';

const ITEMS = OBD_REPORT_ITEMS;

describe('a scanner report (OBD)', () => {
  it('reads the car and every fault code with its description, state and module', () => {
    const r = parseObdReport(ITEMS);
    expect(r.tool).toBe('LAUNCH X-431');
    expect(r.vehicle).toEqual({ year: 2011, make: 'GM', model: 'Terrain', vin: '1GKFLTE30BX000001', engine: 'LFW 3L 6 Dual Overhead Cam (DOHC)', odometer: { value: 151584, unit: 'mi' } });
    expect(r.testedAt).toBe('2026-10-26T01:52:17+04:00');
    expect([r.softwareVersion, r.appVersion]).toEqual(['V50.45', 'V7.05.040']);
    expect(r.codes.map((c) => c.code)).toEqual(['P0430', 'P0700', 'P0872', 'P0877', 'P0989', 'P182E', 'U0073', 'C056D']);
    expect(r.codes[0]).toEqual({ code: 'P0430', full: 'P0430-00', description: 'Catalyst System Low Efficiency Bank 2', state: 'Current', system: 'Engine Control Module (ECM)' });
    expect(r.codes[1]).toMatchObject({ description: 'Transmission Control Module Requested Malfunction Indicator Lamp (MIL) Illumination', state: 'Passed And Failed' });
    expect(r.codes[2].system).toBe('Transmission Control Module (TCM)');
    expect(r.codes[6]).toMatchObject({ code: 'U0073', state: 'History', system: 'Rear Differential Clutch Control Module (RDCCM)' });
    expect(r.codes[7]).toMatchObject({ code: 'C056D', description: 'Electronic Control Unit Hardware', system: 'Electronic Brake Control Module (EBCM)' });
    expect(odometerKm(r.vehicle.odometer)).toBe(243951);
  });

  it('takes codes from plain lines when there is no table', () => {
    const r = parseObdReport([
      { page: 1, x: 10, y: 700, str: 'VIN: JTDBR32E720012345' },
      { page: 1, x: 10, y: 680, str: 'P0301 Cylinder 1 Misfire Detected' },
      { page: 1, x: 10, y: 660, str: 'B1000 ECU malfunction' },
    ]);
    expect(r.vehicle.vin).toBe('JTDBR32E720012345');
    expect(r.codes.map((c) => [c.code, c.description])).toEqual([['P0301', 'Cylinder 1 Misfire Detected'], ['B1000', 'ECU malfunction']]);
  });
});

describe('the open act once a scan is deleted', () => {
  const codes = (...c: string[]) => c.map((code) => ({ code }));
  const km = (value: number) => ({ value, unit: 'km' as const });

  it('takes back exactly what the scan recorded', () => {
    const act = { id: 'a', obdCodes: ['P0300', 'P0430', 'P0700'], obdNoCodes: false, mileageKm: 1000 };
    const gone = { codes: codes('P0430', 'P0700', 'P0300'), odometer: km(1000), intoAct: { id: 'a', codes: ['P0430', 'P0700'], mileageKm: 1000, noCodesBefore: false } };
    expect(actWithoutScan(act, gone, [])).toEqual({ obdCodes: ['P0300'], obdNoCodes: false, mileageKm: undefined });
  });

  it('keeps codes another scan has, and that scan’s reading takes the mileage', () => {
    const act = { id: 'a', obdCodes: ['P0430', 'P0700'], obdNoCodes: false, mileageKm: 1000 };
    const gone = { codes: codes('P0430', 'P0700'), odometer: km(1000), intoAct: { id: 'a', codes: ['P0430', 'P0700'], mileageKm: 1000 } };
    const rest = [{ codes: codes('P0700'), odometer: km(1200) }];
    expect(actWithoutScan(act, gone, rest)).toEqual({ obdCodes: ['P0700'], obdNoCodes: false, mileageKm: 1200 });
  });

  it('puts «no codes» back as it was, and leaves an act the scan did not go into', () => {
    const act = { id: 'a', obdCodes: ['P0430'], obdNoCodes: false };
    expect(actWithoutScan(act, { codes: codes('P0430'), intoAct: { id: 'a', codes: ['P0430'], noCodesBefore: true } }, [])).toEqual({ obdCodes: [], obdNoCodes: true, mileageKm: undefined });
    expect(actWithoutScan(act, { codes: codes('P0430'), intoAct: { id: 'b', codes: ['P0430'] } }, [])).toBeUndefined();
  });

  it('an older scan (no record): its codes and its reading', () => {
    const act = { id: 'a', obdCodes: ['P0430'], obdNoCodes: false, mileageKm: 1609 };
    expect(actWithoutScan(act, { codes: codes('P0430'), odometer: { value: 1000, unit: 'mi' } }, [])).toEqual({ obdCodes: [], obdNoCodes: undefined, mileageKm: undefined });
    expect(actWithoutScan(act, { codes: codes('P0171') }, [])).toBeUndefined();
  });
});
