/**
 * Test login with proper React/Ant Design form handling
 */

const CDPHost = '127.0.0.1:9222';

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.ws = null; this.cmdId = 1; this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WS error'));
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
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  close() { this.ws?.close(); }
}

const EMAIL = 'CI24519';
const PASSWORD = '1qaz@WSX';

const listRes = await fetch(`http://${CDPHost}/json`);
const pages = await listRes.json();
const page = pages.find(p => p.type === 'page') || pages[0];
console.log('Page:', page.url);

const cdp = new CDPClient(page.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

// Navigate to login page fresh
await cdp.send('Page.navigate', { url: 'https://fistest.ciwork.cn/login' });
await cdp.sleep(3000);

console.log('\n--- Filling login form with React-aware method ---');

// Fill username using React's native value setter
const fillResult = await cdp.eval(`(function() {
  const username = document.getElementById('fis_login_cpm_dynamic_form_username');
  const password = document.getElementById('fis_login_cpm_dynamic_form_password');

  function fillReactInput(input, value) {
    if (!input) return 'not found';
    // React 16+ native input value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return 'filled:' + input.value;
  }

  const r1 = fillReactInput(username, '${EMAIL}');
  const r2 = fillReactInput(password, '${PASSWORD}');
  return { username: r1, password: r2 };
})()`);
console.log('Fill result:', JSON.stringify(fillResult));

await cdp.sleep(1000);

// Check validation state
const validState = await cdp.eval(`(function() {
  const u = document.getElementById('fis_login_cpm_dynamic_form_username');
  const p = document.getElementById('fis_login_cpm_dynamic_form_password');
  const errors = [...document.querySelectorAll('.ant-form-item-explain-error')].map(e => e.textContent.trim());
  return {
    usernameVal: u?.value,
    passwordVal: p ? '[set]' : 'not found',
    errors,
    submitDisabled: document.querySelector('button[type="submit"]')?.disabled
  };
})()`);
console.log('Validation state:', JSON.stringify(validState));

await cdp.sleep(500);

// Click submit
const clickResult = await cdp.eval(`(function() {
  const btn = document.querySelector('button[type="submit"]');
  if (!btn) return 'button not found';
  if (btn.disabled) return 'button disabled';
  btn.click();
  return 'clicked: ' + btn.textContent.trim();
})()`);
console.log('Click result:', clickResult);

await cdp.sleep(4000);

// Check result
const afterState = await cdp.eval(`(function() {
  return {
    url: location.href,
    title: document.title,
    isStillLogin: !!document.querySelector('input[type="password"]'),
    hasError: [...document.querySelectorAll('.ant-form-item-explain-error,.ant-message-error,.ant-notification-notice-error')].map(e => e.textContent.trim())
  };
})()`);
console.log('\nAfter login attempt:');
console.log('  URL:', afterState.url);
console.log('  Title:', afterState.title);
console.log('  Still on login?', afterState.isStillLogin);
console.log('  Errors:', JSON.stringify(afterState.hasError));

if (!afterState.isStillLogin) {
  console.log('\n✅ Login SUCCESSFUL!');
} else {
  console.log('\n❌ Login failed. Checking for error messages...');
  // Try to get any toast/notification messages
  await cdp.sleep(1000);
  const errors2 = await cdp.eval(`(function() {
    return [...document.querySelectorAll('.ant-message-notice-content, .ant-notification-notice-message, [class*="error"], [class*="alert"]')]
      .map(e => e.textContent.trim()).filter(t => t.length > 0 && t.length < 200).slice(0, 5);
  })()`);
  console.log('Error messages:', errors2);
}

cdp.close();
