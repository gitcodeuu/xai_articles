# xai_articles

A robust web scraping system for collecting news articles from Pakistani news sources (Dawn and APP) using Puppeteer in Docker.

## Overview

This project automates the collection of news articles from:
- **Dawn.com** - Pakistan section articles
- **APP.com.pk** - Associated Press of Pakistan national section

The scraper runs in Docker with Chromium/Puppeteer for reliable, consistent scraping across different environments.

## Features

- 🐳 **Dockerized Environment** - Consistent scraping across Windows, Mac, and Linux
- 🚀 **Automated Pipeline** - One-command daily scraping with 4-step process
- 📰 **Dual Source Support** - Scrapes both Dawn and APP news sources
- 🔄 **Auto-Retry Logic** - Refetches failed/empty articles automatically
- 📊 **Progress Tracking** - Detailed logs and statistics for each scraping session
- 🛡️ **Error Handling** - Graceful handling of network failures and scraping errors
- 💾 **Structured Storage** - Organized JSON files by date and source

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) or Docker Engine (Linux)
- [Node.js 22+](https://nodejs.org/) (for local development)
- [pnpm](https://pnpm.io/) - Install with `npm install -g pnpm`

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd xai_articles
   ```

2. **Install dependencies** (for local development)
   ```bash
   pnpm install
   ```

3. **Build Docker image**
   ```bash
   pnpm run docker:build
   ```

4. **Run automated scraping**
   ```bash
   # Using Docker Compose
   docker-compose run --rm scraper-daily

   # Or using PowerShell helper script
   .\scripts\setup_and_run.ps1
   ```

## Usage

### Automated Daily Scraping (Recommended)

Run the complete pipeline to scrape today's articles from both sources:

```powershell
# One-shot automated pipeline
docker-compose run --rm scraper-daily

# Or with PowerShell helper
.\scripts\setup_and_run.ps1
```

**What it does:**
1. Scrapes Dawn lists and articles for today
2. Scrapes APP lists (latest page)
3. Scrapes APP articles for today
4. Refetches any failed/empty articles

### Manual Commands

#### Dawn Scraping

```powershell
# Scrape Dawn for a single date
docker-compose run --rm scraper node run_range_dawn.js 2025-10-21

# Scrape Dawn for a date range
docker-compose run --rm scraper node run_range_dawn.js 2025-10-15 2025-10-21

# Scrape only lists
docker-compose run --rm scraper node scrape_lists_dawn.js 2025-10-21

# Scrape only articles
docker-compose run --rm scraper node scrape_articles_dawn.js 2025-10-21
```

#### APP Scraping

```powershell
# Scrape APP lists (latest page only)
docker-compose run --rm scraper node scrape_lists_app.js --latest

# Scrape APP lists (pages 1-10)
docker-compose run --rm scraper node scrape_lists_app.js --startPage 1 --endPage 10

# Scrape APP articles for a specific date
docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-21

# Scrape APP articles for a date range
docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-15 --toDate 2025-10-21
```

#### Refetch Failed Articles

```powershell
# Refetch null/empty content from both sources
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21

# Refetch only Dawn
docker-compose run --rm scraper node scripts/refetch_null_content.js --source dawn --dates 2025-10-21

# Refetch only APP
docker-compose run --rm scraper node scripts/refetch_null_content.js --source app --dates 2025-10-21

# Dry run (see what would be refetched without actually doing it)
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both --dates 2025-10-21 --dry
```

### View Help

```powershell
# General help
docker-compose run --rm scraper node help.js

# Specific command help
docker-compose run --rm scraper node help.js dawn
docker-compose run --rm scraper node help.js app
docker-compose run --rm scraper node help.js refetch
docker-compose run --rm scraper node help.js docker
docker-compose run --rm scraper node help.js pipeline
```

## Project Structure

```
xai_articles/
├── data/                           # Scraped data (gitignored)
│   ├── dawn/
│   │   ├── lists/YYYY/MM/DD/      # Dawn article lists by date
│   │   ├── articles/YYYY/MM/DD/   # Dawn full articles by date
│   │   └── logs/                  # Dawn scraping logs
│   ├── app/
│   │   ├── lists/YYYY/MM/DD/      # APP article lists by date
│   │   ├── articles/YYYY/MM/DD/   # APP full articles by date
│   │   └── logs/                  # APP scraping logs
│   └── progress/
│       └── refetch_nulls/         # Refetch progress tracking
├── scripts/                        # PowerShell helper scripts
│   ├── setup_and_run.ps1          # Complete setup and run
│   └── scrape_today_verbose.ps1   # Verbose daily scraping
├── logs/                           # Application logs
├── Dockerfile                      # Docker image definition
├── docker-compose.yml              # Docker services configuration
├── entrypoint.sh                   # Docker entrypoint (permission fixer)
├── package.json                    # Node.js dependencies
├── help.js                         # Interactive help system
├── run_range_dawn.js               # Dawn complete pipeline
├── scrape_lists_dawn.js            # Dawn list scraper
├── scrape_articles_dawn.js         # Dawn article scraper
├── scrape_lists_app.js             # APP list scraper
├── scrape_articles_app.js          # APP article scraper
└── README.md                       # This file
```

## Data Format

### Article List Format

```json
{
  "url": "https://www.dawn.com/news/1234567",
  "title": "Article Title",
  "category": "Pakistan",
  "datePublished": "2025-10-21",
  "scrapedAt": "2025-10-21T12:34:56.789Z"
}
```

### Article Content Format

```json
{
  "url": "https://www.dawn.com/news/1234567",
  "title": "Article Title",
  "content": "Full article text content...",
  "author": "Author Name",
  "datePublished": "2025-10-21",
  "category": "Pakistan",
  "scrapedAt": "2025-10-21T12:34:56.789Z",
  "source": "dawn"
}
```

## Docker Setup

The project uses two Docker services:

### 1. `scraper` - Manual Commands
Persistent container for running individual scraping commands.

```powershell
# Start container
docker-compose up -d scraper

# Execute commands
docker-compose exec scraper node run_range_dawn.js 2025-10-21

# Stop container
docker-compose down
```

### 2. `scraper-daily` - Automated Pipeline
One-shot container that runs the complete pipeline and exits.

```powershell
# Run automated pipeline
docker-compose run --rm scraper-daily
```

See [README-DOCKER.md](README-DOCKER.md) for detailed Docker documentation.

## Configuration

### Resource Limits

Default limits in `docker-compose.yml`:
- **CPU**: 2 cores max, 1 core reserved
- **Memory**: 4GB max, 2GB reserved

Adjust based on your system:

```yaml
deploy:
  resources:
    limits:
      cpus: '4.0'    # Increase for faster processing
      memory: 8G     # Increase if you get OOM errors
```

### Concurrency Settings

Adjust parallel processing in scraper files:

```javascript
// In scrape_articles_dawn.js or scrape_articles_app.js
const CONCURRENCY = 8  // Increase for faster scraping (uses more memory)
```

### Browser Configuration

Puppeteer browser settings in scraper files:

```javascript
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
})
```

## Scheduling

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at 2:00 AM
4. Set action:
   - Program: `powershell.exe`
   - Arguments: `-File "D:\CODE\xai_articles\xai_articles\scripts\setup_and_run.ps1"`
   - Start in: `D:\CODE\xai_articles\xai_articles`

### Linux Cron

```bash
# Add to crontab (crontab -e)
0 2 * * * cd /path/to/xai_articles && docker-compose run --rm scraper-daily >> /var/log/xai_scraper.log 2>&1
```

## Troubleshooting

### Permission Errors on Windows

```powershell
# Fix permissions
.\scripts\setup_and_run.ps1

