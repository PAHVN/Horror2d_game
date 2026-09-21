// ==================== HORROR 2D — MULTIPLAYER SERVER ====================
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3000;

// ==================== HTTP SERVER ====================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0];
  const fullPath = path.join(__dirname, 'public', filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ server });

const players = new Map();  // id -> { x, y, dir, ws }
const sharedState = {
  doorLocked: false,
  breakerOn: true,
};

let nextId = 1;

// Spawn player tại vị trí ngẫu nhiên quanh nhà
function pickSpawn() {
  return {
    x: 700 + Math.random() * 200,
    y: 600 + Math.random() * 200,
    dir: 0,
  };
}

wss.on('connection', (ws) => {
  const id = 'P' + nextId++;
  const sp = pickSpawn();
const player = {
  id,
  x: sp.x,
  y: sp.y,
  dir: sp.dir,
  name: id,           // ← mặc định = id
  ws,
};
  players.set(id, player);

  console.log(`[+] ${id} joined (total: ${players.size})`);

  // Gửi welcome cho client mới
ws.send(JSON.stringify({
  type: 'welcome',
  id,
  state: sharedState,
  players: Object.fromEntries(
    [...players.entries()].map(([k, v]) => [k, { x: v.x, y: v.y, dir: v.dir, name: v.name || k }])
  ),
}));

  // Broadcast player mới cho người khác
broadcast({
  type: 'playerJoined',
  id,
  player: { x: player.x, y: player.y, dir: player.dir, name: player.name || id },
}, id);

  // Nhận message từ client
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const p = players.get(id);
      if (!p) return;

      switch (data.type) {
case 'input':
  p.x = data.x;
  p.y = data.y;
  p.dir = data.dir;
  if (data.name) p.name = data.name;
  break;

        case 'doorToggle':
          sharedState.doorLocked = !!data.locked;
          broadcast({ type: 'doorState', locked: sharedState.doorLocked });
          break;

        case 'breakerToggle':
          sharedState.breakerOn = !!data.on;
          broadcast({ type: 'breakerState', on: sharedState.breakerOn });
          break;
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    players.delete(id);
    console.log(`[-] ${id} left (total: ${players.size})`);
    broadcast({ type: 'playerLeft', id });
  });
});

// Broadcast state mỗi 50ms (20 FPS)
setInterval(() => {
  if (players.size === 0) return;
  const state = Object.fromEntries(
    [...players.entries()].map(([k, v]) => [k, { x: v.x, y: v.y, dir: v.dir, name: v.name || k }])
  );
  broadcast({ type: 'state', players: state });
}, 50);

function broadcast(msg, exceptId = null) {
  const str = JSON.stringify(msg);
  for (const [id, p] of players.entries()) {
    if (id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(str);
    }
  }
}

// ==================== START ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Horror 2D — Multiplayer Server`);
  console.log(`   Local:  http://localhost:${PORT}`);
  console.log(`   LAN:    http://192.168.1.253:${PORT}`);
  console.log(`   Nhấn Ctrl+C để dừng`);
});
