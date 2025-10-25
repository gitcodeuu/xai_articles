# Project Requirements Specification: News Scraper

Last updated: 2025-10-25

## 1. Purpose

- To collect, normalize, and persist news articles from APP and Dawn.
- The entire pipeline runs in a containerized Docker environment.
- The final output is uploaded to Azure Blob Storage.

## 2. Environments and Dependencies

- **Runtime**: Docker with a Node.js 22 base image.
- **Package Manager**: pnpm.
- **Core Libraries**: Puppeteer, fs-extra, dayjs, @azure/storage-blob.

## 3. Data Directory Layout

- **Root**: `data/`
  - `app/`
    - `lists/YYYY/MM/DD/*.json`
    - `articles/YYYY/MM/DD/*.json`
  - `dawn/`
    - `lists/YYYY/MM/DD/*.json`
    - `articles/YYYY/MM/DD/*.json`
- **File Naming**: Filenames are derived from a unique ID or hash to ensure idempotence.

## 4. JSON Schema (Minimum Contract)

The schema remains the same, defining the structure for list and article JSON files.
- **Article**: `{ "source", "url", "id", "title", "content", ... }`
- **List**: `{ "source", "scope", "items": [...] }`

## 5. Functional Requirements

- **Orchestration**: The `entrypoint.sh` script executes the full scraping pipeline in sequence.
- **Date Scoping**: The pipeline runs for a specific date, passed via the `DATE` environment variable, defaulting to the current date.
- **Steps**:
  1.  Scrape Dawn lists and articles.
  2.  Scrape APP lists and articles.
  3.  Refetch any articles with null content.
  4.  Upload all scraped data for the target date to Azure Blob Storage.

## 6. Non-functional Requirements

- **Idempotence**: Re-running the pipeline for the same date will not duplicate data.
- **Resilience**: The pipeline should handle transient network errors gracefully (future enhancement).
- **Portability**: The use of Docker ensures the environment is consistent across different machines.

## 7. Operational Playbook

- **Build the image**: `docker-compose build`
- **Run for the current day**: `docker-compose run --rm scraper-daily`
- **Run for a specific day**: `docker-compose run --rm -e DATE=YYYY-MM-DD scraper-daily`