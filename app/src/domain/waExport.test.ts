import { describe, expect, it } from 'vitest';
import { turnsOf } from './chatStudy';
import { exportChatName, exportMessages, parseExport, whoIsGarage } from './waExport';

/* Made-up exports, as WhatsApp writes them (v0.91.5). */

const LRM = '‎';
const NNBSP = ' ';

const IPHONE = [
  `[12/03/2025, 09:14:05] Rukn Garage: *Toyota Camry 2018*`,
  `1. FRONT BUMPER`,
  `2. HEADLIGHT LEFT`,
  `[12/03/2025, 09:30:41] Al Noor Parts: org 950 dup 400`,
  `${LRM}[12/03/2025, 09:31:02] Al Noor Parts: ${LRM}image omitted`,
  `[14/03/2025, 18:02:10] Rukn Garage: Nissan Patrol 2016 gearbox mounting?`,
  `[15/03/2025, 08:00:00] Al Noor Parts: NA`,
  `${LRM}[16/03/2025, 10:00:00] Rukn Garage: ${LRM}<attached: 00000012-PHOTO-2025-03-16-10-00-00.jpg>`,
  `[16/03/2025, 10:20:00] Al Noor Parts: This message was deleted`,
  `[16/03/2025, 10:21:00] Al Noor Parts: 120`,
].join('\n');

const ANDROID = [
  `3/12/25, 9:14${NNBSP}AM - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.`,
  `3/12/25, 9:14${NNBSP}AM - Garage: Lexus LX570 brake pads available?`,
  `3/12/25, 1:05${NNBSP}PM - Mohammed: available 280`,
  `3/13/25, 10:00${NNBSP}AM - Garage: IMG-20250313-WA0001.jpg (file attached)`,
].join('\n');

describe('a chat exported from the phone (v0.91.5)', () => {
  it('the chat name from the file name', () => {
    expect(exportChatName('WhatsApp Chat - Al Noor Parts.zip')).toBe('Al Noor Parts');
    expect(exportChatName('WhatsApp Chat with Mohammed.txt')).toBe('Mohammed');
    expect(exportChatName('Чат WhatsApp с Ахмед (2).txt')).toBe('Ахмед');
    expect(exportChatName('_chat.txt')).toBe('_chat');
  });

  it('an iPhone export: dates day first, a message of several lines, attachments, a deleted one', () => {
    const p = parseExport(IPHONE);
    expect(p.senders).toEqual(['Al Noor Parts', 'Rukn Garage']);
    expect(p.lines).toHaveLength(8);
    expect(p.lines[0]).toEqual({ t: Date.UTC(2025, 2, 12, 9, 14, 5) - 4 * 3600_000, sender: 'Rukn Garage', type: 'chat', text: '*Toyota Camry 2018*\n1. FRONT BUMPER\n2. HEADLIGHT LEFT' });
    expect(p.lines[2]).toMatchObject({ type: 'image', text: '' });
    expect(p.lines[5]).toMatchObject({ type: 'image', sender: 'Rukn Garage' });
    expect(p.lines[6]).toMatchObject({ type: 'revoked' });
  });

  it('an Android export: month first (13 in the second place), the 12-hour clock, WhatsApp\'s own line left out', () => {
    const p = parseExport(ANDROID);
    expect(p.lines).toHaveLength(3);
    expect(p.lines[1].t - p.lines[0].t).toBe((13 * 60 + 5 - (9 * 60 + 14)) * 60_000);
    expect(p.lines[0].t).toBe(Date.UTC(2025, 2, 12, 9, 14) - 4 * 3600_000);
    expect(p.lines[2]).toMatchObject({ type: 'image', sender: 'Garage' });
  });

  it('which sender is the garage: its own name; else not the chat; else the one naming cars', () => {
    const p = parseExport(IPHONE);
    expect(whoIsGarage(p, 'Al Noor Parts', [])).toBe('Rukn Garage');
    expect(whoIsGarage(p, 'Someone else', ['RUKN GARAGE'])).toBe('Rukn Garage');
    expect(whoIsGarage(parseExport(ANDROID), '+971 50 111 0002', [])).toBeUndefined();
  });

  it('what the requests in it came to — as the study reads a chat', () => {
    const p = parseExport(IPHONE);
    const turns = turnsOf(exportMessages(p, 'Rukn Garage'));
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ r: 16 * 60 + 36, p: 1, mk: ['Toyota'] });
    expect(turns[1]).toMatchObject({ na: 1, mk: ['Nissan'] });
    expect(turns[2]).toMatchObject({ p: 1 });
  });
});
