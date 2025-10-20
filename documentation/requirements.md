# Project Requirements Specification: News Scraper (APP and Dawn)

Last updated: 2025-10-19 19:09 local
Owner: app-scrapper

1. Purpose

- Collect, normalize, and persist news article data from two sources:
  - APP (app.com.pk)
  - Dawn (dawn.com/pakistan)
- Support repeatable and resumable scraping by lists (indexes) and articles.
- Organize output under data/<source>/ with YYYY/MM/DD partitioning.

2. In-scope

- CLI scripts for:
  - APP lists pagination and article extraction for single dates and ranges.
  - Dawn lists and article extraction for single dates and ranges.
  - End-to-end range orchestration for Dawn (lists then articles) in one run.
  - Maintenance scripts (null-content refetch, data migrations, validation).
- Headless scraping via Puppeteer (+ stealth plugin) with minimal detection.
- JSON output with stable schema and deterministic file paths.

3. Out-of-scope (current)

- Database ingestion or APIs; the system writes local JSON files only.
- NLP, de-duplication across sources, or advanced analytics.
- Full-blown job scheduler; executions are manual or via external cron.

4. Stakeholders

- Developers maintaining scrapers and data tools.
- Analysts consuming JSON data from the data directory.

5. Environments and Dependencies

- Node.js with pnpm package manager (see package.json packageManager).
- Puppeteer, puppeteer-extra, puppeteer-extra-plugin-stealth.
- fs-extra, minimist, dayjs.
- Run on Windows or cross-platform shells (examples use Windows paths).

6. Data Directory Layout

- Root: data/
  - app/
    - lists/YYYY/MM/DD/\*.json # List pages metadata or article IDs/URLs
    - articles/YYYY/MM/DD/\*.json # Article documents
  - dawn/
    - lists/YYYY/MM/DD/\*.json
    - articles/YYYY/MM/DD/\*.json
- File naming: ISO date prefix + unique id or hash to ensure idempotence, e.g. 2025-02-01_86aa5b2856cf8c18ad34c31115d32b57.json

7. JSON Schema (minimum contract)
   Article document (source-agnostic fields; sources may add extras):
   {
   "source": "app" | "dawn",
   "url": "https://...",
   "id": "stable unique id/hash for file mapping",
   "title": "string",
   "subtitle": "string|null",
   "author": "string|null",
   "publishedAt": "YYYY-MM-DDTHH:mm:ssZ|null",
   "date": "YYYY-MM-DD", // canonical partition date
   "content": "string|null", // null if fetch failed; non-empty string otherwise
   "categories": ["string"],
   "tags": ["string"],
   "images": [{ "url": "string", "caption": "string|null" }],
   "raw": { /_ optional source raw blocks for debugging _/ },
   "fetchedAt": "YYYY-MM-DDTHH:mm:ssZ",
   "retry": { "attempt": number, "max": number }
   }

List document (may vary by source but must include):
{
"source": "app" | "dawn",
"scope": { "date": "YYYY-MM-DD" | { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }, "page": number|null },
"items": [ { "url": "https://...", "id": "string", "title": "string|null" } ],
"fetchedAt": "YYYY-MM-DDTHH:mm:ssZ",
"meta": { "total": number|null, "page": number|null, "pages": number|null }
}

8. Functional Requirements
   8.1. APP Lists

- Provide commands for single page, latest page, and a range of pages.
- Persist list results under data/app/lists/YYYY/MM/DD.
- Ensure pages argument parsing supports e.g. 1-5.

  8.2. APP Articles

- Accept a single date (YYYY-MM-DD) or date ranges via --fromDate and --toDate.
- Retry mode re-fetches only failed or empty-content items by date or date range.
- Persist articles under data/app/articles/YYYY/MM/DD.

  8.3. Dawn Lists & Articles

- Require argument as a single day (YYYY-MM-DD) or a colon-separated range YYYY-MM-DD:YYYY-MM-DD.
- Run lists separately or call a combined range runner (lists then articles).
- Persist under data/dawn/... with same date partitioning.

  8.4. Maintenance

- data:refetch:nulls scans both sources for documents with content == null or content == "" and re-fetches with optional limit, concurrency, dry-run, and retry count.
- data:migrate moves/normalizes layout when folder shapes change and is safe to re-run.
- data:validate runs checks against expected schema fields and reports deviations.

9. Non-functional Requirements

- Idempotence: repeated runs for the same input should not duplicate data; filenames must be stable by URL/id and date.
- Resilience: transient failures (timeouts, blocked requests) retried with backoff.
- Performance: configurable concurrency where safe; avoid overloading sources (respect robots/ToS).
- Observability: console logs with progress, totals, and per-item errors; optional verbose mode.
- Portability: scripts runnable via Node on Windows; paths use \\ in examples.

10. CLI Contract (as exposed in package.json)

- help: node scripts\\help.js -> prints command reference.
- app:lists, app:lists:help, app:lists:latest, app:lists:page, app:lists:pages
- app:articles, app:articles:retry
- dawn:lists, dawn:articles, dawn:range
- data:migrate, data:validate
- data:refetch:nulls
- sre (internal dashboard helper)

11. Configuration and Environment

- Default headless browser (Puppeteer). Use stealth plugin to reduce bot detection.
- Optional env vars:
  - PUPPETEER_HEADLESS=true|false
  - HTTP_PROXY / HTTPS_PROXY if needed
  - SCRAPER_CONCURRENCY=<int>
  - SCRAPER_TIMEOUT_MS=<int> per navigation or content fetch
- Command-line overrides take precedence over env defaults where supported.

12. Error Handling and Retries

- Each item fetch has bounded retries with exponential backoff.
- Hard failures are logged and kept for retry scripts.
- Partial writes allowed: a document with content == null is valid and signals refetch pipeline.

13. Data Quality and Validation

- data:validate checks for missing required fields (source, url, id, date, fetchedAt) and reports counts.
- Lint for dates to be valid ISO strings and folders matching date partitions.

14. Security and Compliance

- Respect terms of service and robots.txt of sources. Throttle requests and avoid authenticated/private content.
- No personally identifiable information beyond the article page content is processed or stored.

15. Testing and Verification

- Dry-run modes to verify target counts and paths without writes.
- Spot-check a sample of stored JSON for field completeness and correct partitioning.
- Verify re-runs do not duplicate files for the same date+url.

16. Operational Playbook

- Bootstrap: pnpm i, then pnpm run help.
- For a given day range on Dawn: pnpm run dawn:range -- 2025-08-01:2025-08-07
- For APP daily articles: pnpm run app:articles -- 2025-08-11
- Periodically run: pnpm run data:refetch:nulls -- --dry to see pending refetches.

17. Acceptance Criteria

- All scripts in package.json execute without errors with help flags.
- Output directory structure and filenames adhere to the layout and schema.
- Re-running for same inputs does not duplicate data; retries work.
- Documentation exists under documentation/ with requirements and developer notes.

18. Future Enhancements (not required now)

- Cross-platform path utilities and Dockerized runtime.
- Structured logging and metrics.
- Pluggable source adapters with a common interface.
