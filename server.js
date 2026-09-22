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
// ==================== MAP (dùng cho A*) ====================
const TILE = 32;
const MAP_W = 60;
const MAP_H = 50;

// Nhà + chồi (giống client)
const HOUSE = {
  x: Math.floor(MAP_W / 2) - 5,
  y: Math.floor(MAP_H / 2) - 4,
  w: 10, h: 8,
};
const MID_Y = HOUSE.y + Math.floor(HOUSE.h / 2);
const DOOR_MID_X = HOUSE.x + 3;
const DOOR_MAIN_X = HOUSE.x + 6;

const SHED = { w: 3, h: 3 };
let shedX = 0, shedY = 0;
{
  const gap = 5;
  const houseCx = HOUSE.x + HOUSE.w / 2;
  shedX = Math.round(houseCx - SHED.w / 2);
  shedY = HOUSE.y + HOUSE.h + gap;
  shedX = Math.max(2, Math.min(MAP_W - SHED.w - 2, shedX));
  shedY = Math.max(2, Math.min(MAP_H - SHED.h - 2, shedY));
}
const shedDoor = { gx: shedX + 1, gy: shedY };
const breakerPos = { gx: shedX + 1, gy: shedY + 1 };

function isHouseWall(gx, gy) {
  if (gx < HOUSE.x || gx >= HOUSE.x + HOUSE.w) return false;
  if (gy < HOUSE.y || gy >= HOUSE.y + HOUSE.h) return false;
  const isLeft   = gx === HOUSE.x;
  const isRight  = gx === HOUSE.x + HOUSE.w - 1;
  const isTop    = gy === HOUSE.y;
  const isBottom = gy === HOUSE.y + HOUSE.h - 1;
  if (isLeft || isRight || isTop || isBottom) {
    if (isTop && gx === DOOR_MAIN_X) return false;
    return true;
  }
  if (gy === MID_Y) {
    if (gx === DOOR_MID_X) return sharedState.doorLocked;
    return true;
  }
  return false;
}

function isShedWall(gx, gy) {
  if (gx < shedX || gx >= shedX + SHED.w) return false;
  if (gy < shedY || gy >= shedY + SHED.h) return false;
  const isLeft   = gx === shedX;
  const isRight  = gx === shedX + SHED.w - 1;
  const isTop    = gy === shedY;
  const isBottom = gy === shedY + SHED.h - 1;
  if (isLeft || isRight || isTop || isBottom) {
    if (gx === shedDoor.gx && gy === shedDoor.gy) return false;
    return true;
  }
  return false;
}

function isWall(gx, gy) {
  return isHouseWall(gx, gy) || isShedWall(gx, gy);
}

const furniture = [
  { gx: HOUSE.x + 4, gy: HOUSE.y + 2, gw: 3, gh: 1, solid: true },
  { gx: HOUSE.x + 3, gy: HOUSE.y + 2, gw: 1, gh: 1, solid: true },
  { gx: HOUSE.x + 7, gy: HOUSE.y + 2, gw: 1, gh: 1, solid: true },
  { gx: HOUSE.x + 6, gy: HOUSE.y + 6, gw: 2, gh: 1, solid: true },
];

function isFurniture(gx, gy) {
  for (const f of furniture) {
    if (!f.solid) continue;
    if (gx >= f.gx && gx < f.gx + f.gw &&
        gy >= f.gy && gy < f.gy + f.gh) return true;
  }
  return false;
}

function isInsideHouse(gx, gy) {
  return gx >= HOUSE.x && gx < HOUSE.x + HOUSE.w &&
         gy >= HOUSE.y && gy < HOUSE.y + HOUSE.h;
}

function isInsideShed(gx, gy) {
  return gx >= shedX && gx < shedX + SHED.w &&
         gy >= shedY && gy < shedY + SHED.h;
}

function isBlocked(px, py, r) {
  const pts = [
    [px - r, py], [px + r, py], [px, py - r], [px, py + r],
    [px - r*0.7, py - r*0.7], [px + r*0.7, py - r*0.7],
    [px - r*0.7, py + r*0.7], [px + r*0.7, py + r*0.7],
  ];
  for (const [cx, cy] of pts) {
    const gx = Math.floor(cx / TILE), gy = Math.floor(cy / TILE);
    if (gx < 0 || gx >= MAP_W || gy < 0 || gy >= MAP_H) return true;
    if (isWall(gx, gy)) return true;
    if (isFurniture(gx, gy)) return true;
  }
  return false;
}

