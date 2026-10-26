$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$output = Join-Path $PSScriptRoot '../extension/icons'
New-Item -ItemType Directory -Path $output -Force | Out-Null
# Raster equivalents of assets/icon.svg; render large first for clean small icons.
$canvas = New-Object System.Drawing.Bitmap 512, 512
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(4, 4)
$shape = New-Object System.Drawing.Drawing2D.GraphicsPath
$shape.AddArc(16, 16, 56, 56, 180, 90)
$shape.AddArc(56, 16, 56, 56, 270, 90)
$shape.AddArc(56, 56, 56, 56, 0, 90)
$shape.AddArc(16, 56, 56, 56, 90, 90)
$shape.CloseFigure()
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#16846b'))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 7
$pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
try {
  $graphics.FillPath($brush, $shape)
  $graphics.DrawLine($pen, 64, 38, 64, 82)
  $graphics.DrawLines($pen, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(48,66), [System.Drawing.PointF]::new(64,82), [System.Drawing.PointF]::new(80,66)))
  $graphics.DrawLine($pen, 45, 94, 83, 94)
  foreach ($size in @(16,32,48,128)) {
    $icon = New-Object System.Drawing.Bitmap $size, $size
    $scaled = [System.Drawing.Graphics]::FromImage($icon)
    try {
      $scaled.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scaled.DrawImage($canvas, 0, 0, $size, $size)
      $icon.Save((Join-Path $output "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $scaled.Dispose(); $icon.Dispose() }
  }
} finally { $pen.Dispose(); $brush.Dispose(); $shape.Dispose(); $graphics.Dispose(); $canvas.Dispose() }
Write-Output 'Generated 16, 32, 48 and 128 px extension icons.'
