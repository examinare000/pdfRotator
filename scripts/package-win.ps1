# 目的: Windows向けの配布パッケージ(zip)を生成する
# 前提: Node 24系がインストール済みで PowerShell 実行ポリシーが許可されていること

param(
  [switch] $IncludeNode  # 同梱したい場合に node.exe をコピーする
)

$ErrorActionPreference = "Stop"

function Join-Paths([string] $a, [string] $b) {
  return [System.IO.Path]::Combine($a, $b)
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseRoot = Join-Paths $repoRoot "release"
$packageDir = Join-Paths $releaseRoot "pdfrotator-win64"

Write-Host "パッケージ生成を開始します..." -ForegroundColor Cyan

# 出力ディレクトリを初期化
if (Test-Path $packageDir) {
  Remove-Item $packageDir -Recurse -Force
}
New-Item $packageDir -ItemType Directory | Out-Null

# フロントエンドをビルド
Push-Location (Join-Paths $repoRoot "frontend")
Write-Host "[frontend] npm ci" -ForegroundColor Green
npm ci
Write-Host "[frontend] npm run build" -ForegroundColor Green
npm run build
Pop-Location

# フロント出力を server/public に配置
$serverDir = Join-Paths $repoRoot "server"
$serverPublic = Join-Paths $serverDir "public"
if (Test-Path $serverPublic) {
  Remove-Item $serverPublic -Recurse -Force
}
New-Item $serverPublic -ItemType Directory | Out-Null
Copy-Item (Join-Paths $repoRoot "frontend/dist/*") $serverPublic -Recurse -Force

# サーバをビルド
Push-Location $serverDir
Write-Host "[server] npm ci" -ForegroundColor Green
npm ci
Write-Host "[server] npm run build" -ForegroundColor Green
npm run build
Pop-Location

# ランタイム資材をコピー
Copy-Item (Join-Paths $serverDir "dist") $packageDir -Recurse
Copy-Item $serverPublic $packageDir -Recurse
Copy-Item (Join-Paths $serverDir ".env.example") $packageDir
Copy-Item (Join-Paths $serverDir "package.json") $packageDir
Copy-Item (Join-Paths $serverDir "package-lock.json") $packageDir

# 本番依存のみをインストール（配布先でnpm実行不要にする）
Push-Location $packageDir
Write-Host "[package] npm ci --omit=dev" -ForegroundColor Green
npm ci --omit=dev
Pop-Location

# node.exe 同梱オプション
if ($IncludeNode) {
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (Test-Path $nodeExe) {
    Write-Host "[package] node.exe を同梱します" -ForegroundColor Green
    Copy-Item $nodeExe $packageDir
  } else {
    Write-Warning "node.exe が見つかりませんでした: $nodeExe"
  }
}

# 起動バッチを生成
$startCmd = @"
@echo off
setlocal
set SCRIPT_DIR=%~dp0
set NODE_EXE=%SCRIPT_DIR%node.exe
if exist "%NODE_EXE%" (
  set NODE_BIN="%NODE_EXE%"
) else (
  set NODE_BIN=node
)
if "%PORT%"=="" set PORT=3001
echo Starting PDF Rotator server on http://localhost:%PORT% ...
"%NODE_BIN%" dist\index.js
pause
endlocal
"@

Set-Content -Path (Join-Paths $packageDir "start.cmd") -Value $startCmd -Encoding ascii

# zip を作成
if (-not (Test-Path $releaseRoot)) {
  New-Item $releaseRoot -ItemType Directory | Out-Null
}
$zipPath = Join-Paths $releaseRoot "pdfrotator-win64.zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
Compress-Archive -Path (Join-Paths $packageDir "*") -DestinationPath $zipPath

Write-Host "パッケージ生成が完了しました: $zipPath" -ForegroundColor Cyan
