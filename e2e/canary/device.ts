import { devices, type BrowserContextOptions } from '@playwright/test';

// One iPhone-sized Chromium profile for the canary: the iPhone 17 viewport,
// pixel ratio and touch input, with Chromium's own user agent. The canary
// checks the backend, not the browser engine (the WebKit suite covers that).
const iPhone17 = devices['iPhone 17'];

export const CANARY_PORT = 4193;
export const CANARY_BASE_URL = `http://127.0.0.1:${CANARY_PORT}`;

export const canaryDevice: BrowserContextOptions = {
  viewport: iPhone17.viewport,
  deviceScaleFactor: iPhone17.deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
};
