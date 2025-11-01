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
      'General & Verification': ['help', 'verify:data', 'docker:check'],
      'Docker Workflow': ['docker:build', 'docker:up', 'docker:down', 'docker:verify'],
      'APP Scraper': ['app:lists:help', 'app:lists:latest', 'app:articles', 'app:articles:retry'],
      'Dawn Scraper': ['dawn:lists', 'dawn:articles', 'dawn:range'],
      'Data Utilities': ['data:clean', 'data:clean:force:app', 'data:clean:force:dawn', 'data:refetch:nulls', 'data:migrate', 'azure:upload', 'clear-cache'],
      'Development': ['fix-conflicts'],
    };

    const getScriptDescription = (key) => {
        const descriptions = {
            'help': 'Shows this help message.',
            'verify:data': 'Verifies the structure of the scraped data files.',
            'docker:check': 'Checks if Docker is running.',
            'docker:build': 'Builds the Docker images for the scraper.',
            'docker:up': 'Starts the services in Docker Compose.',
            'docker:down': 'Stops the services in Docker Compose.',
            'docker:verify': 'Runs the data verification script inside the Docker container.',
            'app:lists:help': 'Shows help for the APP list scraper.',
            'app:lists:latest': 'Scrapes the latest article list from APP.',
            'app:articles': 'Scrapes full articles from APP.',
            'app:articles:retry': 'Retries scraping failed APP articles.',
            'dawn:lists': 'Scrapes article lists from Dawn.',
            'dawn:articles': 'Scrapes full articles from Dawn.',
            'dawn:range': 'Runs the full Dawn scraping pipeline for a date range.',
            'data:clean': 'Runs the Python data cleaning and transformation script.',
            'data:clean:force:app': "Forces reprocessing of the 'app' source.",
            'data:clean:force:dawn': "Forces reprocessing of the 'dawn' source.",
            'data:refetch:nulls': 'Refetches articles that have null content.',
            'data:migrate': 'Migrates data from an old format to a new one.',
            'azure:upload': 'Uploads scraped data to Azure Blob Storage.',
            'clear-cache': 'Clears the Puppeteer browser cache.',
            'fix-conflicts': 'Helps resolve git merge conflicts in JSON files.'
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