/**
 * Two-stage SSO login - try AD login tab for corporate credentials
 */
import { writeFileSync } from 'fs';

const CDPHost = '127.0.0.1:9222';
const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.ws = null; this.cmdId = 1; this.pending = new Map();
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('WS error'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        }
      };
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.cmdId++;
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`Timeout: ${method}`)); } }, 15000);
    });
  }
  eval(expr) { return this.send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result?.value); }
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  screenshot(file) {
    return this.send('Page.captureScreenshot', { format: 'png' }).then(r => {
      if (r.data) writeFileSync(file, Buffer.from(r.data, 'base64'));
    });
  }
  close() { this.ws?.close(); }
}

function fillReact(cdp, id, value) {
  return cdp.eval(`(function() {
    const el = document.getElementById(${JSON.stringify(id)}) ||
               document.querySelector(${JSON.stringify(`[placeholder*="${id}"]`)});
    if (!el) return 'not found';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    el.dispatchEvent(new Event('blur', {bubbles:true}));
    return 'ok:' + el.value;
  })()`);
}

const pages = await fetch(`http://${CDPHost}/json`).then(r => r.json());
const page = pages.find(p => p.type === 'page') || pages[0];
const cdp = new CDPClient(page.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

// Navigate to FIS app fresh
console.log('Navigating to https://fistest.ciwork.cn/ ...');
await cdp.send('Page.navigate', { url: 'https://fistest.ciwork.cn/' });
await cdp.sleep(3000);

let url = await cdp.eval('location.href');
console.log('Landed on:', url);

// Handle FIS login page
if (url.includes('/login') && url.includes('fistest.ciwork.cn')) {
  const r1 = await fillReact(cdp, 'fis_login_cpm_dynamic_form_username', EMAIL);
  const r2 = await fillReact(cdp, 'fis_login_cpm_dynamic_form_password', PASSWORD);
  console.log('FIS fill:', r1, '/', r2);
  await cdp.sleep(500);
  await cdp.eval(`document.querySelector('button[type="submit"]')?.click()`);
  await cdp.sleep(4000);
  url = await cdp.eval('location.href');
  console.log('After FIS submit:', url);
}

// Handle SSO login
if (url.includes('sso.ciwork.cn')) {
  console.log('\n--- SSO portal ---');
  await cdp.sleep(1500);

  // Inspect tabs available
  const tabs = await cdp.eval(`(function(){
    return [...document.querySelectorAll('.authing-ant-tabs-tab, [role="tab"]')].map(t => ({
      text: t.textContent.trim(),
      active: t.classList.contains('authing-ant-tabs-tab-active') || t.getAttribute('aria-selected') === 'true',
      cls: t.className.slice(0, 80)
    }));
  })()`);
  console.log('Tabs:', JSON.stringify(tabs));

  // Click AD login tab if available
  const adTabClicked = await cdp.eval(`(function(){
    const tabs = [...document.querySelectorAll('.authing-ant-tabs-tab, [role="tab"]')];
    const adTab = tabs.find(t => /AD|域账号|企业/i.test(t.textContent));
    if (adTab) {
      adTab.click();
      return 'clicked AD tab: ' + adTab.textContent.trim();
    }
    return 'no AD tab found';
  })()`);
  console.log('AD tab:', adTabClicked);
  await cdp.sleep(1000);

  // Check what form is now visible
  const formNow = await cdp.eval(`(function(){
    return [...document.querySelectorAll('input:not([type="hidden"])')]
      .map(i => ({id:i.id, type:i.type, ph:i.placeholder, visible: window.getComputedStyle(i).display !== 'none'}));
  })()`);
  console.log('Current inputs:', JSON.stringify(formNow));

  // Fill the active form
  const fillResult = await cdp.eval(`(function(email, pass) {
    function fill(el, val) {
      if (!el) return 'not found';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
      el.dispatchEvent(new Event('blur', {bubbles:true}));
      return 'ok:' + el.value;
    }
    // Try to find visible inputs
    const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
    const textInputs = inputs.filter(i => (i.type === 'text' || i.type === 'email') && window.getComputedStyle(i.closest('[style*="display"]') || i).display !== 'none');
    const passInput = inputs.find(i => i.type === 'password');
    const userInput = textInputs[0];
    return {
      user: fill(userInput, email),
      pass: fill(passInput, pass),
      userSel: userInput ? userInput.id || userInput.placeholder : 'N/A'
    };
  })(${JSON.stringify(EMAIL)}, ${JSON.stringify(PASSWORD)})`);
  console.log('Fill result:', JSON.stringify(fillResult));

  await cdp.sleep(800);
  await cdp.screenshot('E:/Clark_agent/scripts/before-sso-submit.png');

  // Click submit
  const clickResult = await cdp.eval(`(function(){
    const btns = [...document.querySelectorAll('button[type="submit"], button.authing-ant-btn-primary')];
    const visible = btns.filter(b => window.getComputedStyle(b).display !== 'none' && !b.disabled);
    const btn = visible.find(b => /登[\\s]*录/.test(b.textContent)) || visible[0];
    if (!btn) return 'no visible submit button';
    btn.click();
    return 'clicked: ' + btn.textContent.trim();
  })()`);
  console.log('Submit:', clickResult);

  await cdp.sleep(5000);

  url = await cdp.eval('location.href');
  console.log('After SSO submit:', url);
  await cdp.screenshot('E:/Clark_agent/scripts/after-sso-submit.png');
}

// Final check
await cdp.sleep(2000);
const final = await cdp.eval('({url:location.href,title:document.title,hasLogin:!!document.querySelector("input[type=password]")})');
console.log('\n--- Final ---');
console.log('URL:', final.url);
console.log('Title:', final.title);
console.log('Success:', !final.url.includes('login') && !final.url.includes('sso'));

cdp.close();
