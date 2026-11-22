// Mossy Depths multiplayer relay: serves the game + a WebSocket "room" like the artifact one.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, MAX_PLAYERS = 8, TICK_MS = 50;
const rooms = new Map(); // code -> Map(id -> {ws, p, rate})
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  if (url === '/' || url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, d) => {
      if (e) { res.writeHead(500); res.end('missing public/index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(d);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  let code = String(q.get('room') || 'lobby').toLowerCase();
  if (!/^[a-z0-9_-]{1,24}$/.test(code)) code = 'lobby';
  let room = rooms.get(code); if (!room) rooms.set(code, room = new Map());
  if (room.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
  const id = rid(), me = { ws, p: {}, n: 0, t0: Date.now(), alive: true };
  room.set(id, me); room.dirty = true;
  ws.send(JSON.stringify({ t: 'hi', id }));
  ws.on('pong', () => { me.alive = true; });
  ws.on('message', (raw) => {
    const now = Date.now(); if (now - me.t0 > 1000) { me.t0 = now; me.n = 0; } if (++me.n > 60) return; // 60 msgs/sec max
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || m.t !== 'p' || typeof m.d !== 'object' || !m.d) return;
    const next = Object.assign({}, me.p);
    for (const k of Object.keys(m.d)) {
      if (!KEY.test(k)) continue;
      if (m.d[k] === null) delete next[k]; else next[k] = m.d[k];
    }
    if (Buffer.byteLength(JSON.stringify(next)) > 4096) return; // presence size cap
    me.p = next; room.dirty = true;
  });
  ws.on('close', () => { room.delete(id); room.dirty = true; if (!room.size) rooms.delete(code); });
  ws.on('error', () => {});
});

setInterval(() => { // 20 snapshots/sec, only for rooms that changed
  for (const room of rooms.values()) {
    if (!room.dirty) continue; room.dirty = false;
    const peers = []; for (const [id, c] of room) peers.push({ id, p: c.p });
    const msg = JSON.stringify({ t: 's', peers });
    for (const c of room.values()) if (c.ws.readyState === 1) c.ws.send(msg);
  }
}, TICK_MS);
setInterval(() => { // drop dead connections
  for (const room of rooms.values()) for (const c of room.values()) {
    if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch (e) {}
  }
}, 20000);

server.listen(PORT, () => console.log('Mossy Depths server on port ' + PORT));
