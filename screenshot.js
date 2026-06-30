const WebSocket = require('ws');
const PAGE_WS = 'ws://localhost:9222/devtools/page/16071137242AD51C82F7467B2EB28D05';
const fs = require('fs');
const path = require('path');
const savePath = path.resolve('E:/Clark_agent/fistest-screenshot.jpg');
console.log('Will save to:', savePath);

const ws = new WebSocket(PAGE_WS);
let msgId = 0;
const pending = {};

ws.on('open', async () => {
  const id = ++msgId;
  pending[id] = (r) => {
    if (r.result && r.result.data) {
      const buf = Buffer.from(r.result.data, 'base64');
      fs.writeFileSync(savePath, buf);
      console.log('Saved! Size:', buf.length, 'bytes');
    } else {
      console.log('No data in response');
    }
    ws.close();
  };
  ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: 80 } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
});
ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
