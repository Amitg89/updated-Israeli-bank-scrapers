import fs from 'fs';
import path from 'path';
import moment from 'moment';
import { type ConsoleMessage, type HTTPRequest, type HTTPResponse, type Page } from 'puppeteer';
import { applyStealth, maskHeadlessUserAgent } from '../helpers/browser';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchGetWithinPage } from '../helpers/fetch';
import { waitForNavigation } from '../helpers/navigation';
import { getRawTransaction } from '../helpers/transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';

const BASE_URL = 'https://start.telebank.co.il';
const DATE_FORMAT = 'YYYYMMDD';

interface ScrapedTransaction {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

interface CurrentAccountInfo {
  AccountBalance: number;
}

interface ScrapedAccountData {
  UserAccountsData: {
    DefaultAccountNumber: string;
    UserAccounts: Array<{
      NewAccountInfo: {
        AccountID: string;
      };
    }>;
  };
}

interface ScrapedTransactionData {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: ScrapedTransaction[];
    CurrentAccountInfo: CurrentAccountInfo;
    FutureTransactionsBlock?: {
      FutureTransactionEntry: ScrapedTransaction[];
    };
  };
}

function convertTransactions(
  txns: ScrapedTransaction[],
  txnStatus: TransactionStatuses,
  options?: ScraperOptions,
): Transaction[] {
  if (!txns) {
    return [];
  }
  return txns.map(txn => {
    const result: Transaction = {
      type: TransactionTypes.Normal,
      identifier: txn.OperationNumber,
      date: moment(txn.OperationDate, DATE_FORMAT).toISOString(),
      processedDate: moment(txn.ValueDate, DATE_FORMAT).toISOString(),
      originalAmount: txn.OperationAmount,
      originalCurrency: 'ILS',
      chargedAmount: txn.OperationAmount,
      description: txn.OperationDescriptionToDisplay,
      status: txnStatus,
    };

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(txn);
    }

    return result;
  });
}

async function fetchAccountData(page: Page, options: ScraperOptions): Promise<ScraperScrapingResult> {
  const apiSiteUrl = `${BASE_URL}/Titan/gatewayAPI`;

  const accountDataUrl = `${apiSiteUrl}/userAccountsData`;
  const accountInfo = await fetchGetWithinPage<ScrapedAccountData>(page, accountDataUrl);

  if (!accountInfo) {
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'failed to get account data',
    };
  }

  const defaultStartMoment = moment().subtract(1, 'years').add(2, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);

  const accounts: string[] = accountInfo.UserAccountsData.UserAccounts.map(acc => acc.NewAccountInfo.AccountID);
  const accountsData: Array<{ accountNumber: string; balance: number; txns: Transaction[] }> = [];

  for (const accountNumber of accounts) {
    const txnsUrl = `${apiSiteUrl}/lastTransactions/${accountNumber}/Date?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${startDateStr}`;
    const txnsResult = await fetchGetWithinPage<ScrapedTransactionData>(page, txnsUrl);
    if (!txnsResult || txnsResult.Error || !txnsResult.CurrentAccountLastTransactions) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: txnsResult && txnsResult.Error ? txnsResult.Error.MsgText : 'unknown error',
      };
    }

    const accountCompletedTxns = convertTransactions(
      txnsResult.CurrentAccountLastTransactions.OperationEntry,
      TransactionStatuses.Completed,
      options,
    );
    const rawFutureTxns =
      txnsResult.CurrentAccountLastTransactions.FutureTransactionsBlock?.FutureTransactionEntry ?? [];
    const accountPendingTxns = convertTransactions(rawFutureTxns, TransactionStatuses.Pending, options);

    accountsData.push({
      accountNumber,
      balance: txnsResult.CurrentAccountLastTransactions.CurrentAccountInfo.AccountBalance,
      txns: [...accountCompletedTxns, ...accountPendingTxns],
    });
  }

  const accountData = {
    success: true,
    accounts: accountsData,
  };

  return accountData;
}

// Timeout for the post-login SPA to route away from its loader screen.
const POST_LOGIN_TIMEOUT_MS = 60_000;

/**
 * Optional debug capture: a "filmstrip" of screenshots through the post-login
 * wait plus console/pageerror/network logs, so we can see WHY the SPA hangs
 * (e.g. a blocked API response or a JS error) instead of only a final
 * spinner screenshot. Enabled automatically when storeFailureScreenShotPath
 * is set; artifacts land in that file's directory. Never affects normal runs.
 */
interface DiagCapture {
  lines: string[];
  dir: string;
  snapshot: (label: string) => Promise<void>;
  dump: () => void;
}

function debugDirFrom(options: unknown): string | undefined {
  const p = (options as { storeFailureScreenShotPath?: string })?.storeFailureScreenShotPath;
  return p ? path.dirname(p) : undefined;
}

