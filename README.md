# xai_articles

A robust, containerized data pipeline for scraping, cleaning, and transforming news articles from Pakistani news sources (Dawn and APP).

## Overview

This project provides a fully automated, two-stage pipeline using Docker Compose:
1.  **Scraping**: A Node.js service using Puppeteer scrapes article data from Dawn.com and APP.com.pk.
2.  **Cleaning**: A Python service cleans, normalizes, and enriches the raw JSON data into a structured format.

The entire workflow is orchestrated with Docker Compose, ensuring consistency and reliability across different environments.

## Features

- 🐳 **Fully Containerized**: The entire scrape-and-clean pipeline runs in Docker.
- 🚀 **Automated Sequential Pipeline**: One command runs the scraping and cleaning steps in the correct order.
- 🐍 **Python Data Cleaning**: A dedicated Python service for robust data transformation and enrichment.
- 📰 **Dual Source Support**: Scrapes both Dawn and APP news sources.
- 🔄 **Delta Processing**: The cleaning script intelligently processes only new or updated articles, skipping work that has already been done.
- 🛡️ **Robust Error Handling**: Gracefully handles common scraping and data processing issues like empty files or bad JSON.
- 💾 **Structured Storage**: Raw and transformed data are stored in a clean, organized directory structure.

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) or Docker Engine (Linux)
- [Node.js 22+](https://nodejs.org/) (for local development)
- [pnpm](https://pnpm.io/) - Install with `npm install -g pnpm`

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/gitcodeuu/xai_articles.git
    cd xai_articles
    ```

2.  (Optional) Create a `.env` file if you need to override default settings.

### Running the Pipeline

This is the primary command to run the entire end-to-end pipeline.

- **Run for the current date**:
  ```bash
  docker-compose -f docker-compose.pipeline.yml up --build
  ```

- **Run for a specific date**:
  ```bash
  # For PowerShell (Windows)
  $env:DATE="YYYY-MM-DD"; docker-compose -f docker-compose.pipeline.yml up --build

  # For bash/zsh (macOS/Linux)
  DATE="YYYY-MM-DD" docker-compose -f docker-compose.pipeline.yml up --build
  ```

This command will:
1.  Build the Docker images (if they've changed).
2.  Run the `scraper-daily` service to scrape the data.
3.  Once scraping is complete, automatically run the `data-cleaner` service.
4.  Shut down cleanly when the process is finished.

## Development

### Manual Tasks

You can run individual services or scripts for debugging purposes.

- **Start long-running services** (keeps a container alive for `exec` commands):
  ```bash
  docker-compose up -d
  ```

- **Run a single script inside the container**:
  ```bash
  docker-compose run --rm scraper-daily node scrape_articles_dawn.js --fromDate 2025-10-21
  ```

- **Force re-cleaning of a data source**:
  ```bash
  docker-compose run --rm data-cleaner --force dawn
  ```

### Help Script

For a full list of available `pnpm` scripts and their descriptions, run:
```bash
pnpm help
```

## Project Structure

- `docker-compose.yml`: Defines the long-running services.
- `docker-compose.pipeline.yml`: Defines the sequential, task-based pipeline.
- `entrypoint.sh`: The main script for the scraping service.
- `data_cleaner/`: Contains the Python cleaning script and its own Dockerfile.
- `scripts/`: Contains helper and utility scripts, including `help.js`.
- `data/`: The output directory for all raw and transformed data.
- `documentation/`: Contains detailed developer notes and requirements.

## License

This project is licensed under the MIT License.

## Support

For issues or questions:
1.  Run `pnpm help` for command documentation.
2.  View logs in `./logs/`.
3.  Check the detailed developer notes in the `documentation/` folder.
4.  Open a GitHub Issue with:
    -   Error message
    -   Command used
    -   Docker logs output
    -   System info (OS, Docker version)

---

**Note**: This scraper is for educational and research purposes. Please respect the target websites' terms of service and robots.txt. Always scrape responsibly and ethically.


