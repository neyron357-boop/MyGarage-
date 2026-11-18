import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Photos at a card's size (v0.41.3, the user: «фотографии загружаются очень медленно»): a device shows a photo on the
 * board, on a job's card and in the viewer at 1080 px — about a third of the original's bytes (453 KB on average here,
 * up to 1.8 MB). A device sends that copy with each new photo (`card`); for photos kept before, this computer makes
 * it itself — with Windows' own picture tools (System.Drawing, through PowerShell: no program to install), one batch
 * at a time, in the background. Elsewhere (Docker) nothing is made here: a device that had to read an original sends
 * the card it made back.
 */

const SCRIPT = String.raw`param([string]$List)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]82)
foreach ($line in [IO.File]::ReadAllLines($List, [Text.Encoding]::UTF8)) {
  if (-not $line) { continue }
  $p = $line -split "\t"
  $id = $p[0]; $src = $p[1]; $dst = $p[2]; $side = [double]$p[3]
  try {
    $ms = New-Object IO.MemoryStream (, [IO.File]::ReadAllBytes($src))
    $img = [System.Drawing.Image]::FromStream($ms)
    if ($img.PropertyIdList -contains 274) {
      switch ([int]$img.GetPropertyItem(274).Value[0]) {
        2 { $img.RotateFlip('RotateNoneFlipX') }
        3 { $img.RotateFlip('Rotate180FlipNone') }
        4 { $img.RotateFlip('Rotate180FlipX') }
        5 { $img.RotateFlip('Rotate90FlipX') }
        6 { $img.RotateFlip('Rotate90FlipNone') }
        7 { $img.RotateFlip('Rotate270FlipX') }
        8 { $img.RotateFlip('Rotate270FlipNone') }
      }
    }
    $scale = [Math]::Min(1.0, $side / [Math]::Max($img.Width, $img.Height))
    # Small already: the photo itself is its card (made again it would only grow).
    if ($scale -ge 1.0) {
      $img.Dispose(); $ms.Dispose()
      [IO.File]::Copy($src, $dst, $true)
      Write-Output ("ok" + [char]9 + $id)
      continue
    }
    $w = [Math]::Max(1, [int][Math]::Round($img.Width * $scale))
    $h = [Math]::Max(1, [int][Math]::Round($img.Height * $scale))
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.CompositingQuality = 'HighQuality'
    $g.SmoothingMode = 'HighQuality'
    $g.DrawImage($img, 0, 0, $w, $h)
    $bmp.Save($dst, $codec, $params)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $ms.Dispose()
    Write-Output ("ok" + [char]9 + $id)
  } catch {
    Write-Output ("fail" + [char]9 + $id + [char]9 + $_.Exception.Message)
  }
}
`;

const SIDE = 1080;

export function createCards({ store, dataDir, log = () => {}, platform = process.platform }) {
  const failed = new Set();
  let running = null;

  /** Photos kept here with no card yet, made in batches of `batch`; true when there were some. */
  async function fill(batch = 40) {
    if (platform !== 'win32') return false;
    if (running) return running;
    running = (async () => {
      let made = 0;
      for (;;) {
        const todo = store.photosWithoutCard(batch + failed.size).filter((f) => !failed.has(f.id)).slice(0, batch);
        if (!todo.length) break;
        // Beside the data (its own disk): the card is moved into place, not copied.
        fs.mkdirSync(path.join(dataDir, 'Служебное', 'tmp'), { recursive: true });
        const work = fs.mkdtempSync(path.join(dataDir, 'Служебное', 'tmp', 'cards-'));
        try {
          const list = path.join(work, 'list.txt');
          const script = path.join(work, 'cards.ps1');
          const items = todo.map((f) => ({ ...f, out: path.join(work, `${f.id}.card.jpg`) }));
          fs.writeFileSync(list, items.map((f) => [f.id, f.abs, f.out, SIDE].join('\t')).join('\n'), 'utf8');
          fs.writeFileSync(script, `﻿${SCRIPT}`, 'utf8');
          const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-List', list]);
          const done = new Set();
          for (const line of out.split(/\r?\n/)) {
            const [state, id, why] = line.split('\t');
            if (state === 'ok' && id) done.add(id);
            else if (state === 'fail' && id) {
              failed.add(id);
              log(`card ${id}: ${why}`);
            }
          }
          for (const f of items) {
            if (!done.has(f.id) || !fs.existsSync(f.out)) {
              failed.add(f.id);
              continue;
            }
            const bytes = fs.readFileSync(f.out);
            const sha = crypto.createHash('sha256').update(bytes).digest('hex');
            store.keepFile(f.id, 'card', 'image/jpeg', f.out, bytes.length, sha);
            made++;
          }
        } catch (e) {
          log(`cards: ${e.message}`);
          break;
        } finally {
          fs.rmSync(work, { recursive: true, force: true });
        }
      }
      if (made) log(`cards made: ${made}`);
      return made > 0;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  let timer = null;
  /** Soon (after the photos that are still coming): the cards made. */
  function later(ms = 4000) {
    clearTimeout(timer);
    timer = setTimeout(() => void fill(), ms);
    timer.unref?.();
  }

  return { fill, later };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 || out ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))));
  });
}
