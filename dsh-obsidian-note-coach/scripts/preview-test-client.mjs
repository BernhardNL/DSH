/**
 * Test client: connects the browser mux stream and auto-answers approval
 * requests with 'allowed-once', so the note-coach judge tool can complete its
 * note-insertion branch end-to-end (curl cannot, since approvals arrive as
 * server-request frames on the downstream WebSocket).
 */
const WS_URL = 'ws://127.0.0.1:3199/api/events.mux';
const API = 'http://127.0.0.1:3199';

const ws = new WebSocket(WS_URL);
let answered = 0;

function post(path, body) {
  return fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

function rpc(method, payload) {
  return post('/api/' + method, {
    type: 'client-request',
    rpcId: 'auto-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    method,
    payload,
  });
}

ws.addEventListener('open', () => console.log('[mux] connected (passive)'));

ws.addEventListener('message', async (event) => {
  let msg;
  try {
    msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
  } catch {
    return;
  }
  console.log('[mux frame]', JSON.stringify(msg).slice(0, 400));
  if (msg.type === 'server-request') {
    const method = msg.method;
    if (method === 'approval/requested') {
      const payload = msg.payload ?? {};
      const approvalId = payload.approvalId ?? payload.approval?.approvalId;
      const sessionId = payload.sessionId ?? payload.approval?.sessionId;
      const outcome = 'allowed-once';
      answered++;
      console.log(`[approval] answering ${outcome} for ${approvalId} (rpcId ${msg.rpcId})`);
      const resp = await post('/api/respond', {
        type: 'client-response',
        rpcId: msg.rpcId,
        result: { ok: true, value: { sessionId, approvalId, outcome } },
      });
      console.log('[respond]', JSON.stringify(resp).slice(0, 200));
    } else if (method === 'question/requested') {
      const payload = msg.payload ?? {};
      const sessionId = payload.sessionId;
      const questions = payload.questions ?? [];
      if (questions.length) {
        for (const q of questions) {
          console.log('[question detail]', JSON.stringify(q.detail ?? '').slice(0, 600));
        }
        answered++;
        const answer = {
          answers: questions.map((q) => ({
            id: q.id,
            selected: q.options?.[0] ? [q.options[0].label] : [],
          })),
        };
        console.log(`[question] answering ${questions.length} question(s) (rpcId ${msg.rpcId})`);
        const resp = await post('/api/respond', {
          type: 'client-response',
          rpcId: msg.rpcId,
          result: { ok: true, value: { sessionId, answer } },
        });
        console.log('[respond]', JSON.stringify(resp).slice(0, 200));
      }
    } else {
      console.log(`[server-request] ${method} (unhandled)`);
    }
  }
});

ws.addEventListener('error', (e) => console.error('[mux error]', e.message ?? String(e)));
ws.addEventListener('close', () => console.log('[mux closed]'));

setTimeout(() => {
  console.log(`[done] answered=${answered}`);
  process.exit(0);
}, 150000);