// ==================== A* PATHFINDING ====================
function heuristic(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function findPath(startGx, startGy, goalGx, goalGy) {
  if (isWall(goalGx, goalGy) || isFurniture(goalGx, goalGy)) {
    const alt = findNearestFreeCell(goalGx, goalGy);
    if (!alt) return [];
    goalGx = alt.gx;
    goalGy = alt.gy;
  }
  if (startGx === goalGx && startGy === goalGy) return [];

  const MAX_NODES = 500;
  const open = [];
  const closed = new Set();
  const key = (x, y) => x + ',' + y;

  const startNode = {
    gx: startGx, gy: startGy,
    g: 0,
    f: heuristic(startGx, startGy, goalGx, goalGy),
    parent: null,
  };
  open.push(startNode);
  let nodesExplored = 0;

  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  while (open.length > 0 && nodesExplored < MAX_NODES) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    nodesExplored++;

    const ck = key(current.gx, current.gy);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (current.gx === goalGx && current.gy === goalGy) {
      const path = [];
      let n = current;
      while (n && n.parent !== null) {
        path.unshift({ gx: n.gx, gy: n.gy });
        n = n.parent;
      }
      return path;
    }

    for (const [dx, dy, cost] of DIRS) {
      const nx = current.gx + dx;
      const ny = current.gy + dy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      if (isWall(nx, ny)) continue;
      if (isFurniture(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (isWall(current.gx + dx, current.gy)) continue;
        if (isWall(current.gx, current.gy + dy)) continue;
      }
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const tentativeG = current.g + cost;
      const existing = open.find(n => n.gx === nx && n.gy === ny);
      if (!existing) {
        open.push({
          gx: nx, gy: ny,
          g: tentativeG,
          f: tentativeG + heuristic(nx, ny, goalGx, goalGy),
          parent: current,
        });
      } else if (tentativeG < existing.g) {
        existing.g = tentativeG;
        existing.f = tentativeG + heuristic(nx, ny, goalGx, goalGy);
        existing.parent = current;
      }
    }
  }
  return [];
}

function findNearestFreeCell(gx, gy) {
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
        if (isWall(nx, ny) || isFurniture(nx, ny)) continue;
        return { gx: nx, gy: ny };
      }
    }
  }
  return null;
}

// ==================== LINE OF SIGHT ====================
function lineOfSight(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  const nx = dx / dist, ny = dy / dist;
  const step = 6;
  let travelled = 0;
  while (travelled < dist) {
    travelled += step;
    const x = x1 + nx * travelled;
    const y = y1 + ny * travelled;
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    if (gx < 0 || gx >= MAP_W || gy < 0 || gy >= MAP_H) return false;
    if (isWall(gx, gy)) return false;
    if (isFurniture(gx, gy)) return false;
  }
  return true;
}

// ==================== KILLER OBJECT ====================
const KILLER_AI = {
  investigateInterval: 30000,
  investigateChance: 0.30,
  sabotageChance: 0.20,
  checkRoomDuration: 3000,
  doorWaitDuration: 2000,
  giveUpDuration: 5000,
  respawnDelay: 5000,      // 5s respawn
};

const WAYPOINTS = {
  room1:      { gx: HOUSE.x + 5, gy: HOUSE.y + 4 },
  room2:      { gx: HOUSE.x + 5, gy: HOUSE.y + 6 },
  doorIn:     { gx: DOOR_MAIN_X, gy: HOUSE.y + 1 },
  doorMidIn:  { gx: DOOR_MID_X,  gy: MID_Y + 1 },
  breaker:    { gx: breakerPos.gx, gy: breakerPos.gy },
};

// Killer object (chạy trên server)
function createKiller() {
  const sp = pickKillerSpawn();
  return {
    x: sp.x, y: sp.y,
    r: 12,
    dir: 0,
    wanderSpeed: 4.2 * 0.80,
    chaseSpeed:  4.2 * 1.10,
    state: 'WANDER',
    stateTimer: 0,
    stateStep: 0,
    target: { x: sp.x, y: sp.y },
    targetPlayerId: null,
    lastSeen: 0,
    visionRange: 8 * TILE,
    stuckTimer: 0,
    path: [],
    pathIndex: 0,
    pathRecalcTimer: 0,
    investigateTimer: KILLER_AI.investigateInterval,
    doorWaitTimer: 0,
    roomCheckTimer: 0,
    // Stun state
    stunState: 'NORMAL',
    stunTimer: 0,
    immuneTimer: 0,
    slowActive: false,
    lightCount: 0,
  };
}

function pickKillerSpawn() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const gx = 2 + Math.floor(Math.random() * (MAP_W - 4));
    const gy = 2 + Math.floor(Math.random() * (MAP_H - 4));
    if (isInsideHouse(gx, gy)) continue;
    if (isInsideShed(gx, gy)) continue;
    if (isWall(gx, gy)) continue;
    if (isFurniture(gx, gy)) continue;
    return { x: gx * TILE + TILE / 2, y: gy * TILE + TILE / 2 };
  }
  return { x: 2 * TILE, y: 2 * TILE };
}

