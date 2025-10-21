# Complete setup and run script with permission fixes

param(
    [switch]$SkipBuild = $false
)

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "🚀 XAI Articles Scraper Setup" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# Step 1: Fix permissions and create directories
Write-Host "🔧 [1/4] Setting up directories with permissions..." -ForegroundColor Cyan

$dirs = @(
    ".\data",
    ".\data\dawn",
    ".\data\dawn\lists",
    ".\data\dawn\articles", 
    ".\data\dawn\logs",
    ".\data\app",
    ".\data\app\lists",
    ".\data\app\articles",
    ".\data\app\logs",
    ".\data\progress",
    ".\data\progress\refetch_nulls",
    ".\logs"
)

foreach ($dir in $dirs) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  ✓ Created: $dir" -ForegroundColor Gray
    }
    
    try {
        # Set full permissions for Everyone on Windows
        $acl = Get-Acl $dir
        $everyone = New-Object System.Security.Principal.SecurityIdentifier("S-1-1-0")
        $permission = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $everyone,
            "FullControl",
            "ContainerInherit,ObjectInherit",
            "None",
            "Allow"
        )
        $acl.SetAccessRule($permission)
        Set-Acl $dir $acl
    }
    catch {
        Write-Host "  ⚠ Could not set permissions for $dir (might be okay)" -ForegroundColor Yellow
    }
}

Write-Host "✅ Directories ready" -ForegroundColor Green
Write-Host ""

# Step 2: Stop any running containers
Write-Host "🛑 [2/4] Stopping existing containers..." -ForegroundColor Cyan
docker-compose down 2>$null | Out-Null
Write-Host "✅ Containers stopped" -ForegroundColor Green
Write-Host ""

# Step 3: Rebuild image (optional)
if (-not $SkipBuild) {
    Write-Host "🔨 [3/4] Rebuilding Docker image..." -ForegroundColor Cyan
    docker-compose build --no-cache scraper-daily
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Image built successfully" -ForegroundColor Green
} else {
    Write-Host "⏭️  [3/4] Skipping build (using existing image)" -ForegroundColor Yellow
}
Write-Host ""

# Step 4: Run scraper
Write-Host "🚀 [4/4] Running automated scraper..." -ForegroundColor Cyan
Write-Host ""

docker-compose run --rm scraper-daily

$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Yellow

if ($exitCode -eq 0) {
    Write-Host "✅ Setup and scrape completed successfully!" -ForegroundColor Green
} else {
    Write-Host "❌ Scrape failed with exit code: $exitCode" -ForegroundColor Red
}

Write-Host "════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# Show results
if (Test-Path ".\data") {
    try {
        $dawnArticles = (Get-ChildItem -Path ".\data\dawn\articles" -Recurse -File -ErrorAction SilentlyContinue).Count
        $appArticles = (Get-ChildItem -Path ".\data\app\articles" -Recurse -File -ErrorAction SilentlyContinue).Count
        $totalFiles = (Get-ChildItem -Path ".\data" -Recurse -File -ErrorAction SilentlyContinue).Count
        
        Write-Host "📊 Scraping Results:" -ForegroundColor Cyan
        Write-Host "   Dawn articles: $dawnArticles" -ForegroundColor White
        Write-Host "   APP articles:  $appArticles" -ForegroundColor White
        Write-Host "   Total files:   $totalFiles" -ForegroundColor White
        Write-Host ""
    }
    catch {
        Write-Host "📊 Data directory exists but couldn't count files" -ForegroundColor Yellow
        Write-Host ""
    }
}

exit $exitCode