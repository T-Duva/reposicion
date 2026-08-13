Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  if ($r -gt ($w / 2)) { $r = $w / 2 }
  if ($r -gt ($h / 2)) { $r = $h / 2 }
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Max(0.1, $r * 2)
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  $dir = Split-Path $path
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-Graphics([System.Drawing.Bitmap]$bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.CompositingQuality = 'HighQuality'
  return $g
}

function Add-Eleven([System.Drawing.Graphics]$g, [float]$size, [float]$shiftY = -0.04) {
  $fontSize = [Math]::Max(12, $size * 0.50)
  $font = New-Object System.Drawing.Font 'Arial Black', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, ($size * $shiftY), $size, $size
  $g.DrawString('11', $font, [System.Drawing.Brushes]::White, $rect, $sf)
  $font.Dispose()
  $sf.Dispose()
}

function New-ComposedIcon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-Graphics $bmp
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1, [int]($size * 0.018))
  $outer = $size - 2 * $pad
  $radius = $outer * 0.23
  $stroke = $outer * 0.088

  $outerPath = New-RoundedRectPath $pad $pad $outer $outer $radius
  $cTop = [System.Drawing.Color]::FromArgb(255, 244, 86, 78)
  $cBot = [System.Drawing.Color]::FromArgb(255, 168, 14, 16)
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0, $pad),
    (New-Object System.Drawing.Point 0, ($pad + $outer)),
    $cTop, $cBot
  )
  $g.FillPath($br, $outerPath)
  $br.Dispose()

  $inset = $pad + $stroke
  $innerS = $size - 2 * $inset
  $innerR = [Math]::Max(4, $radius - $stroke * 0.9)
  $innerPath = New-RoundedRectPath $inset $inset $innerS $innerS $innerR
  $blackBr = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
  $g.FillPath($blackBr, $innerPath)
  $blackBr.Dispose()

  Add-Eleven $g $size
  $outerPath.Dispose()
  $innerPath.Dispose()
  $g.Dispose()
  return $bmp
}

function New-RedBackground([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-Graphics $bmp
  $cTop = [System.Drawing.Color]::FromArgb(255, 244, 86, 78)
  $cBot = [System.Drawing.Color]::FromArgb(255, 168, 14, 16)
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point 0, $size),
    $cTop, $cBot
  )
  $g.FillRectangle($br, 0, 0, $size, $size)
  $br.Dispose()
  $g.Dispose()
  return $bmp
}

function New-Foreground([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-Graphics $bmp
  $g.Clear([System.Drawing.Color]::Transparent)

  $inset = [int]($size * 0.10)
  $innerS = $size - 2 * $inset
  $radius = $innerS * 0.22
  $innerPath = New-RoundedRectPath $inset $inset $innerS $innerS $radius
  $blackBr = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
  $g.FillPath($blackBr, $innerPath)
  $blackBr.Dispose()

  Add-Eleven $g $size
  $innerPath.Dispose()
  $g.Dispose()
  return $bmp
}

$root = Split-Path $PSScriptRoot -Parent
$icons = Join-Path $root 'public\icons'
New-Item -ItemType Directory -Force -Path $icons | Out-Null

$master = New-ComposedIcon 1024
Save-Png $master (Join-Path $icons 'icon-source.png')
Save-Png $master (Join-Path $icons 'icon-512.png')

$i192 = New-ComposedIcon 192
Save-Png $i192 (Join-Path $icons 'icon-192.png')
$i192.Dispose()

$i512 = New-ComposedIcon 512
Save-Png $i512 (Join-Path $icons 'icon-512.png')
$i512.Dispose()

$res = Join-Path $root 'resources'
New-Item -ItemType Directory -Force -Path $res | Out-Null
Save-Png $master (Join-Path $res 'icon.png')
$master.Dispose()

$mip = @{
  'mipmap-ldpi'    = 36
  'mipmap-mdpi'    = 48
  'mipmap-hdpi'    = 72
  'mipmap-xhdpi'   = 96
  'mipmap-xxhdpi'  = 144
  'mipmap-xxxhdpi' = 192
}
$fgMaster = New-Foreground 432
$bgMaster = New-RedBackground 432
foreach ($name in $mip.Keys) {
  $s = [int]$mip[$name]
  $dir = Join-Path $root "android\app\src\main\res\$name"
  $full = New-ComposedIcon $s
  Save-Png $full (Join-Path $dir 'ic_launcher.png')
  Save-Png $full (Join-Path $dir 'ic_launcher_round.png')
  $full.Dispose()

  $fg = New-Foreground $s
  Save-Png $fg (Join-Path $dir 'ic_launcher_foreground.png')
  $fg.Dispose()

  $bg = New-RedBackground $s
  Save-Png $bg (Join-Path $dir 'ic_launcher_background.png')
  $bg.Dispose()
}
$fgMaster.Dispose()
$bgMaster.Dispose()

$any = Join-Path $root 'android\app\src\main\res\mipmap-anydpi-v26'
if (Test-Path $any) { Remove-Item -Recurse -Force $any }

Write-Output 'icons ok'