function pickWanderTarget() {
  const MIN_DIST = TILE * 3;   // cách killer ít nhất 3 ô
  for (let attempt = 0; attempt < 50; attempt++) {
    const gx = 2 + Math.floor(Math.random() * (MAP_W - 4));
    const gy = 2 + Math.floor(Math.random() * (MAP_H - 4));
    if (isInsideHouse(gx, gy)) continue;
    if (isInsideShed(gx, gy)) continue;
    if (isWall(gx, gy)) continue;
    if (isFurniture(gx, gy)) continue;

    const wx = gx * TILE + TILE / 2;
    const wy = gy * TILE + TILE / 2;
    const d = Math.hypot(wx - killer.x, wy - killer.y);
    if (d < MIN_DIST) continue;   // quá gần → thử lại

    return { x: wx, y: wy };
  }
  // Fallback: cách killer 4 ô về hướng ngẫu nhiên
  const angle = Math.random() * Math.PI * 2;
  return {
    x: killer.x + Math.cos(angle) * TILE * 4,
    y: killer.y + Math.sin(angle) * TILE * 4,
  };
}

let killer = createKiller();
// ==================== FLASHLIGHT STUN ====================
// Cơ chế: nhiều đèn chiếu vào killer → chói mắt
const STUN_CONFIG = {
  slowThreshold: 3,      // 3 đèn → chậm
  stunThreshold: 4,      // 4 đèn → choáng 3s
  fleeThreshold: 5,      // 5+ đèn → bỏ chạy
  stunDuration: 3000,    // 3s choáng
  immuneDuration: 5000,  // 5s miễn nhiễm
  fleeDuration: 5000,    // 5s bỏ chạy
  slowFactor: 0.8,       // 80% speed (chậm 20%)
  coneRange: 10 * TILE,  // 10 ô (giống client)
  coneHalfAngle: Math.PI / 6,  // 30° mỗi bên
};

// Kiểm tra killer có nằm trong hình nón đèn của player không
function isKillerInFlashlightCone(p, killer) {
  if (!p.equipped || p.equipped !== 'flashlight') return false;
  if (!p.flashlightOn) return false;
  if (p.dead) return false;

  const dx = killer.x - p.x;
  const dy = killer.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist > STUN_CONFIG.coneRange) return false;

  // Góc giữa hướng player và hướng tới killer
  const angleToKiller = Math.atan2(dy, dx);
  let angleDiff = angleToKiller - p.dir;
  // Chuẩn hóa góc về [-π, π]
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  if (Math.abs(angleDiff) > STUN_CONFIG.coneHalfAngle) return false;

  // Check có tường chắn không
  if (!lineOfSight(p.x, p.y, killer.x, killer.y)) return false;

  return true;
}

// Đếm số đèn đang chiếu vào killer
function countFlashlightsOnKiller() {
  let count = 0;
  for (const [id, p] of players.entries()) {
    if (isKillerInFlashlightCone(p, killer)) count++;
  }
  return count;
}


// Cập nhật trạng thái stun mỗi frame
function updateFlashlightStun(dt) {
  // SAFETY: Nếu state không phải NORMAL mà timer = 0 → reset
  if ((killer.stunState === 'STUNNED' || killer.stunState === 'FLEEING') 
      && killer.stunTimer <= 0) {
    console.log(`[STUN] Killer state "${killer.stunState}" with 0 timer — reset`);
    killer.stunState = 'NORMAL';
  }

  // Giảm timer
  if (killer.stunTimer > 0) {
    killer.stunTimer -= dt;
    if (killer.stunTimer <= 0) {
      killer.stunTimer = 0;
      if (killer.stunState === 'STUNNED') {
        killer.immuneTimer = STUN_CONFIG.immuneDuration;
        console.log('[STUN] Killer hết choáng — miễn nhiễm 5s');
      }
      killer.stunState = 'NORMAL';
    }
  }

  if (killer.immuneTimer > 0) {
    killer.immuneTimer -= dt;
    if (killer.immuneTimer <= 0) {
      killer.immuneTimer = 0;
      console.log('[STUN] Killer hết miễn nhiễm');
    }
  }

  // Đếm đèn
  const count = countFlashlightsOnKiller();
  killer.lightCount = count;

  // Nếu đang choáng hoặc bỏ chạy → không tính lại
  if (killer.stunState === 'STUNNED' || killer.stunState === 'FLEEING') {
    return;
  }

  // Nếu đang miễn nhiễm → bỏ qua
  if (killer.immuneTimer > 0) {
    killer.slowActive = false;
    return;
  }

  // Áp dụng hiệu ứng theo số đèn
  if (count >= STUN_CONFIG.fleeThreshold) {
    // 5+ đèn → bỏ chạy
    killer.stunState = 'FLEEING';
    killer.stunTimer = STUN_CONFIG.fleeDuration;
    killer.slowActive = false;
    console.log(`[STUN] Killer BỎ CHẠY (${count} đèn)`);
  } else if (count >= STUN_CONFIG.stunThreshold) {
    // 4 đèn → choáng 3s
    killer.stunState = 'STUNNED';
    killer.stunTimer = STUN_CONFIG.stunDuration;
    killer.slowActive = false;
    console.log(`[STUN] Killer CHOÁNG 3s (${count} đèn)`);
  } else if (count >= STUN_CONFIG.slowThreshold) {
    // 3 đèn → chậm
    killer.slowActive = true;
  } else {
    killer.slowActive = false;
  }
}

