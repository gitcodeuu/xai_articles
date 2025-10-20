# AI Agent Instructions for `xai_articles`

This document provides guidance for AI coding agents working in the `xai_articles` repository.

## Project Overview

This is a Node.js project that uses the `puppeteer` library. The primary purpose is likely related to web scraping, browser automation, or generating content from web pages.

## Key Technologies

- **Node.js**: The runtime environment.
- **Puppeteer**: A Node library which provides a high-level API to control Chrome or Chromium over the DevTools Protocol.

## Common Patterns

Since there is no existing application code, here is a basic example of a Puppeteer script that you might be asked to create or modify.

```javascript
const puppeteer = require('puppeteer')

async function getPageTitle(url) {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto(url)
  const title = await page.title()
  await browser.close()
  return title
}

// Example usage:
// getPageTitle('https://www.google.com').then(title => {
//   console.log(title);
// });
```

When working with Puppeteer, remember to:

- Launch a browser instance.
- Open a new page.
- Navigate to a URL.
- Perform actions on the page (e.g., click, type, scrape data).
- Close the browser instance to clean up resources.

## Development Workflow

- **Dependencies**: Install dependencies using `npm install`.
- **Running scripts**: Run individual scripts using `node <script_name>.js`.

This is a starting point. As the project grows, please update these instructions with more specific architectural details, patterns, and workflows.
