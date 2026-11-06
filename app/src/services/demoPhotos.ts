/**
 * Drawn stand-ins for photos in the demo data: a car from the requested angle on a simple
 * background, labelled "DEMO". Browser only (uses a canvas).
 */
const W = 960;
const H = 720;

function canvas(w = W, h = H) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toJpeg(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, q));
}

function scene(ctx: CanvasRenderingContext2D) {
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#a9c6e3');
  sky.addColorStop(1, '#e4edf5');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.62);
  // workshop wall and floor
  ctx.fillStyle = '#d7dbe1';
  ctx.fillRect(0, H * 0.3, W, H * 0.32);
  for (let x = 0; x < W; x += 120) {
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(x, H * 0.3, 2, H * 0.32);
  }
  const floor = ctx.createLinearGradient(0, H * 0.62, 0, H);
  floor.addColorStop(0, '#8d929b');
  floor.addColorStop(1, '#5b6069');
  ctx.fillStyle = floor;
  ctx.fillRect(0, H * 0.62, W, H * 0.38);
  ctx.fillStyle = 'rgba(255,214,0,0.55)';
  for (let x = -40; x < W; x += 140) ctx.fillRect(x, H * 0.9, 80, 8);
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#1b1d22';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa1ab';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c626c';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y, w, 16, 0, 0, Math.PI * 2);
  ctx.fill();
}

function side(ctx: CanvasRenderingContext2D, color: string, flip: boolean) {
  ctx.save();
  if (flip) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const y = H * 0.72;
  shadow(ctx, W / 2, y + 6, 360);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(130, y - 40);
  ctx.lineTo(150, y - 120);
  ctx.quadraticCurveTo(170, y - 150, 260, y - 155);
  ctx.lineTo(360, y - 160);
  ctx.lineTo(450, y - 245);
  ctx.quadraticCurveTo(470, y - 260, 520, y - 260);
  ctx.lineTo(640, y - 258);
  ctx.quadraticCurveTo(690, y - 255, 720, y - 200);
  ctx.lineTo(760, y - 160);
  ctx.quadraticCurveTo(840, y - 150, 845, y - 100);
  ctx.lineTo(840, y - 40);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(30,40,55,0.82)';
  ctx.beginPath();
  ctx.moveTo(385, y - 165);
  ctx.lineTo(460, y - 238);
  ctx.lineTo(560, y - 240);
  ctx.lineTo(560, y - 165);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(575, y - 240);
  ctx.lineTo(635, y - 238);
  ctx.quadraticCurveTo(675, y - 232, 700, y - 175);
  ctx.lineTo(575, y - 165);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(150, y - 110, 690, 10);
  ctx.fillStyle = '#ffd36b';
  ctx.fillRect(815, y - 125, 26, 16);
  ctx.fillStyle = '#d63a3a';
  ctx.fillRect(132, y - 118, 18, 22);
  wheel(ctx, 265, y - 30, 62);
  wheel(ctx, 705, y - 30, 62);
  ctx.restore();
}

function face(ctx: CanvasRenderingContext2D, color: string, rear: boolean) {
  const cx = W / 2;
  const y = H * 0.74;
  shadow(ctx, cx, y + 4, 300);
  wheel(ctx, cx - 230, y - 20, 48);
  wheel(ctx, cx + 230, y - 20, 48);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - 290, y - 40);
  ctx.lineTo(cx - 300, y - 170);
  ctx.quadraticCurveTo(cx - 290, y - 200, cx - 230, y - 205);
  ctx.lineTo(cx - 190, y - 320);
  ctx.quadraticCurveTo(cx, y - 345, cx + 190, y - 320);
  ctx.lineTo(cx + 230, y - 205);
  ctx.quadraticCurveTo(cx + 290, y - 200, cx + 300, y - 170);
  ctx.lineTo(cx + 290, y - 40);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(30,40,55,0.82)';
  ctx.beginPath();
  ctx.moveTo(cx - 170, y - 215);
  ctx.lineTo(cx - 140, y - 305);
  ctx.quadraticCurveTo(cx, y - 325, cx + 140, y - 305);
  ctx.lineTo(cx + 170, y - 215);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rear ? '#d63a3a' : '#fff4c9';
  ctx.fillRect(cx - 270, y - 170, 95, 34);
  ctx.fillRect(cx + 175, y - 170, 95, 34);
  ctx.fillStyle = '#2a2e35';
  ctx.fillRect(cx - 120, y - 150, 240, rear ? 30 : 60);
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 75, y - 92, 150, 34);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - 75, y - 92, 150, 34);
}