// Áp dụng hiệu ứng lên speed killer
function applyStunSpeed(speed) {
  if (killer.stunState === 'STUNNED') return 0;         // đứng im
  if (killer.stunState === 'FLEEING') return speed * 1.5; // chạy nhanh hơn
  if (killer.slowActive) return speed * STUN_CONFIG.slowFactor; // chậm 20%
  return speed;
}

// Killer bị stun → chạy ngược lại hướng player (cho FLEEING)
function getFleeDirection() {
  // Tìm player gần nhất
  let nearest = null;
  let minDist = Infinity;
  for (const [id, p] of players.entries()) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - killer.x, p.y - killer.y);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  }
  if (!nearest) return { x: killer.x, y: killer.y };

  // Chạy ngược lại + sang ngang
  const dx = killer.x - nearest.x;
  const dy = killer.y - nearest.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: killer.x, y: killer.y };

  const nx = dx / dist;
  const ny = dy / dist;
  return {
    x: killer.x + nx * 100,
    y: killer.y + ny * 100,
  };
}

console.log('[STUN] Flashlight Stun system initialized');

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({ server });
// ==================== KILLER AI UPDATE ====================
function setKillerState(newState, target = null) {
  killer.state = newState;
  killer.stateTimer = 0;
  killer.stateStep = 0;
  killer.path = [];
  killer.pathIndex = 0;
  killer.pathRecalcTimer = 0;
  if (target) {
    killer.target.x = target.x;
    killer.target.y = target.y;
  }
}

function updateKillerPath() {
  const startGx = Math.floor(killer.x / TILE);
  const startGy = Math.floor(killer.y / TILE);
  const goalGx = Math.floor(killer.target.x / TILE);
  const goalGy = Math.floor(killer.target.y / TILE);
  killer.path = findPath(startGx, startGy, goalGx, goalGy);
  killer.pathIndex = 0;
  killer.pathRecalcTimer = 500;
}

function moveKiller(dx, dy) {
  const r = killer.r;
  let moved = false;
  if (!isBlocked(killer.x + dx, killer.y, r)) { killer.x += dx; moved = true; }
  if (!isBlocked(killer.x, killer.y + dy, r)) { killer.y += dy; moved = true; }
  return moved;
}

// Tìm player để đuổi: ưu tiên trong tầm nhìn, fallback gần nhất
function pickChaseTarget() {
  let bestPlayer = null;
  let bestDist = Infinity;
  let inSight = null;
  let inSightDist = Infinity;

  for (const [id, p] of players.entries()) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - killer.x, p.y - killer.y);
    if (d > killer.visionRange) continue;
    if (!lineOfSight(killer.x, killer.y, p.x, p.y)) continue;

    // Trong tầm nhìn → ưu tiên
    if (d < inSightDist) {
      inSightDist = d;
      inSight = { id, player: p, dist: d };
    }
    // Gần nhất (dự phòng)
    if (d < bestDist) {
      bestDist = d;
      bestPlayer = { id, player: p, dist: d };
    }
  }

  return inSight || bestPlayer;
}

function updateKiller(dt) {
  if (!gameState.running) return;
  
  // DEBUG: log mỗi 2s
  if (!updateKiller._lastLog || Date.now() - updateKiller._lastLog > 2000) {
    updateKiller._lastLog = Date.now();
    console.log(`[KILLER] state=${killer.state} | pos=(${killer.x.toFixed(0)},${killer.y.toFixed(0)}) | target=(${killer.target.x.toFixed(0)},${killer.target.y.toFixed(0)}) | path=${killer.path.length} | stun=${killer.stunState}`);
  }

  // Cập nhật stun trước — có thể killer bị đứng im
  updateFlashlightStun(dt);

  // Nếu killer bị STUNNED → không update AI, không di chuyển
  if (killer.stunState === 'STUNNED') {
    return;
  }

  const now = Date.now();

  // Đếm ngược investigate
  killer.stateTimer += dt;
  killer.investigateTimer -= dt;

  // Chọn target để đuổi
  const chaseTarget = pickChaseTarget();

  if (chaseTarget) {
    killer.lastSeen = now;

    // Nếu chưa CHASE → bắt đầu
    if (killer.state !== 'CHASE') {
      setKillerState('CHASE');
      killer.targetPlayerId = chaseTarget.id;
    }

    // Nếu đã CHASE → giữ target cũ (không đổi)
    if (killer.state === 'CHASE' && killer.targetPlayerId) {
      const tp = players.get(killer.targetPlayerId);
      if (!tp || tp.dead) {
        // Target cũ chết hoặc mất → đổi target
        killer.targetPlayerId = chaseTarget.id;
      } else {
        // Target cũ còn sống → kiểm tra có thấy không
        const d = Math.hypot(tp.x - killer.x, tp.y - killer.y);
        const canStillSee = d < killer.visionRange &&
                            lineOfSight(killer.x, killer.y, tp.x, tp.y);
        if (!canStillSee) {
          // Mất dấu target cũ → đổi sang người khác
          killer.targetPlayerId = chaseTarget.id;
        }
      }
    }
  }

// Nếu FLEEING → override AI, chạy ngược hướng player
if (killer.stunState === 'FLEEING') {
  const flee = getFleeDirection();
  killer.target.x = flee.x;
  killer.target.y = flee.y;

  const ddx = flee.x - killer.x;
  const ddy = flee.y - killer.y;
  const dlen = Math.hypot(ddx, ddy);
  if (dlen > 0.5) {
    const nx = ddx / dlen;
    const ny = ddy / dlen;
    // Chạy nhanh (1.5x wander)
    const speed = killer.wanderSpeed * 1.5;
    const step = speed * (dt / 16.67);
    moveKiller(nx * step, ny * step);
    killer.dir = Math.atan2(ny, nx);
  }

  // Vẫn check chạm player (dù đang bỏ chạy)
  for (const [id, p] of players.entries()) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - killer.x, p.y - killer.y);
    if (d < p.r + killer.r + 2) {
      killPlayer(id);
    }
  }
  return;  // Bỏ qua state machine + moveAlongPath
}

