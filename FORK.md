# About This Fork

This repository is a **community fork** of [**israeli-bank-scrapers**](https://github.com/eshaham/israeli-bank-scrapers) by **Eran Shaham** ([@eshaham](https://github.com/eshaham)). It is maintained to ship fixes that are not yet merged upstream, so that projects like [Israeli Bank Firefly III Importer (Security Enhanced)](https://github.com/Amitg89/israeli-bank-firefly-importer-security-enhanced) can keep working when bank sites or anti-bot behavior change.

**Original project:** [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers)  
**License:** MIT (unchanged; see [LICENSE](LICENSE)).

---

## Attribution

All scraping logic, bank support, and core library are from the **original israeli-bank-scrapers** project by Eran Shaham. This fork only adds patches and fixes on top of that codebase. Full credit for the project goes to the original author and contributors.

---

## Changes in This Fork

### Isracard login fix (current)

Isracard’s login page and anti-bot behavior changed. The upstream scraper could no longer log in. This fork includes fixes so Isracard (and Amex, which shares the same base) work again.

1. **Login UI (from PR #1004)**  
   The site now defaults to “Login via SMS.” The scraper:
   - Waits for the “Enter with password” link (`#flip`), clicks it, then waits for the password field (`#otpLoginPwd`) before calling the login API.

2. **Bot detection / stability (from PR #1027)**  
   - Delay after loading the login page and after switching to the password panel.  
   - Random delays between API calls when fetching accounts/transactions.  
   - Blocking `detector-dom.min.js` and masking headless user agent.  
   - In `fetch.ts`, detection of 429 or “block automation” responses with a clear error.

3. **Error handling**  
   - Validation/parse failures (e.g. invalid credentials or non-JSON response) now return **InvalidPassword** instead of a generic error, so callers get a clear “wrong credentials” result.  
   - Automation-block errors are still thrown with a clear message.

**Files touched:**  
- `src/scrapers/base-isracard-amex.ts` – flip flow, delays, error handling  
- `src/helpers/waiting.ts` – `randomDelay()`  
- `src/helpers/fetch.ts` – `assertAutomationNotBlocked`, status handling in `fetchPostWithinPage`  
- `docs/ISRACARD_TEST_STEPS.md` – how to test Isracard

---

## How to Use This Fork

**From GitHub (e.g. in `package.json`):**

```json
"dependencies": {
  "israeli-bank-scrapers": "github:Amitg89/updated-Israeli-bank-scrapers#main"
}
```

For a fixed version, use a tag (e.g. after creating `v1.0.4-isracard-fix`):

```json
"israeli-bank-scrapers": "github:Amitg89/updated-Israeli-bank-scrapers#v1.0.4-isracard-fix"
```

**From npm:**  
This fork is not published to npm. Use the `github:` dependency above, or clone and link locally.

---

## Maintenance Plan

- **Goal:** Keep the fork usable when Israeli bank/credit card sites or anti-bot logic change, until fixes are merged upstream.
- **Strategy:**  
  - Rebase or merge from [eshaham/israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) periodically to get upstream updates.  
  - Re-apply or adapt our patches after each sync if they are not yet in upstream.  
  - When upstream merges equivalent fixes (e.g. the Isracard PRs), we will drop our patches and recommend switching back to the official package.
- **Scope:** Only targeted fixes (e.g. Isracard/Amex login); no broad rewrites.  
- **Issues/PRs:** Prefer reporting bugs and submitting PRs to the [original repo](https://github.com/eshaham/israeli-bank-scrapers) when relevant; use this fork for discussion specific to this fork’s patches.

---

## Testing Isracard

See [docs/ISRACARD_TEST_STEPS.md](docs/ISRACARD_TEST_STEPS.md) for how to run tests with dummy credentials and with real credentials.
