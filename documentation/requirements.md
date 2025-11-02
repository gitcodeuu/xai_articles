# Project Requirements Specification: News Scraper & Cleaner

Last updated: 2025-11-02

## 1. Purpose

- To create a two-stage, containerized pipeline that:
  1.  Collects raw news articles from APP and Dawn.
  2.  Cleans, normalizes, and transforms the raw data into an enriched, structured format.
- The entire pipeline is orchestrated using Docker Compose for portability and reliability.

## 2. Environments and Dependencies

- **Runtime**: Docker with two primary services:
  - `scraper-daily`: A Node.js 22-based service for web scraping.
  - `data-cleaner`: A Python 3.9-based service for data transformation.
- **Package Manager**: pnpm for the Node.js service.
- **Core Libraries**:
  - **Node.js**: Puppeteer, fs-extra, dayjs.
  - **Python**: No external libraries required for the cleaner.

## 3. Data Directory Layout

- **Root**: `data/`
  - `app/`
    - `articles/YYYY/MM/DD/*.json` (Raw scraped data)
    - `transformed_articles/YYYY/MM/DD/*.json` (Cleaned data)
  - `dawn/`
    - `articles/YYYY/MM/DD/*.json` (Raw scraped data)
    - `transformed_articles/YYYY/MM/DD/*.json` (Cleaned data)
- **File Naming**: Filenames are preserved between the raw and transformed stages.

## 4. JSON Schemas

### Raw Article Schema (Input to Cleaner)
The raw schema is flexible but generally contains keys like `source`, `url`, `title`, `content`, etc.

### Transformed Article Schema (Final Output)
The `cleaner.py` script produces a standardized, enriched JSON object with the following structure:
```json
{
  "article_id": "string",
  "source_info": {
    "source_name": "string",
    "source_link": "string",
    "retrieved_at": "datetime"
  },
  "metadata": {
    "title": "string",
    "author": "string",
    "date_published": "string",
    "word_count": "integer",
    "reading_time_minutes": "integer"
  },
"content": {
    "article_body": "string (ASCII-safe)",
    "summary": "string (placeholder)",
    "keywords": ["string"]
  },
  "entities": {
    "people": [],
    "organizations": [],
    "locations": []
  }
}
```

## 5. Functional Requirements

- **Orchestration**: The `docker-compose.pipeline.yml` file defines the sequential execution of the pipeline.
- **Date Scoping**: The pipeline runs for a specific date, passed via the `DATE` environment variable, defaulting to the current date.
- **Steps**:
  1.  The `scraper-daily` service runs, scraping raw data into the `.../articles/` directories.
  2.  Upon successful completion, the `data-cleaner` service starts automatically.
  3.  The cleaner identifies new raw files, processes them, and saves the transformed output to the `.../transformed_articles/` directories.

## 6. Non-functional Requirements

- **Idempotence**: Re-running the pipeline for the same date will not duplicate data or re-process existing files.
- **Efficiency**: The cleaner uses a delta-check to only process files that have not yet been transformed.
- **Portability**: The use of Docker ensures the environment is consistent across different machines.

## 7. Operational Playbook

- **Build the images**: `docker-compose -f docker-compose.pipeline.yml build`
- **Run for the current day**: `docker-compose -f docker-compose.pipeline.yml up`
- **Run for a specific day**: `DATE=YYYY-MM-DD docker-compose -f docker-compose.pipeline.yml up`
- **Force re-cleaning a source**: `docker-compose run --rm data-cleaner --force dawn`