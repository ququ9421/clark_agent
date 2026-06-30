---
name: perf-test-generator
description: 为 AI 应用生成 k6 性能测试脚本，支持 AI Streaming 专属指标（TTFT、Stream Throughput、WebSocket 重连等）。输入 API endpoint + 请求模板 + SLA，输出可执行的 k6 脚本 + 基线配置，支持 PR 级退化检测（>10% 告警）。
version: 1.0.0
allowed_tools: [Read, Write, Bash, Grep, Glob]
---

# Perf Test Generator Skill

> **核心能力**：为 AI 应用生成 k6 性能测试脚本，支持 AI Streaming 专属指标（TTFT、Stream Throughput、WebSocket 重连等）。
> 输入 API endpoint + 请求模板 + 性能 SLA，输出可执行的 k6 脚本 + 基线配置。

---

## 适用场景

当目标项目需要性能测试，特别是：
- AI Streaming 应用的延迟和吞吐量测试
- REST API 的并发和响应时间测试
- WebSocket / SSE 长连接的稳定性测试
- PR 级性能回归检测（与 Git 中的 baseline 对比，退化 > 10% 告警）

---

## AI Streaming 专属指标

| 指标 | 说明 | 典型 SLA |
|------|------|----------|
| **TTFT** (Time To First Token) | 首 Token 延迟，用户感知的"开始响应"时间 | P95 < 2s |
| **Stream Throughput** | 流式输出吞吐量（tokens/sec） | P50 > 30 tok/s |
| **WebSocket 重连** | 连接断开后重连成功时间 | P95 < 3s |
| **SSE Keep-alive** | 长连接保活成功率 | > 99.5% |
| **Concurrent Users** | 并发用户数下的系统稳定性 | 50 并发无错误 |

---

## 输入参数

### 必需参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `endpoint` | API endpoint URL 或路径 | `/api/chat/stream` |
| `method` | HTTP 方法 | `POST` |
| `requestTemplate` | 请求体模板（JSON） | `{ "message": "hello", "stream": true }` |

### 可选参数（SLA 配置）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `p95Latency` | `2000` | P95 延迟上限（ms） |
| `maxConcurrent` | `50` | 最大并发用户数 |
| `errorRateLimit` | `0.01` | 错误率上限（1%） |
| `duration` | `"2m"` | 测试持续时间 |
| `ttftThreshold` | `2000` | TTFT P95 上限（ms），仅 streaming 场景 |
| `throughputMin` | `20` | 最低流式吞吐量（tokens/sec），仅 streaming 场景 |

---

## 工作流

### Step 1：分析 API Endpoint 类型

```
读取 endpoint 信息，判断类型：
  - REST API（标准 HTTP 请求/响应）
  - SSE（Server-Sent Events，流式响应，Content-Type: text/event-stream）
  - WebSocket（长连接双向通信，ws:// 或 wss://）

判断依据：
  - URL schema (ws:// / wss://) → WebSocket
  - 响应 Content-Type 或请求中 stream: true → SSE
  - 其他 → REST
```

### Step 2：生成 k6 测试脚本

根据 endpoint 类型选择对应模板（见下方四个模板），生成 k6 脚本。

**负载阶段配置**（ramp-up → sustain → ramp-down）：

```javascript
export const options = {
  stages: [
    { duration: '30s', target: maxConcurrent },     // ramp-up
    { duration: duration,  target: maxConcurrent },  // sustain
    { duration: '10s', target: 0 },                  // ramp-down
  ],
  thresholds: {
    http_req_duration: [`p(95)<${p95Latency}`],
    http_req_failed: [`rate<${errorRateLimit}`],
    // streaming 场景额外指标
    ttft: [`p(95)<${ttftThreshold}`],
    stream_throughput: [`avg>${throughputMin}`],
  },
};
```

### Step 3：设置 Threshold 告警门禁

将 SLA 参数写入 k6 thresholds，执行时自动判定 pass/fail：
- `http_req_duration` → P95 延迟
- `http_req_failed` → 错误率
- 自定义 Trend/Rate → TTFT、throughput、reconnect time

