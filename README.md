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

1. Clone the repository:
   ```bash
   git clone https://github.com/gitcodeuu/xai_articles.git
   cd xai_articles
   ```

2. Build the Docker image:
   ```bash
   docker-compose build
   ```

3. Run the scraper:
   ```bash
   docker-compose up
   ```

## Usage

To run the scraper, execute the following command:
```bash
docker-compose run --rm scraper
```

### Testing Changes

1. Make code changes
2. Rebuild Docker image
   ```bash
   docker-compose build --no-cache
   ```
3. Test with manual command
   ```bash
   docker-compose run --rm scraper node run_range_dawn.js 2025-10-21
   ```
4. Run full pipeline
   ```bash
   docker-compose run --rm scraper-daily
   ```

## Adding New Sources

1. Create new scraper file (e.g., `scrape_lists_newsource.js`)
2. Follow Puppeteer patterns from existing scrapers
3. Update `docker-compose.yml` pipeline command
4. Add help documentation to `help.js`
5. Update this README

## Performance

Typical scraping times (depends on network and article count):
- **Dawn**: ~5-10 minutes for a single day
- **APP**: ~5-10 minutes for a single day

## License

This project is licensed under the MIT License.

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


