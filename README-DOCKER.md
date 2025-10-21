# Docker Setup for XAI Articles Scraper

This document explains how to use Docker to run the scraper in an isolated environment.

## Prerequisites

- Docker installed ([Get Docker](https://docs.docker.com/get-docker/))
- Docker Compose installed (usually comes with Docker Desktop)

## Quick Start

### 1. Build the Docker Image

```bash
docker-compose build
```

Or using the npm script:

```bash
pnpm run docker:build
```

### 2. Verify Data Structure

Before running scrapers, verify the data directory structure:

```bash
docker-compose run --rm scraper pnpm run verify:data
```

Or:

```bash
pnpm run docker:verify
```

### 3. Run Scrapers

#### Dawn Scrapers

```bash
# Scrape Dawn lists for a date range
docker-compose run --rm scraper node scrape_lists_dawn.js 2025-10-17:2025-10-20

# Scrape Dawn articles for a date range
docker-compose run --rm scraper node scrape_articles_dawn.js 2025-10-17:2025-10-20

# Run full Dawn range (lists + articles)
docker-compose run --rm scraper node run_range_dawn.js 2025-10-17:2025-10-20

# Or using pnpm scripts
docker-compose run --rm scraper pnpm run dawn:lists -- 2025-10-17:2025-10-20
docker-compose run --rm scraper pnpm run dawn:articles -- 2025-10-17:2025-10-20
docker-compose run --rm scraper pnpm run dawn:range -- 2025-10-17:2025-10-20
```

#### APP Scrapers

```bash
# Scrape APP latest lists
docker-compose run --rm scraper node scrape_lists_app.js --latest

# Scrape APP articles for specific dates
docker-compose run --rm scraper node scrape_articles_app.js --fromDate 2025-10-17 --toDate 2025-10-20

# Or using pnpm scripts
docker-compose run --rm scraper pnpm run app:lists:latest
docker-compose run --rm scraper pnpm run app:articles -- --fromDate 2025-10-17 --toDate 2025-10-20
```

#### Refetch Operations

```bash
# Refetch null content for both sources
docker-compose run --rm scraper node scripts/refetch_null_content.js --source both

# Refetch for specific date range
docker-compose run --rm scraper node scripts/refetch_null_content.js --source dawn --dates 2025-10-17:2025-10-20

# Or using pnpm scripts
docker-compose run --rm scraper pnpm run data:refetch:nulls -- --source both
```

### 4. Run Continuous Refetch (Optional)

To run the refetch service continuously:

```bash
docker-compose --profile refetch up -d
```

To stop it:

```bash
docker-compose --profile refetch down
```

## Data Persistence

All scraped data is stored in the `./data` directory on your host machine. The Docker container mounts this directory as a volume, so:

- ✅ Data persists between container runs
- ✅ Data is accessible from both host and container
- ✅ No data loss when container is removed

Directory structure:
```
data/
├── dawn/
│   ├── articles/YYYY/MM/DD/*.json
│   └── lists/YYYY/MM/DD/*.json
├── app/
│   ├── articles/YYYY/MM/DD/*.json
│   └── lists/page_*.json
└── progress/
    └── refetch_nulls/*.json
```

## Advanced Usage

### Interactive Shell

To get a shell inside the container:

```bash
docker-compose run --rm scraper /bin/bash
```

Then you can run commands directly:

```bash
node scrape_lists_dawn.js 2025-10-17
pnpm run verify:data
ls -la /app/data
```

### Custom Environment Variables

Edit `docker-compose.yml` to add environment variables:

```yaml
environment:
  - NODE_ENV=production
  - TZ=UTC
  - CUSTOM_VAR=value
```

Or use a `.env` file (already mounted in docker-compose.yml).

### Resource Limits

Adjust CPU and memory limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
```

## Troubleshooting

### Permission Issues

If you encounter permission errors writing to `./data`, adjust the Dockerfile USER directive or run:

```bash
sudo chown -R $(id -u):$(id -g) ./data
```

### Data Not Persisting

Ensure the volume mount is correct in `docker-compose.yml`:

```yaml
volumes:
  - ./data:/app/data  # Host path : Container path
```

### Container Won't Start

Check logs:

```bash
docker-compose logs scraper
```

### Chromium Issues

The Dockerfile includes all necessary dependencies for Chromium. If you still face issues, try:

```bash
docker-compose run --rm scraper chromium --version
```

## Cleanup

Remove containers and images:

```bash
# Stop and remove containers
docker-compose down

# Remove the image
docker rmi xai_articles_scraper

# Remove all unused Docker resources
docker system prune -a
```

## Production Deployment

For production use, consider:

1. **Use a `.env` file** for sensitive configuration
2. **Set up log rotation** for container logs
3. **Use Docker secrets** for sensitive data
4. **Schedule cron jobs** using a scheduler service (e.g., ofelia, airflow)
5. **Monitor resources** using Docker stats or monitoring tools

Example cron-like scheduling with ofelia:

```yaml
services:
  scheduler:
    image: mcuadros/ofelia:latest
    depends_on:
      - scraper
    command: daemon --docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    labels:
      ofelia.job-run.dawn-daily.schedule: "0 2 * * *"
      ofelia.job-run.dawn-daily.container: "xai_articles_scraper"
      ofelia.job-run.dawn-daily.command: "pnpm run dawn:range -- $(date -d yesterday +%Y-%m-%d)"
```