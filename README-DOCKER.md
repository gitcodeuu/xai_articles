# Docker Setup for xai_articles

This document provides comprehensive instructions for running the xai_articles scraper in Docker.

## Overview

The project uses Docker to provide a consistent, isolated environment for running Puppeteer-based web scraping. Two Docker services are available:

- **scraper**: Persistent container for manual commands
- **scraper-daily**: One-shot automated pipeline for daily scraping

## Prerequisites

- Docker Desktop (Windows/Mac) or Docker Engine (Linux)
- Docker Compose V2+
- Node.js 22+ (for local development)
- pnpm (installed via `npm install -g pnpm`)

## Quick Start

### 1. Build the Docker Image

```powershell
# Using pnpm script
pnpm run docker:build

# Or directly with Docker Compose
docker-compose build

# Force rebuild without cache (after code changes)
docker-compose build --no-cache
```

### 2. Run Automated Daily Scraping

```powershell
# Run complete pipeline for today's date
docker-compose run --rm scraper-daily

# Using PowerShell helper script
.\scripts\setup_and_run.ps1

# Skip rebuild if image is up-to-date
.\scripts\setup_and_run.ps1 -SkipBuild
```

## Docker Services

### scraper (Manual Commands)

Persistent container that stays alive for running individual commands.

```powershell
# Start the container in background
docker-compose up -d scraper

# Execute commands in running container
docker-compose exec scraper node run_range_dawn.js 2025-10-21
docker-compose exec scraper node scrape_lists_app.js --latest
docker-compose exec scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21

# Run one-off commands without starting persistent container
docker-compose run --rm scraper node run_range_dawn.js 2025-10-21

# Stop the persistent container
docker-compose stop scraper

# Remove the container
docker-compose down
```

### scraper-daily (Automated Pipeline)

One-shot container that runs the complete scraping pipeline and exits.

**Pipeline Steps:**
1. Scrape Dawn lists and articles
2. Scrape APP lists
3. Scrape APP articles
4. Refetch null/empty content

```powershell
# Run automated pipeline (runs all 4 steps)
docker-compose run --rm scraper-daily

# Build and run in one command
docker-compose up --build scraper-daily
```

## Common Commands

### Dawn Scraping

```powershell
# Scrape Dawn for a single date
docker-compose run --rm scraper node run_range_dawn.js 2025-10-21

# Scrape Dawn for a date range
docker-compose run --rm scraper node run_range_dawn.js 2025-10-15 2025-10-21

# Scrape only lists
docker-compose run --rm scraper node scrape_lists_dawn.js 2025-10-21

# Scrape only articles (requires lists first)
docker-compose run --rm scraper node scrape_articles_dawn.js 2025-10-21
```

### APP Scraping

```powershell
# Scrape APP lists (latest page only)
docker-compose run --rm scraper node scrape_lists_app.js --latest

# Scrape APP lists (multiple pages)
docker-compose run --rm scraper node scrape_lists_app.js --startPage 1 --endPage 5

# Scrape APP articles for a date
docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-21

# Scrape APP articles for a date range
docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-15 --toDate 2025-10-21
```

### Refetch Utility

```powershell
# Refetch null content for both sources
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21

# Refetch only Dawn
docker-compose run --rm scraper node scripts/refetch_null_content.js --source dawn --dates 2025-10-21

# Refetch only APP
docker-compose run --rm scraper node scripts/refetch_null_content.js --source app --dates 2025-10-21

# Dry run (see what would be refetched)
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21 --dry
```

## Viewing Logs

```powershell
# View logs from running container
docker-compose logs -f scraper

# View logs from automated pipeline
docker-compose logs -f scraper-daily

# View last 100 lines
docker-compose logs --tail=100 scraper-daily

# View logs since specific time
docker-compose logs --since=10m scraper-daily
```

## Troubleshooting

### Permission Errors (EACCES)

If you encounter permission errors on Windows:

```powershell
# Run the setup script to fix permissions
.\scripts\setup_and_run.ps1

# Or manually fix permissions
icacls ".\data" /grant Everyone:F /T
icacls ".\logs" /grant Everyone:F /T

# Then rebuild
docker-compose build --no-cache
```

### Browser Launch Failures

```powershell
# Check Chromium installation
docker-compose run --rm scraper chromium --version

# Verify Puppeteer configuration
docker-compose run --rm scraper node -e "console.log(process.env.PUPPETEER_EXECUTABLE_PATH)"

# Test browser launch
docker-compose run --rm scraper node -e "const puppeteer = require('puppeteer'); (async () => { const browser = await puppeteer.launch(); console.log('✅ Browser launched'); await browser.close(); })()"
```

