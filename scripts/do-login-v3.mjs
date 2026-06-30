/**
 * Login using CDP Input.dispatchKeyEvent for each character (bypasses React's value setter issues)
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

  async focusElement(selector) {
    await this.eval(`(function(){
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) { el.focus(); el.click(); return 'focused'; }
      return 'not found';
    })()`);
    await this.sleep(200);
  }

  async clearAndType(selector, text) {
    // Focus element
    await this.focusElement(selector);
    // Select all and delete
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete' });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete' });
    await this.sleep(100);
    // Type each character
    await this.send('Input.insertText', { text });
    await this.sleep(100);
    // Trigger React change event
    await this.eval(`(function(){
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) { el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }
    })()`);
  }
}

const pages = await fetch(`http://${CDPHost}/json`).then(r => r.json());
const page = pages.find(p => p.type === 'page') || pages[0];
const cdp = new CDPClient(page.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
// Input domain does not need enabling

console.log('Navigating...');
await cdp.send('Page.navigate', { url: 'https://fistest.ciwork.cn/' });
await cdp.sleep(3500);

let url = await cdp.eval('location.href');
console.log('URL:', url);

// ── Stage 1: FIS login ──────────────────────────────────────────────────────

if (url.includes('fistest.ciwork.cn/login')) {
  console.log('FIS login page - typing credentials...');
  await cdp.clearAndType('#fis_login_cpm_dynamic_form_username', EMAIL);
  console.log('Username typed');
  await cdp.sleep(300);
  await cdp.clearAndType('#fis_login_cpm_dynamic_form_password', PASSWORD);
  console.log('Password typed');
  await cdp.sleep(500);

  const val = await cdp.eval(`({u: document.getElementById('fis_login_cpm_dynamic_form_username')?.value, p: document.getElementById('fis_login_cpm_dynamic_form_password')?.value?.length})`);
  console.log('Values:', JSON.stringify(val));

  // Submit
  await cdp.eval(`document.querySelector('button[type="submit"]')?.click()`);
  console.log('Submitted FIS form');
  await cdp.sleep(4000);
  url = await cdp.eval('location.href');
  console.log('After FIS:', url);
}

// ── Stage 2: SSO login ──────────────────────────────────────────────────────

if (url.includes('sso.ciwork.cn')) {
  console.log('\nSSO portal...');
  await cdp.sleep(1500);

  await cdp.screenshot('E:/Clark_agent/scripts/sso-before.png');
  console.log('Screenshot: sso-before.png');

  // Try password login first
  console.log('Typing in password login form...');
  await cdp.clearAndType('#passworLogin_account', EMAIL);
  await cdp.sleep(300);
  await cdp.clearAndType('#passworLogin_password', PASSWORD);
  await cdp.sleep(500);

  const valCheck = await cdp.eval(`({
    u: document.getElementById('passworLogin_account')?.value,
    pLen: document.getElementById('passworLogin_password')?.value?.length,
  })`);
  console.log('SSO values:', JSON.stringify(valCheck));

  // Submit
  const btn = await cdp.eval(`(function(){
    const b = [...document.querySelectorAll('button[type="submit"]')].filter(x => !x.disabled)[0];
    if(b){b.click(); return b.textContent.trim();}return 'not found';
  })()`);
  console.log('Clicked:', btn);
  await cdp.sleep(5000);

  url = await cdp.eval('location.href');
  console.log('After SSO:', url);
  await cdp.screenshot('E:/Clark_agent/scripts/sso-after.png');
}

// ── Final check ─────────────────────────────────────────────────────────────

const final = await cdp.eval('({url:location.href,title:document.title})');
console.log('\n--- Result ---');
console.log('URL:', final.url);
console.log('Success:', !final.url.includes('login') && !final.url.includes('sso'));
cdp.close();
