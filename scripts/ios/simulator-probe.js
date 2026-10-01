// iOS Simulator page agent (NFCT-30, NFCT-31, NFCT-39).
//
// scripts/ios/simulator-smoke.mjs adds this file to the synced emulator web
// bundle of a Debug build, only for the Simulator scenarios. It is never part
// of the product or of a production bundle: `inject` refuses any other
// bundle, and `verify:ios-release` and the Release guard refuse this one.
//
// It is the in-app half of a small driver. The host
// (scripts/ios/simulator-driver.mjs) decides every step and sends commands
// over HTTP on the Simulator's loopback, the way the app reaches the local
// emulators. This file only finds elements the way a user would (by role and
// accessible name, text or placeholder), checks that a user could actually
// tap them, then taps, fills, waits or reads. It never calls app code. It also
// reports the page's environment and uncaught errors through console.log,
// which Capacitor forwards to the app's stdout in Debug builds.
(() => {
  const HOST = 'http://127.0.0.1:8735';
  const FAST_POLL_MS = 50;
  const report = (event, detail = {}) => console.log(`[nfct-smoke] ${JSON.stringify({ event, ...detail })}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const launch = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  window.addEventListener('error', (event) => report('uncaught-error', { message: String(event.message), source: event.filename }));
  window.addEventListener('unhandledrejection', (event) => report('unhandled-rejection', { message: String(event.reason?.message ?? event.reason) }));

  // ---- Finding elements, as a user (or Playwright's getByRole) would ----

  const ROLES = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"]',
    link: 'a[href], [role="link"]',
    heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
    textbox: 'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"], textarea, [role="textbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    group: '[role="group"], fieldset',
    dialog: 'dialog, [role="dialog"], [role="alertdialog"]',
    alert: '[role="alert"]',
    status: '[role="status"]',
  };

  function accessibleName(element) {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) return normalize(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    const label = element.getAttribute('aria-label');
    if (label) return normalize(label);
    if (element.matches('input[type="button"], input[type="submit"]')) return normalize(element.value);
    if (element.matches('input, textarea, select')) {
      const forLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
      const wrapping = forLabel ?? element.closest('label');
      return normalize(wrapping?.textContent) || normalize(element.getAttribute('placeholder')) || normalize(element.getAttribute('title'));
    }
    if (element.matches('fieldset')) return normalize(element.querySelector('legend')?.textContent);
    return normalize(element.textContent) || normalize(element.getAttribute('title'));
  }

  const matchesText = (actual, expected, exact = true) => (exact ? actual === normalize(expected) : actual.includes(normalize(expected)));

  /** The deepest elements whose text is (or, not exact, contains) `text`. */
  function byText(root, text, exact) {
    const scope = root === document ? document.body : root;
    const hits = [...scope.querySelectorAll('*')].filter((element) => !['SCRIPT', 'STYLE'].includes(element.tagName)
      && matchesText(normalize(element.textContent), text, exact));
    return hits.filter((element) => !hits.some((other) => other !== element && element.contains(other)));
  }

  /** Every element the target describes, visible or not. */
  function find(target, scope = document) {
    const roots = target.within ? find(target.within, scope).filter(isVisible) : [scope];
    const found = [];
    for (const root of roots) {
      let candidates;
      if (target.css) candidates = [...root.querySelectorAll(target.css)];
      else if (target.role) candidates = [...root.querySelectorAll(ROLES[target.role] ?? `[role="${target.role}"]`)];
      else if (target.placeholder !== undefined) {
        candidates = [...root.querySelectorAll('[placeholder]')]
          .filter((element) => matchesText(normalize(element.getAttribute('placeholder')), target.placeholder, target.exact));
      } else if (target.text !== undefined) candidates = byText(root, target.text, target.exact);
      else throw new Error('A target needs css, role, placeholder or text.');
      if (target.name !== undefined) candidates = candidates.filter((element) => matchesText(accessibleName(element), target.name, target.exact));
      if (target.hasText !== undefined) candidates = candidates.filter((element) => normalize(element.textContent).includes(normalize(target.hasText)));
      found.push(...candidates);
    }
    return [...new Set(found)];
  }

  function isVisible(element) {
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const isEnabled = (element) => !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true';

  function describe(element) {
    if (!element) return 'nothing';
    const id = element.id ? `#${element.id}` : '';
    const classes = typeof element.className === 'string' && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = normalize(element.textContent).slice(0, 40);
    return `<${element.tagName.toLowerCase()}${id}${classes}>${text ? ` "${text}"` : ''}`;
  }

  function describeTarget(target) {
    const base = target.css ? `css ${target.css}`
      : target.role ? `${target.role}${target.name !== undefined ? ` "${target.name}"` : ''}`
        : target.placeholder !== undefined ? `placeholder "${target.placeholder}"` : `text "${target.text}"`;
    return target.within ? `${base} in ${describeTarget(target.within)}` : base;
  }

  /** Exactly one visible element, or the reason there is not. */
  function single(target) {
    const visible = find(target).filter(isVisible);
    if (target.nth !== undefined) {
      return visible[target.nth] ? { element: visible[target.nth] } : { reason: `no visible ${describeTarget(target)} #${target.nth}` };
    }
    if (visible.length === 1) return { element: visible[0] };
    return { reason: visible.length === 0 ? `no visible ${describeTarget(target)}` : `${visible.length} visible matches for ${describeTarget(target)}` };
  }

  // ---- Could a user tap it? ----

  /** A visually hidden radio or checkbox is tapped through its label. */
  const tapTarget = (element) => (element.matches('input[type="radio"], input[type="checkbox"]') && element.closest('label')) || element;

  function visibleScreen() {
    const viewport = window.visualViewport;
    return viewport
      ? { left: viewport.offsetLeft, top: viewport.offsetTop, right: viewport.offsetLeft + viewport.width, bottom: viewport.offsetTop + viewport.height }
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  /**
   * The element's centre must be inside the visual viewport, and the topmost
   * element there must be the element or inside it. Anything covering it (an
   * overlay, a sticky bar, a clipping container) fails the tap instead of
   * being clicked through. One scroll into view is allowed, as a user would.
   */
  function hitTest(element, allowScroll) {
    const target = tapTarget(element);
    const centre = () => {
      const rect = target.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    };
    const inside = ({ x, y }) => {
      const screen = visibleScreen();
      return x >= screen.left && x < screen.right && y >= screen.top && y < screen.bottom;
    };
    let point = centre();
    let scrolled = false;
    if (!inside(point) && allowScroll) {
      target.scrollIntoView({ block: 'center', inline: 'center' });
      scrolled = true;
      point = centre();
    }
    if (!inside(point)) return { reason: `${describe(target)} is outside the visible screen at (${point.x}, ${point.y})`, scrolled };
    const top = document.elementFromPoint(point.x, point.y);
    if (!top || !(top === target || target.contains(top))) {
      return { reason: `${describe(target)} is covered by ${describe(top)} at (${point.x}, ${point.y})`, scrolled };
    }
    return { top, target, point, scrolled };
  }

  /** The DOM events a finger tap produces in WKWebView, at the hit point. */
  function dispatchTap({ top, point }) {
    const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: point.x, clientY: point.y, screenX: point.x, screenY: point.y };
    const pointer = { ...base, pointerId: 1, pointerType: 'touch', isPrimary: true, width: 1, height: 1, pressure: 0.5 };
    const fire = (create) => {
      try {
        return top.dispatchEvent(create());
      } catch {
        return true; // An event type this WebKit cannot construct.
      }
    };
    let touch = null;
    try {
      touch = new Touch({ identifier: Date.now(), target: top, clientX: point.x, clientY: point.y, screenX: point.x, screenY: point.y, pageX: point.x + window.scrollX, pageY: point.y + window.scrollY });
    } catch {
      touch = null;
    }
    fire(() => new PointerEvent('pointerdown', pointer));
    if (touch) fire(() => new TouchEvent('touchstart', { ...base, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    fire(() => new PointerEvent('pointerup', { ...pointer, pressure: 0 }));
    // A cancelled touchend stops the compatibility mouse events and the click, as in a browser.
    const proceed = touch ? fire(() => new TouchEvent('touchend', { ...base, touches: [], targetTouches: [], changedTouches: [touch] })) : true;
    if (!proceed) return;
    fire(() => new MouseEvent('mousedown', { ...base, detail: 1 }));
    const focusable = top.closest('button, a[href], input, select, textarea, [tabindex]');
    if (focusable && document.activeElement !== focusable) focusable.focus({ preventScroll: true });
    fire(() => new MouseEvent('mouseup', { ...base, detail: 1 }));
    // click() runs the activation behavior (submit, label, checkbox) as a tap does.
    top.click();
  }

  // ---- Conditions ----

  const elementText = (element) => (element.matches('input, textarea, select') ? String(element.value ?? '') : normalize(element.textContent));

  /** Whether one condition holds now: what it saw, or null. */
  function holds(condition) {
    if (condition.hash !== undefined) return location.hash.startsWith(condition.hash) ? { hash: location.hash } : null;
    const state = condition.state ?? 'visible';
    const visible = find(condition.target).filter(isVisible);
    if (state === 'hidden') return visible.length === 0 ? { hash: location.hash } : null;
    for (const element of visible) {
      const text = elementText(element);
      if (state === 'enabled' && !isEnabled(element)) continue;
      if (state === 'checked' && !(element.checked || element.getAttribute('aria-checked') === 'true')) continue;
      if (condition.text !== undefined && text !== normalize(condition.text)) continue;
      if (condition.textIncludes !== undefined && !text.includes(normalize(condition.textIncludes))) continue;
      if (condition.nonEmpty && text === '') continue;
      return { text, name: accessibleName(element), hash: location.hash };
    }
    return null;
  }

  function describeCondition(condition) {
    if (condition.hash !== undefined) return `location.hash to start with ${condition.hash}`;
    const extra = condition.text !== undefined ? ` with text "${condition.text}"`
      : condition.textIncludes !== undefined ? ` containing "${condition.textIncludes}"` : condition.nonEmpty ? ' with text' : '';
    return `${describeTarget(condition.target)} to be ${condition.state ?? 'visible'}${extra}`;
  }

  /** Polls `check` until it returns a value or the time runs out. */
  async function until(check, timeout, gap = 100) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(gap);
    }
  }

  async function waitFor(conditions, timeout, gap) {
    const found = await until(() => {
      for (const [index, condition] of conditions.entries()) {
        const seen = holds(condition);
        if (seen) return { index, ...seen };
      }
      return null;
    }, timeout, gap);
    return found
      ? { ok: true, ...found }
      : { ok: false, reason: `Timed out after ${timeout} ms waiting for ${conditions.map(describeCondition).join(' or ')}.`, hash: location.hash };
  }

  /** Waits for a single visible, enabled element that a user could tap. */
  async function actionable(target, timeout) {
    let last = '';
    let scrolled = false;
    const hit = await until(() => {
      const { element, reason } = single(target);
      if (!element) {
        last = reason;
        return null;
      }
      if (!isEnabled(element)) {
        last = `${describe(element)} is disabled`;
        return null;
      }
      const result = hitTest(element, !scrolled);
      scrolled = scrolled || result.scrolled;
      if (result.reason) {
        last = result.reason;
        return null;
      }
      return { element, ...result };
    }, timeout);
    return hit ? { ...hit, scrolled } : { reason: `Could not tap ${describeTarget(target)} within ${timeout} ms: ${last}.` };
  }

  // ---- Commands ----

  const COMMANDS = {
    async tap({ target, timeout = 10_000, then }) {
      const hit = await actionable(target, timeout);
      if (hit.reason) return { ok: false, reason: hit.reason };
      dispatchTap(hit);
      const tapped = { ok: true, tapped: describe(hit.target), at: hit.point, scrolled: hit.scrolled };
      if (!then) return tapped;
      // Waits in the page straight after the tap, so a short-lived state (a feedback flash) is not missed.
      const after = await waitFor(then.conditions, then.timeout ?? 5_000, FAST_POLL_MS);
      return { ...tapped, ok: after.ok, then: after, reason: after.reason };
    },
    async fill({ target, value, timeout = 10_000 }) {
      const hit = await actionable(target, timeout);
      if (hit.reason) return { ok: false, reason: hit.reason };
      dispatchTap(hit);
      const input = hit.element;
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value === value ? { ok: true, scrolled: hit.scrolled } : { ok: false, reason: `${describe(input)} did not take the value.` };
    },
    wait({ conditions, timeout = 10_000 }) {
      return waitFor(conditions, timeout);
    },
    async read({ target, timeout = 10_000 }) {
      let last = '';
      const element = await until(() => {
        const { element: found, reason } = single(target);
        last = reason ?? '';
        return found ?? null;
      }, timeout);
      if (!element) return { ok: false, reason: `Could not read ${describeTarget(target)} within ${timeout} ms: ${last}.` };
      return { ok: true, text: elementText(element), name: accessibleName(element), enabled: isEnabled(element), checked: Boolean(element.checked) };
    },
    async state() {
      return { ok: true, hash: location.hash, visibilityState: document.visibilityState, readyState: document.readyState, hasFocus: document.hasFocus() };
    },
    /** What is on screen, for failure reports: headings, controls, alerts and layout. */
    async snapshot() {
      const visible = (selector) => [...document.querySelectorAll(selector)].filter(isVisible);
      const cap = (items) => items.slice(0, 40);
      return {
        ok: true,
        hash: location.hash,
        visibilityState: document.visibilityState,
        viewport: { width: window.innerWidth, height: window.innerHeight, visible: visibleScreen() },
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        headings: cap(visible(ROLES.heading).map((element) => accessibleName(element))),
        buttons: cap(visible(ROLES.button).map((element) => `${accessibleName(element)}${isEnabled(element) ? '' : ' (disabled)'}`)),
        fields: cap(visible('input, textarea, select').map((element) => `${element.type || element.tagName.toLowerCase()}: ${accessibleName(element)}`)),
        alerts: cap(visible('[role="alert"], [role="status"]').map((element) => normalize(element.textContent)).filter(Boolean)),
      };
    },
  };

  // ---- The connection to the host ----

  async function post(path, body) {
    // A text/plain body keeps this a simple request, with no CORS preflight.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${HOST}${path}`, { method: 'POST', body: JSON.stringify({ launch, ...body }), cache: 'no-store' });
        if (response.ok) return true;
      } catch {
        // The host is not listening yet, or the app was just resumed.
      }
      await sleep(250);
    }
    return false;
  }

  async function serve() {
    for (;;) {
      let command;
      try {
        const response = await fetch(`${HOST}/poll?launch=${encodeURIComponent(launch)}`, { cache: 'no-store' });
        command = await response.json();
      } catch {
        await sleep(500); // The app was suspended mid-poll, or no host is listening.
        continue;
      }
      if (!command || !Object.hasOwn(COMMANDS, command.type)) continue;
      let result;
      try {
        result = await COMMANDS[command.type](command);
      } catch (error) {
        result = { ok: false, reason: String(error?.stack ?? error) };
      }
      await post('/result', { id: command.id, result });
    }
  }

  const environment = {
    origin: location.origin,
    secureContext: window.isSecureContext,
    randomUUID: typeof crypto?.randomUUID,
    indexedDB: typeof indexedDB,
    userAgent: navigator.userAgent,
  };
  report('environment', environment);
  // Without a host (an ordinary manual launch of this build) it gives up quietly.
  void post('/hello', { environment }).then((connected) => (connected ? serve() : undefined));
})();