# Or manually
icacls ".\data" /grant Everyone:F /T
docker-compose build --no-cache
```

### Browser Launch Failures

```powershell
# Test browser
docker-compose run --rm scraper node -e "const puppeteer = require('puppeteer'); (async () => { const browser = await puppeteer.launch(); console.log('✅ Browser works'); await browser.close(); })()"
```

### Out of Memory

Increase memory limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 8G  # Increase from 4G
```

### View Logs

```powershell
# Container logs
docker-compose logs -f scraper-daily

# Scraping logs
Get-Content .\data\dawn\logs\scrape_articles.log -Tail 50
Get-Content .\data\app\logs\scrape_articles.log -Tail 50
```

See [README-DOCKER.md](README-DOCKER.md) for more troubleshooting tips.

## Development

### Local Development (Without Docker)

```bash
# Install dependencies
pnpm install

# Run scrapers locally
node run_range_dawn.js 2025-10-21
node scrape_lists_app.js --latest
node scrape_articles_app.js --fromDate 2025-10-21
```

### Testing Changes

```powershell
# 1. Make code changes
# 2. Rebuild Docker image
docker-compose build --no-cache

# 3. Test with manual command
docker-compose run --rm scraper node run_range_dawn.js 2025-10-21

# 4. Run full pipeline
docker-compose run --rm scraper-daily
```

### Adding New Sources

1. Create new scraper file (e.g., `scrape_lists_newsource.js`)
2. Follow Puppeteer patterns from existing scrapers
3. Update `docker-compose.yml` pipeline command
4. Add help documentation to `help.js`
5. Update this README

## Performance

Typical scraping times (depends on network and article count):
- **Dawn**: ~5-10 minutes for a single day
- **APP**: ~10-15 minutes for latest lists + articles
- **Refetch**: ~2-5 minutes for typical null count

Memory usage:
- **Idle**: ~200MB
- **Active scraping**: ~500MB-2GB
- **Peak (concurrent)**: ~2-4GB

## Best Practices

1. ✅ **Always run in Docker** for consistency
2. ✅ **Use automated pipeline** for daily scraping
3. ✅ **Monitor logs** for errors and warnings
4. ✅ **Schedule runs** during low-traffic hours (2-4 AM)
5. ✅ **Backup data directory** regularly
6. ✅ **Run refetch** after initial scraping to catch failures
7. ✅ **Check disk space** - each day generates 5-10MB of data

## Limitations

- **Rate limiting**: No built-in rate limiting (respects target sites)
- **Dynamic content**: May miss JavaScript-loaded content
- **Captchas**: No captcha solving (requires manual intervention)
- **Authentication**: No support for login-required content
- **Image scraping**: Text content only, no image download

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Make changes and test with Docker
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open Pull Request

## License

[Add your license here]

## Support

For issues or questions:
1. Check [README-DOCKER.md](README-DOCKER.md) for Docker-specific issues
2. Run `node help.js` for command documentation
3. View logs in `./data/<source>/logs/`
4. Open GitHub Issue with:
   - Error message
   - Command used
   - Docker logs output
   - System info (OS, Docker version)

## Acknowledgments

- [Puppeteer](https://pptr.dev/) - Headless Chrome Node.js API
- [Dawn.com](https://www.dawn.com/) - Source of news content
- [APP](https://www.app.com.pk/) - Associated Press of Pakistan

---

**Note**: This scraper is for educational and research purposes. Please respect the target websites' terms of service and robots.txt. Always scrape responsibly and ethically.