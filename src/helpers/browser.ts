import { type Page } from 'puppeteer';

export async function maskHeadlessUserAgent(page: Page): Promise<void> {
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await page.setUserAgent(userAgent.replace('HeadlessChrome/', 'Chrome/'));
}

/**
 * Neutralises the JS-visible "this is an automated/headless Linux browser"
 * signals that survive a user-agent spoof. Registered via
 * evaluateOnNewDocument so it also applies to the post-login SPA document
 * (where sites like Discount's Telebank run their bot checks). Intended for
 * headless container environments (e.g. the Home Assistant addon on Alpine
 * Chromium) where the browser build is otherwise a strong bot tell.
 *
 * Values are made consistent with the Windows-Chrome identity spoof applied
 * alongside it (navigator.platform = Win32, real-looking WebGL GPU strings).
 */
export async function applyStealth(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    // Automation flag.
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Platform/languages consistent with the spoofed Windows Hebrew locale.
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['he-IL', 'he', 'en-US', 'en'],
    });

    // Headless Chromium exposes an empty plugin list; real Chrome does not.
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5].map(i => ({ name: `Plugin ${i}`, filename: `plugin-${i}` })),
    });

    // window.chrome is present in real Chrome, absent in headless.
    const w = window as unknown as { chrome?: unknown };
    if (!w.chrome) {
      w.chrome = { runtime: {} };
    }

    // Notification permission inconsistency (headless reports "denied").
    const permissions = window.navigator.permissions as unknown as {
      query: (p: { name: string }) => Promise<unknown>;
    };
    const originalQuery = permissions.query.bind(permissions);
    permissions.query = (parameters: { name: string }) =>
      parameters && parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // WebGL vendor/renderer: headless/Alpine reports SwiftShader/Mesa, a tell.
    // Report a plausible real GPU instead (UNMASKED_VENDOR/RENDERER = 37445/37446).
    const spoofWebGL = (proto: { getParameter: (p: number) => unknown }) => {
      const original = proto.getParameter;
      // eslint-disable-next-line no-param-reassign
      proto.getParameter = function getParameter(parameter: number) {
        if (parameter === 37445) return 'Google Inc. (Intel)';
        if (parameter === 37446) {
          return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
        }
        return original.call(this, parameter);
      };
    };
    if (typeof WebGLRenderingContext !== 'undefined') {
      spoofWebGL(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      spoofWebGL(WebGL2RenderingContext.prototype);
    }
  });
}

/**
 * Priorities for request interception. The higher the number, the higher the priority.
 * We want to let others to have the ability to override our interception logic therefore we hardcode them.
 */
export const interceptionPriorities = {
  abort: 1000,
  continue: 10,
};
