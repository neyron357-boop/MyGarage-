import { describe, expect, it } from 'vitest';
import { odometerKm, parseObdReport } from './obdReport';
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
