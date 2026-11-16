import { describe, expect, it } from 'vitest';
import { tallyFrames, type FrameRead } from './plateScan';

const f = (number: string, code = 'R', sure = true, emirate?: FrameRead['emirate']): FrameRead => ({ number, code, sure, emirate });

describe('a plate read off the camera’s frames (v0.33)', () => {
  it('two frames that agree make it stable; one is not enough', () => {
    expect(tallyFrames([f('90221')])).toMatchObject({ number: '90221', code: 'R', stable: false });
    expect(tallyFrames([f('90221'), f('90221')])).toMatchObject({ number: '90221', code: 'R', stable: true });
  });

  it('a blurred frame’s slip is outvoted; unsure frames count half', () => {
    const t = tallyFrames([f('90221'), f('80221', 'R', false), f('90221')]);
    expect(t).toMatchObject({ number: '90221', frames: 2, stable: true });
    expect(tallyFrames([f('90221', 'R', false), f('90221', 'R', false)])).toMatchObject({ stable: false });
    expect(tallyFrames([f('90221', 'R', false), f('90221', 'R', false), f('90221', 'R', false), f('90221', 'R', false)])).toMatchObject({ stable: true });
  });

  it('two numbers as strong as each other: not stable until one leads', () => {
    expect(tallyFrames([f('90221'), f('90221'), f('67089', 'H'), f('67089', 'H')])?.stable).toBe(false);
    expect(tallyFrames([f('90221'), f('90221'), f('67089', 'H'), f('67089', 'H'), f('67089', 'H')])).toMatchObject({ number: '67089', code: 'H', stable: true });
  });

  it('the code must agree too — unless no frame read one; the emirate named most', () => {
    expect(tallyFrames([f('90221', 'R'), f('90221', 'A')])).toMatchObject({ number: '90221', stable: false });
    expect(tallyFrames([f('90221', 'R'), f('90221', 'A'), f('90221', 'R')])).toMatchObject({ code: 'R', stable: true });
    expect(tallyFrames([f('90221', ''), f('90221', '')])).toMatchObject({ code: '', stable: false });
    expect(tallyFrames([f('90221', ''), f('90221', ''), f('90221', '')])).toMatchObject({ code: '', stable: true });
    expect(tallyFrames([f('90221', 'R', true, 'DXB'), f('90221', 'R', true), f('90221', 'R', true, 'DXB')])?.emirate).toBe('DXB');
  });

  it('only the last frames count: a car changed for another one', () => {
    const old = Array.from({ length: 8 }, () => f('90221'));
    expect(tallyFrames([...old, ...Array.from({ length: 8 }, () => f('39957', 'Y'))])).toMatchObject({ number: '39957', code: 'Y', stable: true });
    expect(tallyFrames([])).toBeUndefined();
  });

  it('a number of one or two digits wants a third frame (what a stray mark may read as)', () => {
    expect(tallyFrames([f('4', ''), f('4', '')])?.stable).toBe(false);
    expect(tallyFrames([f('4', ''), f('4', ''), f('4', '')])?.stable).toBe(true);
  });
});
