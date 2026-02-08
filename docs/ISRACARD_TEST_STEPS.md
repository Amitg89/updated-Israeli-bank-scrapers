# Isracard scraper – how to test

## What was fixed

1. **Login UI change (PR #1004)**  
   The site now defaults to “Login via SMS”. The scraper:
   - Waits for the “Enter with password” link (`#flip`), clicks it, then waits for the password field (`#otpLoginPwd`) before calling the login API.

2. **Bot detection (PR #1027)**  
   - Delay after loading the login page (2s) and after flipping to the password panel (800ms).  
   - Random delays (2.5–3s) between API calls when fetching accounts/transactions.  
   - Blocking `detector-dom.min.js` and masking headless user agent.  
   - In `fetch.ts`, detection of 429 or “block automation” responses with a clear error.

## Test with dummy credentials (expect InvalidPassword)

From the project root:

```bash
# Install deps if needed
npm ci

# Run only the Isracard test that expects invalid login
npm test -- --testPathPattern=isracard --testNamePattern="invalid user"
```

- **Expected:** Test passes (or is skipped if `src/tests/.tests-config.js` is not set with `companyAPI.invalidPassword`).  
- If the test runs and uses dummy credentials, you should see `success: false` and `errorType: InvalidPassword` (wrong user/password), which means the login flow and API calls are working.

## Test with your real credentials

1. **Optional – see the browser:**  
   Use `showBrowser: true` in options so you can watch the flow and spot any captcha or extra steps.

2. **Run the scraper (e.g. in a small script):**

```ts
import { createScraper } from './src/scrapers/factory';
import { CompanyTypes } from './src/definitions';

const scraper = createScraper({
  companyId: CompanyTypes.isracard,
  showBrowser: true,  // set to false for headless
});

const result = await scraper.scrape({
  id: 'YOUR_ID',
  password: 'YOUR_PASSWORD',
  card6Digits: 'LAST_6_DIGITS_OF_CARD',
});

console.log(result);
```

Or run the full Isracard test suite (requires `src/tests/.tests-config.js` with real `credentials.isracard`):

```bash
npm test -- --testPathPattern=isracard
```

3. **If it still fails:**  
   - Enable debug: `DEBUG=israeli-bank-scrapers:base-isracard-amex npm test -- ...`  
   - Check the thrown error message: it now includes the raw validation response when validation fails (e.g. bot block or unexpected payload).  
   - Try with `showBrowser: true` and/or slightly longer delays in `base-isracard-amex.ts` (e.g. `LOGIN_PAGE_SETTLE_MS` or `RATE_LIMIT.SLEEP_BETWEEN`).

## Summary of code changes

- **`src/scrapers/base-isracard-amex.ts`**  
  - Click “Enter with password” (`#flip`), wait for `#otpLoginPwd`, add delays, use `randomDelay` between fetches, clearer validation error.  
- **`src/helpers/waiting.ts`**  
  - Added `randomDelay(minMs, maxMs)`.  
- **`src/helpers/fetch.ts`**  
  - `assertAutomationNotBlocked()` and returning status from `fetchPostWithinPage` so bot-block responses (429 or “block automation”) throw a clear error.