function createDiagCapture(page: Page, dir: string): DiagCapture {
  const lines: string[] = [];
  const at = () => new Date().toISOString();

  page.on('console', (msg: ConsoleMessage) => lines.push(`[${at()}] console:${msg.type()} ${msg.text()}`));
  page.on('pageerror', (err: unknown) => lines.push(`[${at()}] pageerror ${(err as Error)?.message ?? String(err)}`));
  page.on('requestfailed', (req: HTTPRequest) =>
    lines.push(`[${at()}] requestfailed ${req.url()} :: ${req.failure()?.errorText ?? ''}`),
  );
  page.on('response', (res: HTTPResponse) => {
    const url = res.url();
    if (url.includes('telebank') || url.includes('gatewayAPI') || url.includes('Titan')) {
      lines.push(`[${at()}] response ${res.status()} ${url}`);
    }
  });

  return {
    lines,
    dir,
    async snapshot(label: string) {
      try {
        await page.screenshot({ path: path.join(dir, `discount-${label}.png`), fullPage: true });
      } catch (e) {
        // Screenshots can fail mid-navigation; ignore.
      }
    },
    dump() {
      try {
        fs.writeFileSync(path.join(dir, 'discount-debug.log'), lines.join('\n'), 'utf8');
      } catch (e) {
        // Best-effort.
      }
    },
  };
}

/**
 * After submitting the login form the site shows an SPA loader for a while
 * before hash-routing to MY_ACCOUNT_HOMEPAGE. A plain waitForNavigation can
 * resolve (or time out) while the loader is still up, so poll until the URL
 * reaches a known post-login state or an inline error label appears; on
 * timeout we fall through and let the URL check classify the result.
 */
async function waitForPostLoginOutcome(page: Page, timeout = POST_LOGIN_TIMEOUT_MS, diag?: DiagCapture) {
  try {
    await waitForNavigation(page);
  } catch (e) {
    // Hash-routing SPAs don't always emit a navigation event; ignore.
  }

  const deadline = Date.now() + timeout;
  const pollMs = diag ? 1500 : 250;
  let frame = 0;
  while (Date.now() < deadline) {
    const done = await page
      .evaluate(
        () =>
          window.location.href.includes('MY_ACCOUNT_HOMEPAGE') ||
          window.location.hash.includes('PWD_RENEW') ||
          !!document.querySelector('#general-error'),
      )
      .catch(() => false);
    if (diag && frame < 30) {
      diag.lines.push(`[${new Date().toISOString()}] url ${page.url()}`);
      // eslint-disable-next-line no-await-in-loop
      await diag.snapshot(`frame-${String(frame).padStart(3, '0')}`);
      frame += 1;
    }
    if (done) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => {
      setTimeout(resolve, pollMs);
    });
  }

  if (diag) {
    diag.lines.push(`[${new Date().toISOString()}] final url ${page.url()}`);
    diag.dump();
  }
}

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    `${BASE_URL}/apollo/retail/#/MY_ACCOUNT_HOMEPAGE`,
    `${BASE_URL}/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE`,
    `${BASE_URL}/apollo/retail2/`,
    `${BASE_URL}/apollo/retail3/#/MY_ACCOUNT_HOMEPAGE`,
    `${BASE_URL}/apollo/retail3/`,
  ];
  urls[LoginResults.InvalidPassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE`];
  urls[LoginResults.ChangePassword] = [`${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW`];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#tzId', value: credentials.id },
    { selector: '#tzPassword', value: credentials.password },
    { selector: '#aidnum', value: credentials.num },
  ];
}

type ScraperSpecificCredentials = { id: string; password: string; num: string };

class DiscountScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private diag?: DiagCapture;

  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${BASE_URL}/login/#/LOGIN_PAGE`,
      checkReadiness: async () => waitUntilElementFound(this.page, '#tzId'),
      // The site's bot detection stalls the post-login SPA loader forever for
      // headless/Linux browser fingerprints (the addon runs Alpine Chromium).
      // Present a full Windows-Chrome identity: UA string, client hints
      // (Sec-CH-UA-Platform betrays the real OS otherwise) and Hebrew locale.
      preAction: async () => {
        // Optional debug capture (filmstrip + console/network log) when a
        // failure-screenshot path is configured.
        const debugDir = debugDirFrom(this.options);
        if (debugDir) {
          this.diag = createDiagCapture(this.page, debugDir);
          await this.diag.snapshot('login-page');
        }
        // Hide headless/Linux JS fingerprints (applies to the post-login SPA too).
        await applyStealth(this.page);
        await maskHeadlessUserAgent(this.page);
        const userAgent = await this.page.evaluate(() => navigator.userAgent);
        const chromeMajor = (/Chrome\/(\d+)/.exec(userAgent) || [])[1] || '140';
        const windowsUserAgent = userAgent
          .replace(/\([^)]*\)/, '(Windows NT 10.0; Win64; x64)')
          .replace('HeadlessChrome/', 'Chrome/');
        await this.page.setUserAgent(windowsUserAgent, {
          brands: [
            { brand: 'Chromium', version: chromeMajor },
            { brand: 'Google Chrome', version: chromeMajor },
            { brand: 'Not_A Brand', version: '24' },
          ],
          fullVersion: `${chromeMajor}.0.0.0`,
          platform: 'Windows',
          platformVersion: '10.0.0',
          architecture: 'x86',
          model: '',
          mobile: false,
        });
        await this.page.setExtraHTTPHeaders({
          'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
        });
      },
      fields: createLoginFields(credentials),
      submitButtonSelector: '.sendBtn',
      postAction: async () =>
        waitForPostLoginOutcome(this.page, 'timeout' in this.options ? this.options.timeout : undefined, this.diag),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.options);
  }
}

export default DiscountScraper;