function dashboard(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#16191f';
  ctx.fillRect(0, 0, W, H);
  for (const [x, label] of [
    [W * 0.3, 'km/h'],
    [W * 0.7, 'rpm'],
  ] as const) {
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(x, H * 0.45, 170, Math.PI * 0.8, Math.PI * 2.2);
    ctx.stroke();
    ctx.strokeStyle = '#6f88fb';
    ctx.beginPath();
    ctx.arc(x, H * 0.45, 170, Math.PI * 0.8, Math.PI * 1.25);
    ctx.stroke();
    ctx.fillStyle = '#c9d2e3';
    ctx.font = '600 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, H * 0.47);
  }
  ctx.fillStyle = '#e9eef8';
  ctx.font = '700 46px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ODO 087 450 km', W / 2, H * 0.82);
  ctx.fillStyle = '#ffb020';
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.35, 18, 0, Math.PI * 2);
  ctx.fill();
}

function stamp(ctx: CanvasRenderingContext2D, text: string) {
  ctx.font = '600 26px sans-serif';
  ctx.textAlign = 'left';
  const w = ctx.measureText(text).width + 28;
  ctx.fillStyle = 'rgba(10,13,20,0.55)';
  ctx.fillRect(20, H - 62, w, 42);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 34, H - 32);
}

const cache = new Map<string, Promise<Blob>>();

/** A stand-in photo for a slot ("front_left", "dashboard"...) of a car of the given colour. */
export function demoPhoto(slot: string, color: string): Promise<Blob> {
  const key = `${slot}:${color}`;
  let p = cache.get(key);
  if (!p) {
    const c = canvas();
    const ctx = c.getContext('2d')!;
    if (slot === 'dashboard') dashboard(ctx);
    else {
      scene(ctx);
      if (slot === 'front' || slot === 'rear') face(ctx, color, slot === 'rear');
      else if (slot.startsWith('front_') || slot.startsWith('rear_')) {
        // three-quarter view: a side view with a little perspective
        ctx.save();
        ctx.translate(W / 2, H * 0.7);
        ctx.transform(0.86, slot.endsWith('left') ? 0.05 : -0.05, 0, 1, 0, 0);
        ctx.translate(-W / 2, -H * 0.7);
        side(ctx, color, slot === 'front_right' || slot === 'rear_left');
        ctx.restore();
      } else side(ctx, color, slot === 'right');
    }
    stamp(ctx, `${slot.replace('_', ' ').toUpperCase()} · DEMO`);
    p = toJpeg(c);
    cache.set(key, p);
  }
  return p;
}

/** A hand-drawn-looking signature for demo acts. */
export function demoSignature(seed = 1): Promise<Blob> {
  const c = canvas(600, 200);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 600, 200);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(60, 130);
  for (let i = 0; i <= 60; i++) {
    const x = 60 + i * 8;
    const y = 120 - Math.sin(i / (2.4 + seed * 0.3)) * 45 * Math.cos(i / 9) - (i % 13 === 0 ? 20 : 0);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(120, 160);
  ctx.quadraticCurveTo(300, 175, 520, 150);
  ctx.stroke();
  return toJpeg(c, 'image/png');
}
