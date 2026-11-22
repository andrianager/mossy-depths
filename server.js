// Mossy Depths multiplayer relay: serves the game + a WebSocket "room" like the artifact one.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, TICK_MS = 50;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 8, MAX_PER_IP = +process.env.MAX_PER_IP || 4, MAX_ROOMS = 200, MAX_CONN = 400;
const ipCount = new Map(); let totalConn = 0;
// Only known presence fields with safe types are accepted (strangers can't break other players' games).
const num = (lo, hi) => v => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : undefined;
const int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
const str = re => v => typeof v === 'string' && re.test(v) ? v : undefined;
const col = v => v === null || (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : undefined;
const nullable = f => v => v === null ? null : f(v);
const SCHEMA = {
  g: int(0, 1), lb: int(0, 1), dg: int(0, 1), bm: int(0, 1), mv: int(0, 1), wb: int(0, 1), wr: int(0, 9), dp: int(0, 99),
  x: num(-1e5, 1e5), y: num(-1e5, 1e5), an: num(-1e6, 1e6), f: v => (v === 1 || v === -1 ? v : undefined),
  n: str(/^[\w \-]{0,14}$/), cls: str(/^(none|sw|mg|as)$/), wk: nullable(str(/^[A-Za-z]{1,20}$/)), ak: nullable(str(/^[A-Za-z]{1,20}$/)),
  wc: col, ac: col, pid: nullable(str(/^[a-z0-9]{1,20}$/)),
  iv: v => Array.isArray(v) && v.length <= 6 && v.every(x => typeof x === 'string' && /^[a-z0-9]{1,20}$/.test(x)) ? v : undefined,
  ivn: int(0, 1e9), gn: int(0, 1e9), gs: int(0, 2147483647),
};
const rooms = new Map(); // code -> Map(id -> {ws, p, rate})
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

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
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (totalConn >= MAX_CONN || (ipCount.get(ip) || 0) >= MAX_PER_IP) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1); totalConn++;
  let released = false; const release = () => { if (released) return; released = true; totalConn--; const n = (ipCount.get(ip) || 1) - 1; n ? ipCount.set(ip, n) : ipCount.delete(ip); };
  ws.on('close', release);
  const q = new URL(req.url, 'http://x').searchParams;
  let code = String(q.get('room') || 'lobby').toLowerCase();
  if (!/^[a-z0-9_-]{1,24}$/.test(code)) code = 'lobby';
  if (code === 'lobby') { // public lobby: fill lobby, lobby-2, lobby-3 ...
    let n = 1; while (n < 100 && (rooms.get(n === 1 ? 'lobby' : 'lobby-' + n) || { size: 0 }).size >= MAX_PLAYERS) n++;
    code = n === 1 ? 'lobby' : 'lobby-' + n;
  }
  let room = rooms.get(code);
  if (!room && rooms.size >= MAX_ROOMS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
  if (!room) rooms.set(code, room = new Map());
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
      if (!Object.prototype.hasOwnProperty.call(SCHEMA, k)) continue;
      const v = SCHEMA[k](m.d[k]);
      if (v === undefined) continue;
      if (v === null) delete next[k]; else next[k] = v;
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