// State machine bình thường
switch (killer.state) {
  case 'WANDER':      updateWander(dt, chaseTarget !== null); break;
  case 'CHASE':       updateChase(dt, now); break;
  case 'GIVE_UP':     updateGiveUp(dt); break;
  case 'INVESTIGATE': updateInvestigate(dt); break;
  case 'SABOTAGE':    updateSabotage(dt); break;
}
  moveAlongPath(dt);

  // Kiểm tra killer chạm player → player chết
  for (const [id, p] of players.entries()) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - killer.x, p.y - killer.y);
    if (d < p.r + killer.r + 2) {
      killPlayer(id);
    }
  }
}

// ==================== KILLER STATES ====================
function updateWander(dt, canSee) {
  if (canSee) return;

  if (killer.investigateTimer <= 0) {
    killer.investigateTimer = KILLER_AI.investigateInterval;
    if (Math.random() < KILLER_AI.investigateChance) {
      setKillerState('INVESTIGATE');
      killer.stateStep = 0;
      killer.target.x = WAYPOINTS.doorIn.gx * TILE + TILE / 2;
      killer.target.y = WAYPOINTS.doorIn.gy * TILE + TILE / 2;
      updateKillerPath();
      return;
    }
  }

  const dToTarget = Math.hypot(killer.target.x - killer.x, killer.target.y - killer.y);
  // Nếu target gần (dưới 2 ô) hoặc path rỗng → chọn target mới
  if (dToTarget < TILE * 2) {
    const newT = pickWanderTarget();
    killer.target.x = newT.x;
    killer.target.y = newT.y;
    updateKillerPath();
    // Nếu vẫn rỗng → fallback dịch chuyển thẳng
    if (killer.path.length === 0) {
      const angle = Math.random() * Math.PI * 2;
      killer.target.x = killer.x + Math.cos(angle) * TILE * 4;
      killer.target.y = killer.y + Math.sin(angle) * TILE * 4;
      updateKillerPath();
    }
  }

  if (killer.path.length === 0) updateKillerPath();
}

function updateChase(dt, now) {
  const tp = killer.targetPlayerId ? players.get(killer.targetPlayerId) : null;

  if (!tp || tp.dead) {
    // Target mất → GIVE_UP
    setKillerState('GIVE_UP');
    killer.target.x = killer.x;
    killer.target.y = killer.y;
    return;
  }

  const dToTarget = Math.hypot(tp.x - killer.x, tp.y - killer.y);
  const canSee = dToTarget < killer.visionRange &&
                 lineOfSight(killer.x, killer.y, tp.x, tp.y);

  if (!canSee && now - killer.lastSeen > KILLER_AI.giveUpDuration) {
    setKillerState('GIVE_UP');
    killer.target.x = tp.x;
    killer.target.y = tp.y;
    killer.stateTimer = 0;
    updateKillerPath();
    return;
  }

if (canSee) {
  // Đuổi trực tiếp (không dùng A*)
  killer.target.x = tp.x;
  killer.target.y = tp.y;
  killer.path = [];
  const ddx = tp.x - killer.x;
  const ddy = tp.y - killer.y;
  const dlen = Math.hypot(ddx, ddy);
  if (dlen > 0.5) {
    const nx = ddx / dlen;
    const ny = ddy / dlen;
    // Áp dụng slow (3 đèn → chậm 20%)
    const speed = applyStunSpeed(killer.chaseSpeed);
    const step = speed * (dt / 16.67);
    moveKiller(nx * step, ny * step);
    killer.dir = Math.atan2(ny, nx);
  }
} else {
    if (killer.path.length === 0) updateKillerPath();
  }
}

