import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import capacitorConfig from '../../capacitor.config.ts';

// The web shell iOS loads (NFCT-33): zoom stays available and the fonts ship
// with the app (index.html, src/styles/fonts.css, public/fonts). e2e/iphone-forms.auth-handoffs.local.spec.ts checks the same
// in WebKit and Chromium at runtime; this catches a slip without a browser.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const indexHtml = read('index.html');
const fontsCss = read('src/styles/fonts.css');

describe('iPhone web shell', () => {
  it('lets the user pinch-zoom and draws under the notch and home indicator', () => {
    const viewport = indexHtml.match(/<meta name="viewport" content="([^"]+)"/)?.[1];
    expect(viewport).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
    // Capacitor's iOS web view refuses to zoom unless the app turns it on.
    expect(capacitorConfig.ios?.zoomEnabled).toBe(true);
  });

  it('loads every font from the app bundle, never from a third party', () => {
    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(read('src/styles/index.css')).toMatch(/^@import '\.\/fonts\.css';$/m);
    for (const family of ['DM Sans', 'DM Serif Display', 'JetBrains Mono']) {
      expect(fontsCss).toContain(`font-family: '${family}';`);
    }
    const files = [...fontsCss.matchAll(/src: url\('([^']+)'\) format\('woff2'\);/g)].map(([, url]) => url);
    expect(files).toHaveLength(fontsCss.match(/@font-face/g)?.length ?? -1);
    for (const file of files) {
      expect(file).toMatch(/^\/fonts\/[a-z-]+\.woff2$/);
      expect(existsSync(`${root}public${file}`), file).toBe(true);
    }
    // The body text's file is preloaded, and it is one of the declared files.
    const preload = indexHtml.match(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin \/>/)?.[1];
    expect(files).toContain(preload);
  });

  it('ships the Open Font License beside the fonts', () => {
    for (const licence of ['OFL-DMSans.txt', 'OFL-DMSerifDisplay.txt', 'OFL-JetBrainsMono.txt']) {
      expect(read(`public/fonts/${licence}`)).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});
