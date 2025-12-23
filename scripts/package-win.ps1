# 目的: Windows向けの配布パッケージ(zip)を生成する
# 前提: パッケージ生成マシンに Node 24系がインストール済みで PowerShell 実行ポリシーが許可されていること

param(
  [switch] $NoNode, # 配布物に node.exe を同梱しない（配布先で Node.js が必要）
  [switch] $IncludeNode, # 互換用: 旧オプション（指定してもしなくても同梱が既定）
  [string] $NodeExePath # 取り込みたい node.exe のパス（未指定時は PATH から探索）
)

$ErrorActionPreference = "Stop"

function Join-Paths([string] $a, [string] $b) {
  return [System.IO.Path]::Combine($a, $b)
}

function Assert-LastExitCode([string] $step) {
  if ($LASTEXITCODE -ne 0) {
    throw "コマンドが失敗しました: $step (exit=$LASTEXITCODE)"
  }
}

function Resolve-NodeExePath() {
  param(
    [string] $ExplicitPath
  )

  if ($ExplicitPath) {
    $resolved = Resolve-Path $ExplicitPath -ErrorAction Stop | Select-Object -ExpandProperty Path
    if (-not (Test-Path $resolved)) {
      throw "node.exe が見つかりませんでした: $resolved"
    }
    return $resolved
  }

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd -and $nodeCmd.Source -and (Test-Path $nodeCmd.Source)) {
    return $nodeCmd.Source
  }

  $defaultNodeExe = "C:\\Program Files\\nodejs\\node.exe"
  if (Test-Path $defaultNodeExe) {
    return $defaultNodeExe
  }

  return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Paths $scriptDir "..") | Select-Object -ExpandProperty Path
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
Assert-LastExitCode "[frontend] npm ci"
Write-Host "[frontend] npm run build" -ForegroundColor Green
npm run build
Assert-LastExitCode "[frontend] npm run build"
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
Assert-LastExitCode "[server] npm ci"
Write-Host "[server] npm run build" -ForegroundColor Green
npm run build
Assert-LastExitCode "[server] npm run build"
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
Assert-LastExitCode "[package] npm ci --omit=dev"
Pop-Location

# node.exe は既定で同梱する（配布先で Node.js の別途インストールを不要にする）
$shouldIncludeNode = $IncludeNode -or (-not $NoNode)
if ($shouldIncludeNode) {
  $nodeExe = Resolve-NodeExePath -ExplicitPath $NodeExePath
  if ($nodeExe) {
    Write-Host "[package] node.exe を同梱します: $nodeExe" -ForegroundColor Green
    Copy-Item $nodeExe $packageDir -Force
  } else {
    Write-Warning "node.exe が見つかりませんでした（-NodeExePath で明示してください）"
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