### Step 4：生成基线配置

首次运行后将结果写入 `tests/perf/baseline.json`，后续运行与基线对比：
- 退化 > 10% → 告警（PR comment / CLI 输出）
- 改善 > 10% → 建议更新基线

---

## 输出文件

| 文件 | 路径 | 说明 |
|------|------|------|
| k6 脚本 | `tests/perf/{feature}.k6.js` | 可直接 `k6 run` 执行 |
| 基线配置 | `tests/perf/baseline.json` | 性能指标基线，用于 PR 级对比 |
| 结果报告 | `tests/perf/results/{feature}-{timestamp}.json` | k6 JSON 输出 |

---

## k6 脚本模板

### 模板 1：HTTP API 性能测试

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const reqDuration = new Trend('req_duration');
const reqFailed = new Rate('req_failed');

export const options = {
  stages: [
    { duration: '30s', target: __ENV.CONCURRENT || 50 },
    { duration: __ENV.DURATION || '2m', target: __ENV.CONCURRENT || 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    req_duration: ['p(95)<2000'],
    req_failed: ['rate<0.01'],
  },
};

export default function () {
  const url = `${__ENV.BASE_URL}${__ENV.ENDPOINT}`;
  const payload = JSON.stringify(/* requestTemplate */);
  const params = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 2s': (r) => r.timings.duration < 2000,
  });

  reqDuration.add(res.timings.duration);
  reqFailed.add(res.status !== 200);

  sleep(1);
}
```

### 模板 2：SSE/Streaming 响应测试

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const ttft = new Trend('ttft');
const streamThroughput = new Trend('stream_throughput');
const streamErrors = new Rate('stream_errors');
const totalTokens = new Counter('total_tokens');

export const options = {
  stages: [
    { duration: '30s', target: __ENV.CONCURRENT || 20 },
    { duration: __ENV.DURATION || '2m', target: __ENV.CONCURRENT || 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    ttft: ['p(95)<2000'],
    stream_throughput: ['avg>20'],
    stream_errors: ['rate<0.01'],
  },
};

export default function () {
  const url = `${__ENV.BASE_URL}${__ENV.ENDPOINT}`;
  const payload = JSON.stringify(/* requestTemplate with stream: true */);
  const params = {
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    responseType: 'text',
  };

  const res = http.post(url, payload, params);

  // 解析 SSE 响应，测量 TTFT 和吞吐量
  const body = res.body || '';
  const lines = body.split('\n').filter(l => l.startsWith('data:'));
  const firstTokenTime = lines.length > 0 ? res.timings.waiting : res.timings.duration;
  const tokenCount = lines.length;
  const elapsed = res.timings.duration / 1000; // 秒

  ttft.add(firstTokenTime);
  streamThroughput.add(tokenCount / Math.max(elapsed, 0.001));
  totalTokens.add(tokenCount);
  streamErrors.add(res.status !== 200);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'received tokens': () => tokenCount > 0,
    'TTFT < 2s': () => firstTokenTime < 2000,
  });
}
```

### 模板 3：WebSocket 长连接测试

```javascript
import ws from 'k6/ws';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const connectTime = new Trend('ws_connect_time');
const reconnectTime = new Trend('ws_reconnect_time');
const messageThroughput = new Trend('ws_message_throughput');
const connectionErrors = new Rate('ws_connection_errors');
const messagesReceived = new Counter('ws_messages_received');

export const options = {
  stages: [
    { duration: '30s', target: __ENV.CONCURRENT || 30 },
    { duration: __ENV.DURATION || '2m', target: __ENV.CONCURRENT || 30 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    ws_connect_time: ['p(95)<1000'],
    ws_reconnect_time: ['p(95)<3000'],
    ws_connection_errors: ['rate<0.01'],
  },
};

export default function () {
  const url = `${__ENV.WS_URL}${__ENV.ENDPOINT}`;
  const startConnect = Date.now();

  const res = ws.connect(url, {}, function (socket) {
    connectTime.add(Date.now() - startConnect);

    socket.on('open', () => {
      socket.send(JSON.stringify(/* requestTemplate */));
    });

    let msgCount = 0;
    const msgStart = Date.now();

    socket.on('message', (data) => {
      msgCount++;
      messagesReceived.add(1);
    });

    socket.on('close', () => {
      const elapsed = (Date.now() - msgStart) / 1000;
      messageThroughput.add(msgCount / Math.max(elapsed, 0.001));
    });

    socket.on('error', (e) => {
      connectionErrors.add(1);
    });

    // 保持连接直到测试时间结束
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  check(res, { 'WebSocket status is 101': (r) => r && r.status === 101 });
}
```

