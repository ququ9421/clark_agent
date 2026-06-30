/**
 * Two-stage SSO login handler for fistest.ciwork.cn
 * Stage 1: fistest.ciwork.cn/login (Ant Design form)
 * Stage 2: portal.test.sso.ciwork.cn (Authing SSO)
 */

const CDPHost = '127.0.0.1:9222';
const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.ws = null; this.cmdId = 1; this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WS connection failed'));
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.cmdId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, 15000);
    });
  }
  eval(expr) { return this.send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result?.value); }
  evalFn(fn, ...args) {
    const expr = `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
    return this.eval(expr);
  }
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  close() { this.ws?.close(); }
}

function fillReactInputScript(id, value) {
  return `(function() {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return 'not found: ' + ${JSON.stringify(id)};
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return 'filled: ' + el.value;
  })()`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const listRes = await fetch(`http://${CDPHost}/json`);
const pages = await listRes.json();
const page = pages.find(p => p.type === 'page') || pages[0];

const cdp = new CDPClient(page.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

console.log('Current URL:', await cdp.eval('location.href'));

// Navigate to FIS app
await cdp.send('Page.navigate', { url: 'https://fistest.ciwork.cn/' });
await cdp.sleep(3000);

let currentUrl = await cdp.eval('location.href');
console.log('After navigate:', currentUrl);

// Stage 1: Check if redirected to SSO directly
if (currentUrl.includes('sso.ciwork.cn') || currentUrl.includes('portal.test')) {
  console.log('Redirected to SSO portal directly');
  await handleSSOLogin(cdp);
} else if (currentUrl.includes('/login')) {
  console.log('FIS login page detected');
  // Fill FIS login form
  const r1 = await cdp.eval(fillReactInputScript('fis_login_cpm_dynamic_form_username', EMAIL));
  const r2 = await cdp.eval(fillReactInputScript('fis_login_cpm_dynamic_form_password', PASSWORD));
  console.log('FIS form fill:', r1, '|', r2);
  await cdp.sleep(500);

  const click1 = await cdp.eval(`(function(){
    const btn = document.querySelector('button[type="submit"]');
    if (!btn) return 'not found';
    btn.click();
    return 'clicked: ' + btn.textContent.trim();
  })()`);
  console.log('FIS submit:', click1);
  await cdp.sleep(3000);

  currentUrl = await cdp.eval('location.href');
  console.log('After FIS login:', currentUrl);

  if (currentUrl.includes('sso.ciwork.cn')) {
    await handleSSOLogin(cdp);
  }
}

// Verify final state
await cdp.sleep(2000);
const final = await cdp.eval('({url:location.href,title:document.title})');
console.log('\n✅ Final state:', JSON.stringify(final));
if (!final.url.includes('login') && !final.url.includes('sso')) {
  console.log('🎉 Login successful! Now on:', final.url);
} else {
  console.log('⚠️  Still on login/SSO page');
  // Capture screenshot for debugging
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (ss.data) {
    const { writeFileSync } = await import('fs');
    writeFileSync('E:/Clark_agent/scripts/login-debug.png', Buffer.from(ss.data, 'base64'));
    console.log('Screenshot saved: scripts/login-debug.png');
  }
}

cdp.close();

async function handleSSOLogin(cdp) {
  console.log('\n--- SSO login ---');
  await cdp.sleep(1500);

  // Check what form is present
  const formInfo = await cdp.eval(`(function(){
    return {
      url: location.href,
      inputs: [...document.querySelectorAll('input')].map(i=>({id:i.id,type:i.type,ph:i.placeholder})),
    };
  })()`);
  console.log('SSO form inputs:', JSON.stringify(formInfo.inputs));

  // Fill SSO form - try multiple selectors
  const fillSSO = await cdp.eval(`(function(email, pass) {
    function fill(el, val) {
      if (!el) return 'not found';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      el.dispatchEvent(new Event('blur', {bubbles: true}));
      return 'ok:' + el.value;
    }
    const uEl = document.getElementById('passworLogin_account') ||
                document.querySelector('input[placeholder*="用户名"], input[placeholder*="账号"], input[type="text"]');
    const pEl = document.getElementById('passworLogin_password') ||
                document.querySelector('input[type="password"]');
    return { u: fill(uEl, email), p: fill(pEl, pass) };
  })(${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})`);
  console.log('SSO fill:', JSON.stringify(fillSSO));

  await cdp.sleep(800);

  // Check current validation state
  const valState = await cdp.eval(`(function(){
    const u = document.getElementById('passworLogin_account') || document.querySelector('input[type="text"]');
    const p = document.getElementById('passworLogin_password') || document.querySelector('input[type="password"]');
    return { uVal: u?.value, pVal: p ? '[set]' : 'N/A' };
  })()`);
  console.log('SSO validation:', JSON.stringify(valState));

  // Click submit
  const click = await cdp.eval(`(function(){
    const btns = [...document.querySelectorAll('button[type="submit"]')];
    const btn = btns.find(b => b.textContent.trim().replace(/\\s+/g,'') === '登录') || btns[0];
    if (!btn) return 'not found';
    btn.click();
    return 'clicked:' + btn.textContent.trim();
  })()`);
  console.log('SSO click:', click);

  await cdp.sleep(5000);
  const afterSSO = await cdp.eval('location.href');
  console.log('After SSO login:', afterSSO);
}