### Container Won't Start

```powershell
# Check container status
docker ps -a

# View container logs
docker logs xai_scraper

# Remove and rebuild
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d scraper
```

### Out of Memory Errors

Increase memory limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 8G  # Increase from 4G
```

### Clean Up Everything

```powershell
# Stop and remove all containers
docker-compose down

# Remove volumes (WARNING: deletes data)
docker-compose down -v

# Remove all unused Docker resources
docker system prune -a --volumes
```

## Directory Structure

```
xai_articles/
├── data/                      # Mounted volume for scraped data
│   ├── dawn/
│   │   ├── lists/YYYY/MM/DD/
│   │   ├── articles/YYYY/MM/DD/
│   │   └── logs/
│   ├── app/
│   │   ├── lists/YYYY/MM/DD/
│   │   ├── articles/YYYY/MM/DD/
│   │   └── logs/
│   └── progress/
│       └── refetch_nulls/
├── logs/                      # Application logs
├── Dockerfile                 # Docker image definition
├── docker-compose.yml         # Service configuration
├── entrypoint.sh             # Permission fixer and user switcher
└── package.json              # Node.js dependencies
```

## Environment Variables

The following environment variables are set in `docker-compose.yml`:

| Variable | Value | Description |
|----------|-------|-------------|
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` | Path to Chromium browser |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` | Skip downloading bundled Chromium |
| `DOCKER_ENV` | `true` | Flag indicating Docker environment |
| `NODE_ENV` | `production` | Node environment |
| `HOME` | `/home/scraper` | User home directory |
| `TZ` | `UTC` | Timezone |

## Resource Limits

Default resource limits (adjust in `docker-compose.yml` if needed):

- **CPU**: 2 cores max, 1 core reserved
- **Memory**: 4GB max, 2GB reserved

## Security

- Container runs as non-root `scraper` user (UID 1000, GID 1000)
- Entrypoint uses `gosu` to drop privileges from root to scraper user
- Chromium runs in sandbox mode
- No network access required during scraping (except for target websites)

## Performance Tips

1. **Increase concurrency** in scrapers for faster processing:
   ```javascript
   // In scrape_articles_*.js
   const CONCURRENCY = 16  // Increase from 8
   ```

2. **Adjust resource limits** based on available system resources

3. **Use SSD storage** for data directory for better I/O performance

4. **Monitor memory usage**:
   ```powershell
   docker stats xai_scraper
   ```

## Scheduling Automated Runs

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger (e.g., Daily at 2:00 AM)
4. Set action:
   - Program: `powershell.exe`
   - Arguments: `-File "D:\CODE\xai_articles\xai_articles\scripts\setup_and_run.ps1"`
   - Start in: `D:\CODE\xai_articles\xai_articles`

### Linux Cron

```bash
# Add to crontab (crontab -e)
0 2 * * * cd /path/to/xai_articles && docker-compose run --rm scraper-daily >> /var/log/xai_scraper.log 2>&1
```

## Development Workflow

1. **Make code changes** in your local files
2. **Rebuild Docker image** to include changes:
   ```powershell
   docker-compose build --no-cache
   ```
3. **Test changes** with manual commands:
   ```powershell
   docker-compose run --rm scraper node <your_script>.js
   ```
4. **Run full pipeline** once satisfied:
   ```powershell
   docker-compose run --rm scraper-daily
   ```

## Help and Documentation

```powershell
# View general help
docker-compose run --rm scraper node help.js

# View Dawn scraping help
docker-compose run --rm scraper node help.js dawn

# View APP scraping help
docker-compose run --rm scraper node help.js app

# View refetch utility help
docker-compose run --rm scraper node help.js refetch

# View Docker commands help
docker-compose run --rm scraper node help.js docker

# View pipeline help
docker-compose run --rm scraper node help.js pipeline
```

## Version Information

```powershell
# Check Docker version
docker --version
docker-compose --version

# Check Node.js version in container
docker-compose run --rm scraper node --version

# Check pnpm version in container
docker-compose run --rm scraper pnpm --version

# Check Chromium version in container
docker-compose run --rm scraper chromium --version
```

## Additional Resources

- [Puppeteer Documentation](https://pptr.dev/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Chromium Command Line Switches](https://peter.sh/experiments/chromium-command-line-switches/)

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. View container logs: `docker-compose logs scraper-daily`
3. Review application logs in `./data/<source>/logs/`
4. Check GitHub Issues (if applicable)