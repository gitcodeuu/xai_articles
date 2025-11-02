const fs = require('fs');
const path = require('path');

/**
 * Reads the package.json file and displays a formatted help message
 * with all available pnpm scripts, categorized for clarity.
 */
function showHelp() {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const { scripts } = packageJson;

    if (!scripts) {
      console.log('No scripts found in package.json');
      return;
    }

    const categories = {
      'Primary Workflow': ['pipeline:run', 'pipeline:run:date'],
      'Docker Utilities': ['docker:build', 'docker:up', 'docker:down', 'docker:verify'],
      'Manual Data Tasks': ['data:clean', 'data:clean:force:app', 'data:clean:force:dawn', 'data:refetch:nulls'],
      'Individual Scrapers': ['app:lists:latest', 'app:articles', 'dawn:lists', 'dawn:articles'],
      'General & Deprecated': ['help', 'verify:data', 'docker:check', 'azure:upload', 'clear-cache'],
    };

    const getScriptDescription = (key) => {
        const descriptions = {
            'pipeline:run': 'Runs the full scraping and cleaning pipeline for the current date.',
            'pipeline:run:date': 'Runs the full pipeline for a specific date. Usage: pnpm pipeline:run:date --date=YYYY-MM-DD',
            'docker:build': 'Builds or rebuilds the Docker images.',
            'docker:up': 'Starts the long-running services (e.g., scraper) in Docker Compose.',
            'docker:down': 'Stops all running Docker Compose services.',
            'docker:verify': 'Runs the data verification script inside the Docker container.',
            'data:clean': 'Runs the Python data cleaning script on all sources.',
            'data:clean:force:app': "Forces reprocessing of the 'app' source.",
            'data:clean:force:dawn': "Forces reprocessing of the 'dawn' source.",
            'data:refetch:nulls': 'Refetches articles that have null content.',
            'app:lists:latest': 'Scrapes the latest article list from APP.',
            'app:articles': 'Scrapes full articles from APP.',

            'dawn:lists': 'Scrapes article lists from Dawn.',
            'dawn:articles': 'Scrapes full articles from Dawn.',
            'help': 'Shows this help message.',
            'verify:data': 'Verifies the structure of the scraped data files.',
            'docker:check': 'Checks if Docker is running.',
            'azure:upload': '[DEPRECATED] This is now handled by a separate process.',
            'clear-cache': 'Clears the Puppeteer browser cache.',
        };
        return descriptions[key] || '';
    };

    console.log(`
==================================================
 XAI Articles Scraper - Available Scripts
==================================================

Run any script using 'pnpm <script_name>'.
The primary workflow is managed via Docker Compose.

`);

    for (const category in categories) {
      console.log(`--------------------------------------------------`);
      console.log(` ${category}`);
      console.log(`--------------------------------------------------`);
      categories[category].forEach(key => {
        if (scripts[key]) {
          console.log(`  - pnpm ${key}`);
          console.log(`    └─ ${getScriptDescription(key)}`);
        }
      });
      console.log('');
    }

  } catch (error) {
    console.error('Error reading package.json or displaying help:', error);
  }
}

// Execute the function if the script is run directly
if (require.main === module) {
  showHelp();
}

module.exports = showHelp;