function updateGiveUp(dt) {
  const dToTarget = Math.hypot(killer.target.x - killer.x, killer.target.y - killer.y);
  if (dToTarget < TILE * 0.5 || killer.stateTimer > 5000) {
    setKillerState('WANDER');
    const newT = pickWanderTarget();
    killer.target.x = newT.x;
    killer.target.y = newT.y;
    updateKillerPath();
    return;
  }
  if (killer.path.length === 0) updateKillerPath();
}

function updateInvestigate(dt) {
  const roomCheckTime = KILLER_AI.checkRoomDuration;
  const doorWaitTime = KILLER_AI.doorWaitDuration;

  if (killer.stateTimer > 15000) {
    setKillerState('WANDER');
    const newT = pickWanderTarget();
    killer.target.x = newT.x;
    killer.target.y = newT.y;
    updateKillerPath();
    return;
  }

  const moveTo = (wx, wy) => {
    killer.target.x = wx * TILE + TILE / 2;
    killer.target.y = wy * TILE + TILE / 2;
    updateKillerPath();
  };

  const nearTarget = () => {
    return Math.hypot(killer.target.x - killer.x, killer.target.y - killer.y) < TILE * 1.0;
  };

  switch (killer.stateStep) {
    case 0: moveTo(WAYPOINTS.doorIn.gx, WAYPOINTS.doorIn.gy); killer.stateStep = 1; break;
    case 1: if (nearTarget()) { moveTo(WAYPOINTS.room1.gx, WAYPOINTS.room1.gy); killer.stateStep = 2; } break;
    case 2: if (nearTarget()) { killer.roomCheckTimer = roomCheckTime; killer.stateStep = 3; } break;
    case 3:
      killer.roomCheckTimer -= dt;
      if (killer.roomCheckTimer <= 0) { moveTo(WAYPOINTS.doorMidIn.gx, WAYPOINTS.doorMidIn.gy); killer.stateStep = 4; }
      break;
    case 4:
      if (nearTarget()) {
        if (sharedState.doorLocked) { killer.doorWaitTimer = doorWaitTime; killer.stateStep = 5; }
        else { moveTo(WAYPOINTS.room2.gx, WAYPOINTS.room2.gy); killer.stateStep = 6; }
      }
      break;
    case 5:
      killer.doorWaitTimer -= dt;
      if (killer.doorWaitTimer <= 0) { moveTo(WAYPOINTS.doorIn.gx, WAYPOINTS.doorIn.gy); killer.stateStep = 7; }
      break;
    case 6: if (nearTarget()) { killer.roomCheckTimer = roomCheckTime; killer.stateStep = 8; } break;
    case 7: if (nearTarget()) killer.stateStep = 9; break;
    case 8:
      killer.roomCheckTimer -= dt;
      if (killer.roomCheckTimer <= 0) { moveTo(WAYPOINTS.doorIn.gx, WAYPOINTS.doorIn.gy); killer.stateStep = 7; }
      break;
    case 9:
      if (Math.random() < KILLER_AI.sabotageChance) {
        setKillerState('SABOTAGE');
        killer.target.x = WAYPOINTS.breaker.gx * TILE + TILE / 2;
        killer.target.y = WAYPOINTS.breaker.gy * TILE + TILE / 2;
        killer.stateStep = 0;
        updateKillerPath();
      } else {
        setKillerState('WANDER');
        const newT = pickWanderTarget();
        killer.target.x = newT.x;
        killer.target.y = newT.y;
        updateKillerPath();
      }
      break;
  }

  if (killer.path.length === 0 && killer.stateStep < 9) {
    updateKillerPath();
    if (killer.path.length === 0) {
      setKillerState('WANDER');
      const newT = pickWanderTarget();
      killer.target.x = newT.x;
      killer.target.y = newT.y;
      updateKillerPath();
    }
  }
}

function updateSabotage(dt) {
  const dToTarget = Math.hypot(killer.target.x - killer.x, killer.target.y - killer.y);
  if (dToTarget < TILE * 0.7) {
    if (sharedState.breakerOn) {
      sharedState.breakerOn = false;
      broadcast({ type: 'breakerState', on: false });
    }
    setKillerState('WANDER');
    const newT = pickWanderTarget();
    killer.target.x = newT.x;
    killer.target.y = newT.y;
    updateKillerPath();
    return;
  }
  if (killer.path.length === 0) {
    updateKillerPath();
    if (killer.path.length === 0) {
      setKillerState('WANDER');
      const newT = pickWanderTarget();
      killer.target.x = newT.x;
      killer.target.y = newT.y;
      updateKillerPath();
    }
  }
}

function moveAlongPath(dt) {
  killer.pathRecalcTimer -= dt;

  if (killer.state === 'CHASE') {
    const tp = killer.targetPlayerId ? players.get(killer.targetPlayerId) : null;
    if (tp && !tp.dead && lineOfSight(killer.x, killer.y, tp.x, tp.y)) return;
  }

  if (killer.path.length === 0) return;
  if (killer.pathIndex >= killer.path.length) return;

  const wp = killer.path[killer.pathIndex];
  const wx = wp.gx * TILE + TILE / 2;
  const wy = wp.gy * TILE + TILE / 2;
  const dx = wx - killer.x, dy = wy - killer.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 4) { killer.pathIndex++; return; }

  const nx = dx / dist, ny = dy / dist;
