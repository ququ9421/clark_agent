/**
 * CDP Explorer using Node 24 built-in WebSocket + fetch
 * No external dependencies needed
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  cdpHost: '127.0.0.1:9222',
  pageUrl: process.env.PAGE_URL || 'https://fistest.ciwork.cn/',
  slug: process.env.SLUG || 'home',
  email: process.env.E2E_TEST_EMAIL || '',
  password: process.env.E2E_TEST_PASSWORD || '',
  outputDir: join(__dirname, '..', 'tests', 'e2e', 'test-cases', 'generated'),
  screenshotDir: join(__dirname, '..', 'tests', 'e2e', 'screenshots'),
};

// ── CDP Client ────────────────────────────────────────────────────────────────

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.cmdId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = e => reject(new Error(`WS error: ${e.message || 'connection failed'}`));
      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          } else if (msg.method) {
            const handlers = this.eventHandlers.get(msg.method) || [];
            handlers.forEach(h => h(msg.params));
          }
        } catch {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.cmdId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 15000);
    });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  close() {
    this.ws?.close();
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDestructive(text) {
  return /删除|delete|remove|注销|logout|sign.?out|退出|清空|reset|deactivate/i.test(text || '');
}

function isExternal(href, baseUrl) {
  if (!href || href.startsWith('#') || href.startsWith('javascript')) return false;
  try {
    const u = new URL(href, baseUrl);
    const b = new URL(baseUrl);
    return u.hostname !== b.hostname;
  } catch { return false; }
}

// ── DOM Scanner ───────────────────────────────────────────────────────────────

const DOM_SCAN_FN = `
(function() {
  const SELECTORS = [
    'button:not([disabled])', 'a[href]', 'input:not([type="hidden"])', 'select',
    'textarea', '[role="button"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="combobox"]',
    '[aria-haspopup]', '[aria-expanded]', 'summary',
  ];
  const seen = new Set();
  const elements = [];
  SELECTORS.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || tag;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy') || null;
        const ariaLabel = el.getAttribute('aria-label') || null;
        const text = (el.textContent || '').trim().slice(0, 80);
        const name = ariaLabel || el.getAttribute('title') || el.getAttribute('placeholder') || text.slice(0, 50);
        const href = el.getAttribute('href') || null;
        const type = el.getAttribute('type') || null;
        const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
        const expanded = el.getAttribute('aria-expanded');
        const hasPopup = el.getAttribute('aria-haspopup');
        const semanticClasses = [...el.classList].filter(c =>
          !/^(?:flex|p-|m-|gap-|border|bg-|text-[a-z]|w-|h-|rounded|block|inline|hidden|absolute|relative|fixed|z-|grid|space-|overflow|cursor|font-|items-|justify-|min-|max-|py-|px-|pt-|pb-|pl-|pr-|ml-|mr-|mt-|mb-|mx-|my-)/.test(c)
        );
        let locatorHint;
        if (testId) locatorHint = \`[data-testid="\${testId}"]\`;
        else if (ariaLabel) locatorHint = \`[aria-label="\${ariaLabel}"]\`;
        else if (el.getAttribute('placeholder')) locatorHint = \`[placeholder="\${el.getAttribute('placeholder')}"]\`;
        else if (el.getAttribute('name') && (tag === 'input' || tag === 'select')) locatorHint = \`\${tag}[name="\${el.getAttribute('name')}"]\`;
        else if (semanticClasses.length > 0) locatorHint = \`.\${semanticClasses.slice(0,2).join('.')}\`;
        else { const t = text.slice(0, 30); locatorHint = t ? \`\${tag}:contains("\${t}")\` : tag; }
        let priority = 3;
        if (hasPopup || expanded === 'false' || role === 'tab') priority = 0;
        else if (role === 'menuitem' || role === 'treeitem') priority = 1;
        else if (tag === 'button' || tag === 'a' || tag === 'input') priority = 2;
        elements.push({ tag, role, name, text, locatorHint, testId, ariaLabel, href, type, disabled, expanded, hasPopup, priority,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } });
      });
    } catch(e) {}
  });
  const headings = [...document.querySelectorAll('h1,h2,h3')].map(h => ({ level: parseInt(h.tagName[1]), text: h.textContent.trim().slice(0,100) }));
  const forms = [...document.querySelectorAll('form')].map(f => ({
    action: f.action || '', method: f.method || 'get',
    fields: [...f.querySelectorAll('input,select,textarea')].map(i => ({
      name: i.name || i.id || '', type: i.type || 'text', required: i.required,
      placeholder: i.placeholder || '',
      label: (document.querySelector(\`label[for="\${i.id}"]\`) || {}).textContent || '',
    }))
  }));
  return { url: location.href, title: document.title, elements, headings, forms };
})()
`;

async function scanPage(cdp) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: DOM_SCAN_FN,
    returnByValue: true,
    awaitPromise: false,
  });
  return r.result?.value || { url: '', title: '', elements: [], headings: [], forms: [] };
}

// ── Screenshot ────────────────────────────────────────────────────────────────

async function takeScreenshot(cdp, stateId) {
  try {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', quality: 80 });
    if (r.data) {
      mkdirSync(CONFIG.screenshotDir, { recursive: true });
      const file = join(CONFIG.screenshotDir, `${CONFIG.slug}-${stateId}.png`);
      const buf = Buffer.from(r.data, 'base64');
      writeFileSync(file, buf);
      return file;
    }
  } catch {}
  return null;
}

// ── State tracking ────────────────────────────────────────────────────────────

const seenFingerprints = new Set();
const allStates = [];
const edges = [];

function fingerprint(elements) {
  return (elements || []).map(e => `${e.role}:${e.name}`).sort().join('|').slice(0, 500);
}

function addState(id, scan, screenshot) {
  const fp = fingerprint(scan.elements);
  if (seenFingerprints.has(fp)) return false;
  seenFingerprints.add(fp);
  allStates.push({ id, url: scan.url, title: scan.title, elements: scan.elements, headings: scan.headings, forms: scan.forms, screenshot });
  return true;
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function handleLogin(cdp) {
  const check = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      const hasPwd = !!document.querySelector('input[type="password"]');
      const hasUser = !!(document.querySelector('input[name="email"]') || document.querySelector('input[name="username"]') || document.querySelector('input[name="loginName"]') || document.querySelector('input[name="account"]') || document.querySelector('input[type="email"]'));
      const urlHint = /sign.?in|log.?in|auth|login/i.test(location.pathname);
      return { isLogin: (hasPwd && hasUser) || (urlHint && hasPwd), url: location.href };
    })()`,
    returnByValue: true,
  });

  const info = check.result?.value;
  if (!info?.isLogin) return false;

  console.log(`🔐 Login page detected: ${info.url}`);
  if (!CONFIG.email || !CONFIG.password) {
    throw new Error('Login required but credentials not set. Configure E2E_TEST_EMAIL/E2E_TEST_PASSWORD in .env');
  }

  // Fill username
  await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      const u = document.querySelector('input[name="loginName"],input[name="email"],input[name="username"],input[name="account"],input[type="email"]');
      if(u){ u.value='${CONFIG.email}'; u.dispatchEvent(new Event('input',{bubbles:true})); u.dispatchEvent(new Event('change',{bubbles:true})); return 'filled:'+u.name; }
      return 'not found';
    })()`,
    returnByValue: true,
  });
  await cdp.sleep(300);

  // Fill password
  await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      const p = document.querySelector('input[type="password"]');
      if(p){ p.value='${CONFIG.password}'; p.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('change',{bubbles:true})); return 'filled'; }
      return 'not found';
    })()`,
    returnByValue: true,
  });
  await cdp.sleep(300);

  // Submit
  const submitResult = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      const btn = document.querySelector('button[type="submit"]') ||
                  document.querySelector('.login-btn') ||
                  [...document.querySelectorAll('button')].find(b => /登录|sign.?in|log.?in/i.test(b.textContent));
      if(btn){ btn.click(); return 'clicked:'+btn.textContent.trim(); }
      // Fallback: submit the form
      const form = document.querySelector('form');
      if(form){ form.submit(); return 'form-submitted'; }
      return 'not found';
    })()`,
    returnByValue: true,
  });
  console.log(`   Submit result: ${submitResult.result?.value}`);

  // Wait for navigation
  await cdp.sleep(3000);
  await cdp.send('Page.reload').catch(() => {});
  await cdp.sleep(2000);

  const afterCheck = await cdp.send('Runtime.evaluate', {
    expression: `(function(){return {url: location.href, hasLogin: !!document.querySelector('input[type="password"]')}})()`,
    returnByValue: true,
  });
  const after = afterCheck.result?.value;
  console.log(`   After login URL: ${after?.url}, stillLoginPage: ${after?.hasLogin}`);
  return !after?.hasLogin;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 CDP Native Explorer`);
  console.log(`   Target: ${CONFIG.pageUrl}`);
  console.log(`   Slug: ${CONFIG.slug}`);

  mkdirSync(CONFIG.outputDir, { recursive: true });
  mkdirSync(CONFIG.screenshotDir, { recursive: true });

  // Get available pages from Chrome
  console.log(`\n📋 Listing Chrome pages...`);
  const listRes = await fetch(`http://${CONFIG.cdpHost}/json`);
  const pages = await listRes.json();
  console.log(`   Found ${pages.length} page(s)`);

  // Find a usable page or create new one
  let targetPage = pages.find(p => p.type === 'page' && !p.url.startsWith('chrome://'));
  if (!targetPage) targetPage = pages.find(p => p.type === 'page');
  if (!targetPage) {
    // Get a new target via PUT
    const newPageRes = await fetch(`http://${CONFIG.cdpHost}/json/new?${CONFIG.pageUrl}`);
    const newPage = await newPageRes.json();
    targetPage = newPage;
  }

  console.log(`   Using page: ${targetPage.title} (${targetPage.url})`);

  const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
  await cdp.connect();
  console.log(`   ✓ Connected to CDP`);

  // Enable domains
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Navigate to target
  console.log(`\n📍 Navigating to ${CONFIG.pageUrl}...`);
  await cdp.send('Page.navigate', { url: CONFIG.pageUrl });
  await cdp.sleep(3000);

  // Check for and handle login
  const loggedIn = await handleLogin(cdp);
  if (loggedIn !== false) await cdp.sleep(2000);

  // Phase 2: Scan S0
  console.log(`\n📊 Phase 2: Initial state scan (S0)...`);
  const s0Scan = await scanPage(cdp);
  console.log(`   URL: ${s0Scan.url}`);
  console.log(`   Title: ${s0Scan.title}`);
  console.log(`   Elements found: ${s0Scan.elements.length}`);
  console.log(`   Forms found: ${s0Scan.forms.length}`);

  const s0Screenshot = await takeScreenshot(cdp, 'S0');
  addState('S0', s0Scan, s0Screenshot);

  // Phase 3: BFS exploration
  console.log(`\n🔍 Phase 3: Interactive exploration...`);

  const maxStates = 20;
  const maxInteractions = 60;
  let interactionCount = 0;
  let skippedDestructive = 0;
  const explored = new Set();

  const queue = (s0Scan.elements || [])
    .filter(e => !e.disabled && !isDestructive(e.text))
    .sort((a, b) => a.priority - b.priority)
    .map(e => ({ element: e, fromState: 'S0', depth: 0 }));

  while (queue.length > 0 && allStates.length < maxStates && interactionCount < maxInteractions) {
    const { element, fromState, depth } = queue.shift();
    if (depth > 2) continue;

    const key = `${element.locatorHint}|${element.text?.slice(0, 30)}`;
    if (explored.has(key)) continue;
    explored.add(key);

    if (isDestructive(element.text)) { skippedDestructive++; continue; }
    if (element.href && isExternal(element.href, CONFIG.pageUrl)) continue;

    const stateId = `S${allStates.length}`;
    const label = (element.name || element.text || element.locatorHint || '').slice(0, 40);

    try {
      const beforeUrl = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).then(r => r.result?.value);

      // Interact based on element type
      if (element.tag === 'input' || element.tag === 'textarea') {
        const val = element.type === 'password' ? 'TestPass123!' : (element.type === 'email' ? 'test@example.com' : 'test input');
        await cdp.send('Runtime.evaluate', {
          expression: `(function(){
            const els = document.querySelectorAll('${element.locatorHint.replace(/'/g, "\\'")}');
            const el = els[0];
            if(el){ el.focus(); el.value='${val}'; el.dispatchEvent(new Event('input',{bubbles:true})); return 'filled'; }
            return 'not found';
          })()`,
          returnByValue: true,
        });
      } else {
        // Click
        const clickResult = await cdp.send('Runtime.evaluate', {
          expression: `(function(){
            try {
              const els = document.querySelectorAll('${element.locatorHint.replace(/'/g, "\\'").replace(/"/g, '\\"')}');
              const el = els[0];
              if(!el) return 'not found';
              el.click();
              return 'clicked';
            } catch(e) { return 'error:'+e.message; }
          })()`,
          returnByValue: true,
        });
        if (clickResult.result?.value === 'not found') continue;
      }

      await cdp.sleep(1200);
      interactionCount++;

      const newScan = await scanPage(cdp);
      const fp = fingerprint(newScan.elements);
      const afterUrl = newScan.url;

      if (!seenFingerprints.has(fp) && newScan.elements.length > 0) {
        const screenshot = await takeScreenshot(cdp, stateId);
        if (addState(stateId, newScan, screenshot)) {
          console.log(`   ✓ ${stateId}: "${(newScan.title || '').slice(0, 50)}" via [${label}] — ${newScan.elements.length} elems`);
          edges.push({ from: fromState, to: stateId, action: 'click', trigger: element.locatorHint, label });

          // Add new elements to queue
          newScan.elements
            .filter(e => !e.disabled && !isDestructive(e.text))
            .sort((a, b) => a.priority - b.priority)
            .slice(0, 15)
            .forEach(e => queue.push({ element: e, fromState: stateId, depth: depth + 1 }));
        }
      } else {
        edges.push({ from: fromState, to: 'existing', action: 'click', trigger: element.locatorHint, label });
      }

      // Navigate back if URL changed
      if (afterUrl !== beforeUrl) {
        await cdp.send('Page.navigate', { url: beforeUrl || CONFIG.pageUrl });
        await cdp.sleep(1500);
      }
    } catch (e) {
      // Skip failed interactions silently
    }
  }

  cdp.close();

  // ── Build and write baseline ─────────────────────────────────────────────────

  const s0 = allStates[0] || { elements: [], forms: [], headings: [], url: CONFIG.pageUrl, title: '' };
  const allElements = [];
  const seenEl = new Set();
  allStates.forEach(st => {
    (st.elements || []).forEach(e => {
      if (!seenEl.has(e.locatorHint)) {
        seenEl.add(e.locatorHint);
        allElements.push({ ...e, discoveredInState: st.id });
      }
    });
  });

  const baseline = {
    version: '1.0',
    slug: CONFIG.slug,
    pageUrl: CONFIG.pageUrl,
    title: s0.title,
    exploredAt: new Date().toISOString(),
    locatorProfile: {
      hasTestId: allElements.some(e => e.testId),
      hasAriaLabel: allElements.some(e => e.ariaLabel),
      primaryStrategy: allElements.some(e => e.testId) ? 'testId' : (allElements.some(e => e.ariaLabel) ? 'aria' : 'css'),
    },
    explorationStats: {
      terminationReason: interactionCount >= maxInteractions ? 'limit_reached' : 'queue_empty',
      statesDiscovered: allStates.length,
      interactionsPerformed: interactionCount,
      elementsFound: allElements.length,
      skippedDestructive,
      activatedElements: 0,
      unactivatedElements: 0,
    },
    states: allStates,
    stateGraph: {
      nodes: allStates.map(s => ({ id: s.id, url: s.url, title: s.title })),
      edges,
    },
    allElements,
    forms: s0.forms,
    headings: s0.headings,
    screenshots: allStates.map(s => s.screenshot).filter(Boolean),
  };

  const outFile = join(CONFIG.outputDir, `cdp-baseline-${CONFIG.slug}.json`);
  writeFileSync(outFile, JSON.stringify(baseline, null, 2), 'utf8');

  console.log(`\n📈 Exploration complete:`);
  console.log(`   States discovered : ${baseline.explorationStats.statesDiscovered}`);
  console.log(`   Interactions      : ${baseline.explorationStats.interactionsPerformed}`);
  console.log(`   Elements found    : ${baseline.explorationStats.elementsFound}`);
  console.log(`   Forms             : ${baseline.forms.length}`);
  console.log(`   Skipped (destroy) : ${skippedDestructive}`);
  console.log(`   Locator strategy  : ${baseline.locatorProfile.primaryStrategy}`);
  console.log(`\n💾 Baseline saved: ${outFile}`);

  // Output JSON summary for parent process
  process.stdout.write('\n__BASELINE_SUMMARY__' + JSON.stringify({
    success: true,
    outputFile: outFile,
    stats: baseline.explorationStats,
    title: baseline.title,
    locatorProfile: baseline.locatorProfile,
    formsCount: baseline.forms.length,
    headings: baseline.headings,
  }) + '\n');
}

main().catch(e => {
  console.error(`\n❌ Fatal: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
