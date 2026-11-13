# Launch screens for the installed iPhone app and a square home-screen icon.
# iOS shows a plain white screen while a web app starts unless it finds a startup image for the exact
# screen size; these are the canvas colour with the app icon, one per iPhone size, light and dark.
# Run from app/: powershell -ExecutionPolicy Bypass -File scripts/ios-splash.ps1
# Output: public/splash/*.png, plus the <link> lines for index.html. Run after scripts/app-icon.cjs.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'public\splash'
New-Item -ItemType Directory -Force $out | Out-Null
$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'public\icon-512.png'))

# CSS width x height at the device pixel ratio (portrait).
$sizes = @(
  @{ w = 440; h = 956; r = 3 },  # iPhone 16 Pro Max
  @{ w = 402; h = 874; r = 3 },  # iPhone 16 Pro
  @{ w = 430; h = 932; r = 3 },  # iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max
  @{ w = 393; h = 852; r = 3 },  # iPhone 16, 15, 15 Pro, 14 Pro
  @{ w = 428; h = 926; r = 3 },  # iPhone 14 Plus, 13 Pro Max, 12 Pro Max
  @{ w = 390; h = 844; r = 3 },  # iPhone 14, 13, 13 Pro, 12, 12 Pro
  @{ w = 375; h = 812; r = 3 },  # iPhone 13 mini, 12 mini, 11 Pro, XS, X
  @{ w = 414; h = 896; r = 3 },  # iPhone 11 Pro Max, XS Max
  @{ w = 414; h = 896; r = 2 },  # iPhone 11, XR
  @{ w = 414; h = 736; r = 3 },  # iPhone 8 Plus
  @{ w = 375; h = 667; r = 2 }   # iPhone 8, SE (2nd, 3rd)
)
$schemes = @(
  @{ name = 'light'; bg = [System.Drawing.Color]::FromArgb(255, 242, 242, 247) },
  @{ name = 'dark'; bg = [System.Drawing.Color]::FromArgb(255, 0, 0, 0) }
)

$links = New-Object System.Collections.Generic.List[string]
foreach ($s in $sizes) {
  foreach ($c in $schemes) {
    $pw = $s.w * $s.r
    $ph = $s.h * $s.r
    $bmp = New-Object System.Drawing.Bitmap $pw, $ph
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear($c.bg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # The icon at 96 pt, a little above the middle — where a native launch screen puts its mark.
    $size = 96 * $s.r
    $x = [int](($pw - $size) / 2)
    $y = [int]($ph * 0.44 - $size / 2)
    $g.DrawImage($icon, $x, $y, $size, $size)
    $g.Dispose()
    $file = "splash-$($s.w)x$($s.h)@$($s.r)x-$($c.name).png"
    $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $media = "screen and (device-width: $($s.w)px) and (device-height: $($s.h)px) and (-webkit-device-pixel-ratio: $($s.r)) and (orientation: portrait) and (prefers-color-scheme: $($c.name))"
    $links.Add("    <link rel=`"apple-touch-startup-image`" media=`"$media`" href=`"./splash/$file`" />")
  }
}

# The home-screen icon (public/apple-touch-icon.png, edge to edge) comes from scripts/app-icon.cjs.
$icon.Dispose()

$links | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'splash-links.html')
Write-Output "wrote $($links.Count) startup images to $out; <link> lines in scripts\splash-links.html"