let speed;
if (killer.state === 'CHASE') speed = killer.chaseSpeed;
else if (killer.state === 'INVESTIGATE') speed = killer.wanderSpeed * 1.1;
else if (killer.state === 'SABOTAGE') speed = killer.wanderSpeed * 1.05;
else speed = killer.wanderSpeed;

// Áp dụng slow (nếu có)
speed = applyStunSpeed(speed);

const step = speed * (dt / 16.67);
  const moved = moveKiller(nx * step, ny * step);
  killer.dir = Math.atan2(ny, nx);

  if (!moved) {
    killer.stuckTimer += dt;
    if (killer.stuckTimer > 800) {
      killer.stuckTimer = 0;
      updateKillerPath();
      if (killer.path.length === 0 && killer.state === 'WANDER') {
        const newT = pickWanderTarget();
        killer.target.x = newT.x;
        killer.target.y = newT.y;
        updateKillerPath();
      }
    }
  } else {
    killer.stuckTimer = 0;
  }
}

// ==================== GAME STATE (server) ====================
const gameState = {
  running: false,
  gameTime: 0,             // giây thật
  gameDuration: 7 * 60,    // 7 phút
  startedAt: 0,
};

function startGameIfEnoughPlayers() {
  if (gameState.running) return;
  if (players.size >= 1) {
    gameState.running = true;
    gameState.gameTime = 0;
    gameState.startedAt = Date.now();
    killer = createKiller();
    // Đảm bảo state sạch
    killer.stunState = 'NORMAL';
    killer.stunTimer = 0;
    killer.immuneTimer = 0;
    killer.slowActive = false;
    killer.lightCount = 0;
    console.log('[GAME] Started! Players:', players.size, '| Killer spawned at', killer.x.toFixed(0), killer.y.toFixed(0));
    broadcast({ type: 'gameStart' });
  }
}
// Đồng hồ game — chạy mỗi 1s
setInterval(() => {
  if (!gameState.running) return;
  gameState.gameTime += 1;

  if (gameState.gameTime >= gameState.gameDuration) {
    gameState.running = false;
    console.log('[GAME] Win! Survived 7h');
    broadcast({ type: 'gameWin' });
  }
}, 1000);

// ==================== PLAYER DEATH / RESPAWN ====================
function killPlayer(id) {
  const p = players.get(id);
  if (!p || p.dead) return;
  p.dead = true;
  p.respawnAt = Date.now() + KILLER_AI.respawnDelay;
  console.log(`[GAME] ${id} died`);
  broadcast({ type: 'playerDied', id });

resetItemForPlayer(id);

}

// Check respawn mỗi 500ms
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players.entries()) {
    if (p.dead && p.respawnAt && now >= p.respawnAt) {
      const sp = pickSpawn();
      p.x = sp.x;
      p.y = sp.y;
      p.dir = sp.dir;
      p.dead = false;
      p.respawnAt = 0;
      console.log(`[GAME] ${id} respawned`);
      broadcast({ type: 'playerRespawned', id, x: p.x, y: p.y });
    }
  }
}, 500);

// ==================== KILLER AI LOOP ====================
let lastKillerUpdate = Date.now();
setInterval(() => {
  if (!gameState.running) {
    lastKillerUpdate = Date.now();   // ← Reset để lần sau không skip
    return;
  }
  const now = Date.now();
  const dt = now - lastKillerUpdate;
  lastKillerUpdate = now;
  if (dt > 200) return;
  updateKiller(dt);
}, 50);

// ==================== STATE BROADCAST ====================
setInterval(() => {
  if (players.size === 0) return;

const playerStates = {};
for (const [id, p] of players.entries()) {
  playerStates[id] = {
    x: p.x, y: p.y, dir: p.dir,
    name: p.name || id,
    dead: !!p.dead,
    equipped: p.equipped || null,        // ← THÊM
    flashlightOn: !!p.flashlightOn,      // ← THÊM
  };
}

const killerState = gameState.running ? {
  x: killer.x, y: killer.y, dir: killer.dir,
  state: killer.state,
  stunState: killer.stunState,           // ← THÊM
  stunTimer: Math.max(0, killer.stunTimer),
  immuneTimer: Math.max(0, killer.immuneTimer),
  lightCount: killer.lightCount,
} : null;

  broadcast({
    type: 'state',
    players: playerStates,
    killer: killerState,
    items: getItemsState(),
    gameTime: gameState.gameTime,
    running: gameState.running,
  });
}, 50);

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
  r: 12,
  name: id,
  dead: false,
  respawnAt: 0,
  equipped: null,
  flashlightOn: false,
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
  [...players.entries()].map(([k, v]) => [k, {
    x: v.x, y: v.y, dir: v.dir,
    name: v.name || k,
    dead: !!v.dead,
    equipped: v.equipped || null,        // ← THÊM
    flashlightOn: !!v.flashlightOn,      // ← THÊM
  }])
),
items: getItemsState(),
killer: gameState.running ? {
  x: killer.x, y: killer.y, dir: killer.dir, state: killer.state,
  stunState: killer.stunState,
  stunTimer: Math.max(0, killer.stunTimer),
  immuneTimer: Math.max(0, killer.immuneTimer),
  lightCount: killer.lightCount,
} : null,
  gameTime: gameState.gameTime,
  running: gameState.running,
}));

