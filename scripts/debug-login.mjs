/**
 * Debug login form - inspect actual form structure
 */

const CDPHost = '127.0.0.1:9222';

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.cmdId = 1;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = e => reject(new Error('WS error'));
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, 10000);
    });
  }
  eval(expr) { return this.send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result?.value); }
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  close() { this.ws?.close(); }
}

const listRes = await fetch(`http://${CDPHost}/json`);
const pages = await listRes.json();
const page = pages.find(p => p.type === 'page') || pages[0];
console.log('Connecting to page:', page.title, page.url);

const cdp = new CDPClient(page.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');

// Inspect the form structure
const formInfo = await cdp.eval(`(function() {
  const inputs = [...document.querySelectorAll('input')];
  const buttons = [...document.querySelectorAll('button')];
  const forms = [...document.querySelectorAll('form')];
  return {
    url: location.href,
    title: document.title,
    bodyHTML: document.body.innerHTML.slice(0, 3000),
    inputs: inputs.map(i => ({
      type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
      className: i.className.slice(0,100), value: i.value,
      'aria-label': i.getAttribute('aria-label'),
      'v-model': i.getAttribute('v-model'),
      disabled: i.disabled
    })),
    buttons: buttons.map(b => ({
      type: b.type, text: b.textContent.trim().slice(0,50),
      className: b.className.slice(0,100),
      disabled: b.disabled
    })),
    forms: forms.map(f => ({
      action: f.action, method: f.method,
      className: f.className.slice(0,100)
    }))
  };
})()`);

console.log('\n=== Page Info ===');
console.log('URL:', formInfo.url);
console.log('Title:', formInfo.title);
console.log('\n=== Inputs ===');
formInfo.inputs.forEach((i, n) => console.log(`[${n}]`, JSON.stringify(i)));
console.log('\n=== Buttons ===');
formInfo.buttons.forEach((b, n) => console.log(`[${n}]`, JSON.stringify(b)));
console.log('\n=== Forms ===');
formInfo.forms.forEach((f, n) => console.log(`[${n}]`, JSON.stringify(f)));
console.log('\n=== Body HTML (first 2000 chars) ===');
console.log(formInfo.bodyHTML);

cdp.close();
