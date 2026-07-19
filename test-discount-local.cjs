#!/usr/bin/env node
/*
 * Local Discount login test harness.
 *
 * Reproduces the Home Assistant addon's headless environment so scraper
 * fixes can be iterated locally without rebuilding the addon.
 *
 * Usage:
 *   npm run build:js   # after any src/ change
 *   node test-discount-local.cjs            # headless, like the addon
 *   node test-discount-local.cjs --show     # headful, watch the browser
 *
 * Credentials are prompted interactively and never stored.
 * Artifacts on failure: ./discount-local-fail.png
 */
process.env.DEBUG = process.env.DEBUG || 'israeli-bank-scrapers:*';

const readline = require('readline');
const { createScraper, CompanyTypes } = require('./lib');

function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      let value = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const onData = (ch) => {
        const c = ch.toString();
        if (c === '\n' || c === '\r' || c === '') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value);
        } else if (c === '') {
          process.exit(1);
        } else if (c === '') {
          value = value.slice(0, -1);
        } else {
          value += c;
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const show = process.argv.includes('--show');
  const id = await prompt('Discount ID (תעודת זהות): ');
  const password = await prompt('Password (hidden): ', true);
  const num = await prompt('Identification code (קוד מזהה): ');

  // Use the system Chrome: the puppeteer-downloaded Chrome-for-Testing
  // extracts broken on this machine (missing Frameworks dir).
  const executablePath =
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  const scraper = createScraper({
    companyId: CompanyTypes.discount,
    startDate: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    showBrowser: show,
    verbose: true,
    timeout: 60000,
    executablePath,
    storeFailureScreenShotPath: `${__dirname}/discount-local-fail.png`,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  scraper.onProgress((companyId, payload) => {
    console.log(`[progress] ${companyId}: ${payload.type}`);
  });

  const result = await scraper.scrape({ id, password, num });

  if (result.success) {
    console.log('\n=== LOGIN + SCRAPE SUCCEEDED ===');
    for (const account of result.accounts || []) {
      console.log(`account ${account.accountNumber}: balance=${account.balance}, txns=${account.txns.length}`);
    }
  } else {
    console.log('\n=== FAILED ===');
    console.log('errorType:', result.errorType);
    console.log('errorMessage:', result.errorMessage);
    console.log('Screenshot (if login got that far): discount-local-fail.png');
  }
}

main().catch((e) => {
  console.error('harness crashed:', e);
  process.exit(1);
});
