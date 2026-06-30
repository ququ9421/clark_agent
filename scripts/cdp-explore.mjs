/**
 * CDP Explorer Script using Playwright connectOverCDP
 * Connects to existing Chrome instance and performs page exploration
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  cdpEndpoint: 'http://127.0.0.1:9222',
  pageUrl: process.env.PAGE_URL || 'https://fistest.ciwork.cn/',
  slug: process.env.SLUG || 'home',
  email: process.env.E2E_TEST_EMAIL || '',
  password: process.env.E2E_TEST_PASSWORD || '',
  outputDir: join(__dirname, '..', 'tests', 'e2e', 'test-cases', 'generated'),
  screenshotDir: join(__dirname, '..', 'tests', 'e2e', 'screenshots'),
  maxStates: 30,
  maxInteractions: 100,
};

const stats = {
  statesDiscovered: 0,
  interactionsPerformed: 0,
  elementsFound: 0,
  skippedDestructive: 0,
  activatedElements: 0,
  unactivatedElements: 0,
};

const allStates = [];
const stateGraph = { nodes: [], edges: [] };
const visitedStateFingerprints = new Set();
const screenshots = [];

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

function buildStateFingerprint(elements) {
  return elements
    .map(e => `${e.role}:${e.name || e.text || ''}`)
    .sort()
    .join('|');
}

function isDestructive(text, role) {
  const t = (text || '').toLowerCase();
  return /删除|delete|remove|注销|logout|sign.?out|退出|清空|reset|format/.test(t);
}

function isExternalUrl(href) {
  if (!href) return false;
  try {
    const u = new URL(href, CONFIG.pageUrl);
    const base = new URL(CONFIG.pageUrl);
    return u.hostname !== base.hostname;
  } catch { return false; }
}

// ── DOM scan ──────────────────────────────────────────────────────────────────

async function scanPageElements(page) {
  return await page.evaluate(() => {
    const INTERACTIVE_SELECTORS = [
      'button:not([disabled])',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="option"]',
      '[role="treeitem"]',
      '[aria-haspopup]',
      '[aria-expanded]',
      '[onclick]',
      '[tabindex]:not([tabindex="-1"])',
      'summary',
    ];

    const seen = new Set();
    const elements = [];

    INTERACTIVE_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || tag;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || null;
        const ariaLabel = el.getAttribute('aria-label') || null;
        const name = ariaLabel || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent?.trim().slice(0, 60) || '';
        const href = el.getAttribute('href') || null;
        const type = el.getAttribute('type') || null;
        const value = el.tagName === 'SELECT' ? el.value : (el.tagName === 'INPUT' ? el.value : null);
        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        const expanded = el.getAttribute('aria-expanded');
        const hasPopup = el.getAttribute('aria-haspopup');
        const classes = [...el.classList].filter(c => !/^(flex|p-|m-|gap-|border|bg-|text-|w-|h-|rounded|block|inline|hidden|absolute|relative|fixed|z-|grid|space-|overflow|cursor|font-|items-|justify-|min-|max-)/.test(c));

        // Build locator hint
        let locatorHint;
        if (testId) {
          locatorHint = `[data-testid="${testId}"]`;
        } else if (ariaLabel) {
          locatorHint = `[aria-label="${ariaLabel}"]`;
        } else if (tag === 'input' && (type === 'email' || type === 'text' || type === 'password' || type === 'search')) {
          locatorHint = el.getAttribute('placeholder')
            ? `input[placeholder="${el.getAttribute('placeholder')}"]`
            : (el.getAttribute('name') ? `input[name="${el.getAttribute('name')}"]` : `input[type="${type}"]`);
        } else if (tag === 'button' || role === 'button') {
          const btnText = el.textContent?.trim().slice(0, 40);
          locatorHint = btnText ? `button:has-text("${btnText}")` : (classes[0] ? `.${classes[0]}` : tag);
        } else if (tag === 'a' && href) {
          const linkText = el.textContent?.trim().slice(0, 40);
          locatorHint = linkText ? `a:has-text("${linkText}")` : `a[href="${href}"]`;
        } else if (classes.length > 0) {
          locatorHint = `.${classes.slice(0, 2).join('.')}`;
        } else {
          locatorHint = tag;
        }

        // Determine priority
        let priority = 3;
        if (hasPopup || (expanded === 'false') || role === 'tab') priority = 0;
        else if (role === 'menuitem' || role === 'treeitem') priority = 1;
        else if (tag === 'button' || tag === 'a' || tag === 'input') priority = 2;

        elements.push({
          tag, role, name, testId, ariaLabel, href, type, value,
          disabled, expanded, hasPopup, classes,
          locatorHint, priority,
          text: el.textContent?.trim().slice(0, 80),
          xpath: getXPath(el),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        });
      });
    });

    // Also collect headings and page info
    const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => ({
      level: parseInt(h.tagName[1]),
      text: h.textContent.trim().slice(0, 100),
    }));

    const forms = [...document.querySelectorAll('form')].map(f => ({
      action: f.getAttribute('action') || '',
      method: f.getAttribute('method') || 'get',
      fields: [...f.querySelectorAll('input,select,textarea')].map(input => ({
        name: input.name || input.id || '',
        type: input.type || 'text',
        required: input.required,
        placeholder: input.placeholder || '',
        label: document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() || '',
      })),
    }));

    return {
      url: location.href,
      title: document.title,
      elements,
      headings,
      forms,
      readyState: document.readyState,
    };

    function getXPath(el) {
      if (el.id) return `//*[@id="${el.id}"]`;
      const parts = [];
      while (el && el.nodeType === 1) {
        let idx = 1;
        let sib = el.previousSibling;
        while (sib) { if (sib.nodeType === 1 && sib.tagName === el.tagName) idx++; sib = sib.previousSibling; }
        parts.unshift(`${el.tagName.toLowerCase()}[${idx}]`);
        el = el.parentNode;
      }
      return '/' + parts.join('/');
    }
  });
}

// ── login handling ────────────────────────────────────────────────────────────

async function handleLogin(page) {
  const loginCheck = await page.evaluate(() => {
    const hasPassword = !!document.querySelector('input[type="password"]');
    const hasUser = !!document.querySelector('input[name="email"], input[name="username"], input[type="email"], input[name="loginName"], input[name="account"]');
    const urlHint = /sign.?in|log.?in|auth|login/i.test(location.pathname);
    return { isLoginPage: (hasPassword && hasUser) || (urlHint && hasPassword), url: location.href };
  });

  if (!loginCheck.isLoginPage) return false;

  console.log(`🔐 Detected login page: ${loginCheck.url}`);

  if (!CONFIG.email || !CONFIG.password) {
    throw new Error('Login required but E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set');
  }

  // Try filling login form
  try {
    const userSel = 'input[name="loginName"], input[name="username"], input[name="email"], input[type="email"], input[name="account"]';
    await page.fill(userSel, CONFIG.email);
    await page.fill('input[type="password"]', CONFIG.password);
    await page.click('button[type="submit"], .login-btn, button:has-text("登录"), button:has-text("Login"), button:has-text("Sign in")');
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    console.log(`✅ Login attempted, now at: ${page.url()}`);
    return true;
  } catch (e) {
    console.warn(`⚠️  Auto-login failed: ${e.message}`);
    return false;
  }
}

// ── screenshot ────────────────────────────────────────────────────────────────

async function takeScreenshot(page, stateId) {
  mkdirSync(CONFIG.screenshotDir, { recursive: true });
  const file = join(CONFIG.screenshotDir, `${CONFIG.slug}-${stateId}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  screenshots.push(file);
  return file;
}

// ── state recording ───────────────────────────────────────────────────────────

function recordState(stateId, scanResult, screenshot) {
  const fp = buildStateFingerprint(scanResult.elements || []);
  if (visitedStateFingerprints.has(fp)) return null;
  visitedStateFingerprints.add(fp);

  const state = {
    id: stateId,
    url: scanResult.url,
    title: scanResult.title,
    fingerprint: fp,
    elements: scanResult.elements || [],
    headings: scanResult.headings || [],
    forms: scanResult.forms || [],
    screenshot,
  };
  allStates.push(state);
  stateGraph.nodes.push({ id: stateId, url: scanResult.url, title: scanResult.title });
  stats.statesDiscovered++;
  stats.elementsFound += scanResult.elements?.length || 0;
  return state;
}

// ── main exploration ──────────────────────────────────────────────────────────

async function explore() {
  console.log(`\n🚀 CDP Explorer starting`);
  console.log(`   Target: ${CONFIG.pageUrl}`);
  console.log(`   Slug: ${CONFIG.slug}`);
  console.log(`   Output: ${CONFIG.outputDir}\n`);

  mkdirSync(CONFIG.outputDir, { recursive: true });
  mkdirSync(CONFIG.screenshotDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.connectOverCDP(CONFIG.cdpEndpoint);
  } catch (e) {
    console.error(`❌ Cannot connect to Chrome on ${CONFIG.cdpEndpoint}: ${e.message}`);
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  let page = context.pages()[0] || await context.newPage();

  // Navigate to target URL
  console.log(`📍 Navigating to ${CONFIG.pageUrl}...`);
  await page.goto(CONFIG.pageUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(async e => {
    console.warn(`⚠️  networkidle timeout, trying domcontentloaded: ${e.message}`);
    await page.goto(CONFIG.pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  });
  await page.waitForTimeout(1500);

  // Handle login
  await handleLogin(page);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Phase 2: Initial State (S0) scan
  console.log(`\n📊 Phase 2: Initial state scan...`);
  const s0Scan = await scanPageElements(page);
  const s0Screenshot = await takeScreenshot(page, 'S0');
  const s0 = recordState('S0', s0Scan, s0Screenshot);

  if (!s0) {
    console.log('⚠️  Initial state already seen or empty. Aborting.');
    await browser.close();
    return buildBaseline([]);
  }

  console.log(`   ✓ S0: "${s0Scan.title}" — ${s0Scan.elements.length} elements, ${s0Scan.forms.length} forms`);

  // Phase 3: BFS exploration
  console.log(`\n🔍 Phase 3: Interactive BFS exploration...`);

  // Sort elements by priority
  const queue = s0.elements
    .filter(e => !e.disabled && !isDestructive(e.text, e.role))
    .sort((a, b) => a.priority - b.priority)
    .map(e => ({ element: e, fromState: 'S0', depth: 0 }));

  const explored = new Set();
  let interactionCount = 0;

  while (queue.length > 0 && stats.statesDiscovered < CONFIG.maxStates && interactionCount < CONFIG.maxInteractions) {
    const { element, fromState, depth } = queue.shift();
    if (depth > 3) continue;

    const key = `${element.locatorHint}::${element.text}`;
    if (explored.has(key)) continue;
    explored.add(key);

    if (isDestructive(element.text, element.role)) {
      stats.skippedDestructive++;
      console.log(`   ⛔ Skip destructive: ${element.text}`);
      continue;
    }
    if (element.href && isExternalUrl(element.href)) {
      console.log(`   🌐 Skip external: ${element.href}`);
      continue;
    }

    const stateId = `S${stats.statesDiscovered}`;
    const actionLabel = element.text?.slice(0, 30) || element.name?.slice(0, 30) || element.locatorHint;

    try {
      // Save current URL for backtrack
      const beforeUrl = page.url();

      // Attempt interaction
      let interacted = false;
      if (element.tag === 'input' || element.tag === 'textarea' || element.tag === 'select') {
        // For inputs: fill with test data
        if (element.type === 'text' || element.type === 'email' || element.type === 'search' || element.tag === 'textarea') {
          await page.fill(element.locatorHint, 'test input').catch(() => {});
          interacted = true;
        } else if (element.type === 'password') {
          await page.fill(element.locatorHint, 'TestPass123!').catch(() => {});
          interacted = true;
        }
      } else if (element.tag === 'a' || element.role === 'link' || element.tag === 'button' || element.role === 'button' || element.role === 'tab' || element.role === 'menuitem') {
        const el = page.locator(element.locatorHint).first();
        const count = await el.count().catch(() => 0);
        if (count > 0) {
          await el.click({ timeout: 5000 }).catch(() => {});
          interacted = true;
        }
      }

      if (!interacted) continue;

      await page.waitForTimeout(800);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      interactionCount++;
      stats.interactionsPerformed++;

      const afterUrl = page.url();
      const newScan = await scanPageElements(page);
      const newFp = buildStateFingerprint(newScan.elements || []);

      if (!visitedStateFingerprints.has(newFp)) {
        const newScreenshot = await takeScreenshot(page, stateId);
        const newState = recordState(stateId, newScan, newScreenshot);
        if (newState) {
          console.log(`   ✓ ${stateId}: "${newScan.title?.slice(0,50)}" via [${actionLabel}] — ${newScan.elements.length} elements`);

          stateGraph.edges.push({
            from: fromState,
            to: stateId,
            action: 'click',
            trigger: element.locatorHint,
            label: actionLabel,
          });

          // Add new elements to queue
          newState.elements
            .filter(e => !e.disabled && !isDestructive(e.text, e.role))
            .sort((a, b) => a.priority - b.priority)
            .slice(0, 20)
            .forEach(e => queue.push({ element: e, fromState: stateId, depth: depth + 1 }));
        }
      } else {
        stateGraph.edges.push({
          from: fromState,
          to: 'existing',
          action: 'click',
          trigger: element.locatorHint,
          label: actionLabel,
        });
      }

      // Backtrack if URL changed to a different path
      if (afterUrl !== beforeUrl && !afterUrl.startsWith(CONFIG.pageUrl.replace(/\/$/, ''))) {
        await page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => page.goBack());
        await page.waitForTimeout(500);
      } else if (afterUrl !== beforeUrl) {
        // On a sub-page, go back after scanning
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(500);
      }

    } catch (e) {
      // Silently skip failed interactions
    }
  }

  console.log(`\n📈 Exploration complete:`);
  console.log(`   States: ${stats.statesDiscovered}`);
  console.log(`   Interactions: ${stats.interactionsPerformed}`);
  console.log(`   Elements: ${stats.elementsFound}`);
  console.log(`   Skipped: ${stats.skippedDestructive} destructive`);

  await browser.close();
  return buildBaseline(allStates);
}

// ── baseline builder ──────────────────────────────────────────────────────────

function buildBaseline(states) {
  const s0 = states[0] || { elements: [], forms: [], headings: [], url: CONFIG.pageUrl, title: '' };

  // Deduplicate elements across all states
  const allElements = [];
  const seen = new Set();
  states.forEach(state => {
    (state.elements || []).forEach(el => {
      const k = el.locatorHint;
      if (!seen.has(k)) {
        seen.add(k);
        allElements.push({ ...el, discoveredInState: state.id });
      }
    });
  });

  return {
    version: '1.0',
    slug: CONFIG.slug,
    pageUrl: CONFIG.pageUrl,
    title: s0.title,
    exploredAt: new Date().toISOString(),
    locatorProfile: {
      hasTestId: allElements.some(e => e.testId),
      hasAriaLabel: allElements.some(e => e.ariaLabel),
      primaryStrategy: allElements.some(e => e.testId) ? 'testId' : 'aria',
    },
    explorationStats: {
      terminationReason: stats.interactionsPerformed >= CONFIG.maxInteractions ? 'limit_reached' : 'queue_empty',
      statesDiscovered: stats.statesDiscovered,
      interactionsPerformed: stats.interactionsPerformed,
      elementsFound: stats.elementsFound,
      activatedElements: stats.activatedElements,
      unactivatedElements: stats.unactivatedElements,
      skippedDestructive: stats.skippedDestructive,
    },
    states: states.map(state => ({
      id: state.id,
      url: state.url,
      title: state.title,
      screenshot: state.screenshot,
      elements: state.elements.map(e => ({
        tag: e.tag,
        role: e.role,
        name: e.name,
        text: e.text,
        locatorHint: e.locatorHint,
        testId: e.testId,
        ariaLabel: e.ariaLabel,
        href: e.href,
        type: e.type,
        disabled: e.disabled,
        expanded: e.expanded,
        hasPopup: e.hasPopup,
        priority: e.priority,
        rect: e.rect,
      })),
      headings: state.headings,
      forms: state.forms,
    })),
    stateGraph,
    allElements,
    forms: s0.forms,
    screenshots,
  };
}

// ── entry point ───────────────────────────────────────────────────────────────

explore()
  .then(baseline => {
    const outFile = join(CONFIG.outputDir, `cdp-baseline-${CONFIG.slug}.json`);
    writeFileSync(outFile, JSON.stringify(baseline, null, 2), 'utf8');
    console.log(`\n💾 Baseline saved: ${outFile}`);
    console.log(JSON.stringify({
      success: true,
      outputFile: outFile,
      stats: baseline.explorationStats,
      statesCount: baseline.states.length,
      allElementsCount: baseline.allElements.length,
      formsCount: baseline.forms.length,
    }));
  })
  .catch(err => {
    console.error(`\n❌ Exploration failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