### 模板 4：混合场景（模拟真实用户行为）

```javascript
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const ttft = new Trend('ttft');
const apiLatency = new Trend('api_latency');
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 30 },
        { duration: '2m', target: 30 },
        { duration: '10s', target: 0 },
      ],
      exec: 'browseScenario',
    },
    chat: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 10 },
        { duration: '10s', target: 0 },
      ],
      exec: 'chatScenario',
    },
  },
  thresholds: {
    api_latency: ['p(95)<1000'],
    ttft: ['p(95)<2000'],
    error_rate: ['rate<0.01'],
  },
};

// 场景 1: 浏览（REST API）
export function browseScenario() {
  group('page_load', () => {
    const res = http.get(`${__ENV.BASE_URL}/api/tasks`);
    apiLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    check(res, { 'tasks loaded': (r) => r.status === 200 });
  });
  sleep(Math.random() * 3 + 1); // 思考时间 1-4s
}

// 场景 2: AI 对话/Streaming（SSE）
export function chatScenario() {
  group('chat_stream', () => {
    const payload = JSON.stringify({ message: 'test prompt', stream: true });
    const params = {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'text',
    };
    const res = http.post(`${__ENV.BASE_URL}/api/chat/stream`, payload, params);
    ttft.add(res.timings.waiting);
    errorRate.add(res.status !== 200);
    check(res, { 'stream started': (r) => r.status === 200 });
  });
  sleep(Math.random() * 5 + 3); // 思考时间 3-8s（阅读 AI 回复）
}
```

---

## 基线对比规则

### baseline.json 结构

```json
{
  "_updatedAt": "2026-06-30T00:00:00Z",
  "_commit": "abc1234",
  "endpoints": {
    "/api/chat/stream": {
      "type": "sse",
      "metrics": {
        "ttft_p95": 1200,
        "stream_throughput_avg": 35,
        "http_req_duration_p95": 3500,
        "error_rate": 0.002
      }
    }
  }
}
```

### 对比逻辑

```
对于每个指标：
  degradation = (current - baseline) / baseline * 100

  if degradation > 10%:
    → 告警："{metric} 退化 {degradation}%（基线: {baseline}, 当前: {current}）"
  if degradation < -10%:
    → 改善：建议更新基线（`k6 run --out json=... && node update-baseline.js`）
  else:
    → 稳定：无需操作
```

---

## 新项目接入流程

1. 确定要测试的 API endpoint 和类型（REST / SSE / WebSocket）
2. 准备请求模板（JSON body）
3. 定义 SLA（P95 延迟、并发数、错误率上限）
4. 调用本 Skill → 自动生成 k6 脚本
5. 首次运行建立基线 → 后续 PR 自动对比

## 执行命令速查

```bash
# 单次执行（建立基线）
k6 run tests/perf/{feature}.k6.js \
  -e BASE_URL=http://localhost:3000 \
  -e ENDPOINT=/api/chat/stream \
  --out json=tests/perf/results/{feature}-$(date +%s).json

# CI 执行（与基线对比）
k6 run tests/perf/{feature}.k6.js \
  -e BASE_URL=$APP_URL \
  -e ENDPOINT=/api/chat/stream \
  --thresholds-out=tests/perf/results/thresholds.json
```