// Bắt đầu game nếu đủ player
startGameIfEnoughPlayers();

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
  if (p.dead) break;
  p.x = data.x;
  p.y = data.y;
  p.dir = data.dir;
  if (data.name) p.name = data.name;
  p.equipped = data.equipped || null;         // ← THÊM
  p.flashlightOn = !!data.flashlightOn;       // ← THÊM
  break;

        case 'doorToggle':
          sharedState.doorLocked = !!data.locked;
          broadcast({ type: 'doorState', locked: sharedState.doorLocked });
          break;

        case 'breakerToggle':
          sharedState.breakerOn = !!data.on;
          broadcast({ type: 'breakerState', on: sharedState.breakerOn });
          break;
case 'pickup':
  handlePickup(id, data.itemId);
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

resetItemForPlayer(id);

    if (players.size === 0) {
      gameState.running = false;
      gameState.gameTime = 0;
      console.log('[GAME] Stopped (no players)');
    }
  });
});

function broadcast(msg, exceptId = null) {
  const str = JSON.stringify(msg);
  for (const [id, p] of players.entries()) {
    if (id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(str);
    }
  }
}
// ==================== ITEMS (sync server) ====================
const ITEMS = [
  {
    id: 'flashlight',
    x: (HOUSE.x + 5) * 32 + 16,
    y: (HOUSE.y + 2) * 32 + 16,
    infinite: true,          // ai cũng nhặt được
    pickedBy: new Set(),     // set of player IDs đã nhặt
  },
  {
    id: 'key',
    x: (HOUSE.x + 4) * 32 + 16,
    y: (HOUSE.y + 2) * 32 + 16,
    infinite: false,
    picked: false,           // chỉ 1 người nhặt
    pickedBy: null,
  },
];

function findItem(id) {
  return ITEMS.find(it => it.id === id);
}

function resetItemForPlayer(playerId) {
  // Reset các item đã nhặt bởi player này (trừ infinite)
  for (const it of ITEMS) {
    if (it.infinite) continue;
    if (it.pickedBy === playerId) {
      it.picked = false;
      it.pickedBy = null;
      console.log(`[ITEM] ${it.id} reset (player ${playerId} left/died)`);
      broadcast({ type: 'itemReset', itemId: it.id });
    }
  }
  // Với infinite items — xóa player khỏi pickedBy
  for (const it of ITEMS) {
    if (!it.infinite) continue;
    if (it.pickedBy.has(playerId)) {
      it.pickedBy.delete(playerId);
    }
  }
}

function handlePickup(playerId, itemId) {
  const it = findItem(itemId);
  if (!it) return;

  const p = players.get(playerId);
  if (!p || p.dead) return;

  // Check khoảng cách (client gửi pos, server verify)
  const d = Math.hypot(p.x - it.x, p.y - it.y);
  if (d > 1.5 * 32) return;  // xa quá

  if (it.infinite) {
    // Đèn pin — ai cũng nhặt được
    if (it.pickedBy.has(playerId)) return;  // đã nhặt rồi
    it.pickedBy.add(playerId);
    console.log(`[ITEM] ${playerId} picked ${it.id}`);
    broadcast({ type: 'itemPicked', itemId: it.id, playerId });
    return;
  }

  // Chìa khóa — chỉ 1 người
  if (it.picked) {
    // Đã có người nhặt
    sendWS(playerId, { type: 'pickupFailed', itemId: it.id, reason: 'taken' });
    return;
  }

  it.picked = true;
  it.pickedBy = playerId;
  console.log(`[ITEM] ${playerId} picked ${it.id}`);
  broadcast({ type: 'itemPicked', itemId: it.id, playerId });
}

function sendWS(playerId, msg) {
  const p = players.get(playerId);
  if (p && p.ws && p.ws.readyState === WebSocket.OPEN) {
    p.ws.send(JSON.stringify(msg));
  }
}

function getItemsState() {
  return ITEMS.map(it => ({
    id: it.id,
    x: it.x,
    y: it.y,
    infinite: it.infinite,
    picked: it.infinite ? false : it.picked,
    pickedBy: it.infinite ? [...it.pickedBy] : it.pickedBy,
  }));
}


// ==================== START ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Horror 2D — Multiplayer Server`);
  console.log(`   Local:  http://localhost:${PORT}`);
  console.log(`   LAN:    http://192.168.1.253:${PORT}`);
  console.log(`   Nhấn Ctrl+C để dừng`);
});
