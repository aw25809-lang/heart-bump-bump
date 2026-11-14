import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ARENA_PRESETS,
  type ClientRole,
  type ClientToServerMessage,
  type ControllerRoomState,
  type GameSettings,
  type HostRoomState,
  type MoveInput,
  type PlayerSide,
  type Point2D,
  type PulseEvent,
  type RoomPhase,
  type RoundResult,
  type ServerToClientMessage,
} from './src/shared/gameTypes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 33; // ~30Hz server-authoritative simulation
const MAX_TRAIL_POINTS = 26;
const ROOM_TTL_MS = 1000 * 60 * 60 * 3; // 3 hours idle cleanup

interface PlayerRuntime {
  socket: WebSocket | null;
  clientId: string | null;
  connected: boolean;
  ready: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  input: MoveInput;
  attacksLeft: number | 'unlimited';
  score: number;
  trail: Point2D[];
  lastAttackAt: number;
  lastWhiffAt: number;
  lastTrailAt: number;
}

interface ServerRoom {
  roomCode: string;
  hostSocket: WebSocket | null;
  hostClientId: string | null;
  phase: RoomPhase;
  roundNumber: number;
  countdownValue: number;
  settings: GameSettings;
  players: Record<PlayerSide, PlayerRuntime>;
  distance: number;
  maxDistance: number;
  distanceRatio: number;
  isTouching: boolean;
  contactStartedAt: number | null;
  pulses: PulseEvent[];
  lastRoundResult: RoundResult | null;
  roundHistory: RoundResult[];
  matchWinner: PlayerSide | null;
  lastActivityAt: number;
  lastTickAt: number;
  countdownTimer: NodeJS.Timeout | null;
  tickTimer: NodeJS.Timeout | null;
}

interface SocketMeta {
  roomCode: string | null;
  role: ClientRole | null;
  clientId: string | null;
  isAlive: boolean;
}

const rooms = new Map<string, ServerRoom>();
const socketMetaMap = new WeakMap<WebSocket, SocketMeta>();

function emptyInput(): MoveInput {
  return { up: false, down: false, left: false, right: false };
}

function createPlayerRuntime(initialX: number, initialY: number, attackLimit: GameSettings['attackLimit']): PlayerRuntime {
  return {
    socket: null,
    clientId: null,
    connected: false,
    ready: false,
    x: initialX,
    y: initialY,
    vx: 0,
    vy: 0,
    input: emptyInput(),
    attacksLeft: attackLimit,
    score: 0,
    trail: [],
    lastAttackAt: 0,
    lastWhiffAt: 0,
    lastTrailAt: 0,
  };
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `${Math.floor(1000 + Math.random() * 9000)}`;
}

function sendMsg(socket: WebSocket | null, msg: ServerToClientMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(msg));
}

function createRoom(): ServerRoom {
  const roomCode = generateRoomCode();
  const settings: GameSettings = {
    arenaSize: 'medium',
    attackLimit: 3,
    targetWins: 3,
  };
  const arena = ARENA_PRESETS[settings.arenaSize];
  const maxDistance = Math.hypot(arena.width - arena.playerRadius * 2, arena.height - arena.playerRadius * 2);

  const room: ServerRoom = {
    roomCode,
    hostSocket: null,
    hostClientId: null,
    phase: 'LOBBY',
    roundNumber: 0,
    countdownValue: 0,
    settings,
    players: {
      red: createPlayerRuntime(arena.width * 0.2, arena.height * 0.5, settings.attackLimit),
      blue: createPlayerRuntime(arena.width * 0.8, arena.height * 0.5, settings.attackLimit),
    },
    distance: arena.width * 0.6,
    maxDistance,
    distanceRatio: (arena.width * 0.6) / maxDistance,
    isTouching: false,
    contactStartedAt: null,
    pulses: [],
    lastRoundResult: null,
    roundHistory: [],
    matchWinner: null,
    lastActivityAt: Date.now(),
    lastTickAt: Date.now(),
    countdownTimer: null,
    tickTimer: null,
  };

  rooms.set(roomCode, room);
  return room;
}

function buildHostState(room: ServerRoom): HostRoomState {
  const arena = ARENA_PRESETS[room.settings.arenaSize];
  const now = Date.now();
  room.pulses = room.pulses.filter((p) => now - p.createdAt < 1400);

  return {
    roomCode: room.roomCode,
    phase: room.phase,
    roundNumber: room.roundNumber,
    countdownValue: room.countdownValue,
    settings: room.settings,
    arena,
    red: {
      connected: room.players.red.connected,
      ready: room.players.red.ready,
      x: room.players.red.x,
      y: room.players.red.y,
      vx: room.players.red.vx,
      vy: room.players.red.vy,
      attacksLeft: room.players.red.attacksLeft,
      score: room.players.red.score,
      trail: room.players.red.trail,
      lastWhiffAt: room.players.red.lastWhiffAt,
    },
    blue: {
      connected: room.players.blue.connected,
      ready: room.players.blue.ready,
      x: room.players.blue.x,
      y: room.players.blue.y,
      vx: room.players.blue.vx,
      vy: room.players.blue.vy,
      attacksLeft: room.players.blue.attacksLeft,
      score: room.players.blue.score,
      trail: room.players.blue.trail,
      lastWhiffAt: room.players.blue.lastWhiffAt,
    },
    distance: room.distance,
    maxDistance: room.maxDistance,
    distanceRatio: room.distanceRatio,
    isTouching: room.isTouching,
    contactStartedAt: room.contactStartedAt,
    pulses: room.pulses,
    lastRoundResult: room.lastRoundResult,
    roundHistory: room.roundHistory,
    matchWinner: room.matchWinner,
    serverTime: now,
  };
}

function buildControllerState(room: ServerRoom, side: PlayerSide): ControllerRoomState {
  const opp: PlayerSide = side === 'red' ? 'blue' : 'red';
  const me = room.players[side];
  const enemy = room.players[opp];

  return {
    roomCode: room.roomCode,
    side,
    phase: room.phase,
    roundNumber: room.roundNumber,
    countdownValue: room.countdownValue,
    settings: room.settings,
    connected: me.connected,
    ready: me.ready,
    opponentConnected: enemy.connected,
    opponentReady: enemy.ready,
    myScore: me.score,
    opponentScore: enemy.score,
    myAttacksLeft: me.attacksLeft,
    opponentAttacksLeft: enemy.attacksLeft,
    distanceRatio: room.distanceRatio,
    isTouching: room.isTouching,
    lastWhiffAt: me.lastWhiffAt,
    opponentWhiffAt: enemy.lastWhiffAt,
    lastRoundResult: room.lastRoundResult,
    matchWinner: room.matchWinner,
    serverTime: Date.now(),
  };
}

function broadcastRoomState(room: ServerRoom): void {
  if (room.hostSocket) {
    sendMsg(room.hostSocket, { type: 'host_state', state: buildHostState(room) });
  }
  if (room.players.red.socket) {
    sendMsg(room.players.red.socket, {
      type: 'controller_state',
      state: buildControllerState(room, 'red'),
    });
  }
  if (room.players.blue.socket) {
    sendMsg(room.players.blue.socket, {
      type: 'controller_state',
      state: buildControllerState(room, 'blue'),
    });
  }
}

function clearTimers(room: ServerRoom): void {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function stopLoop(room: ServerRoom): void {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function startLoop(room: ServerRoom): void {
  if (room.tickTimer) return;
  room.lastTickAt = Date.now();
  room.tickTimer = setInterval(() => {
    tickRoom(room);
  }, TICK_MS);
}

function spawnPlayersForRound(room: ServerRoom): void {
  const arena = ARENA_PRESETS[room.settings.arenaSize];
  const margin = arena.playerRadius * 3.2;
  const usableW = arena.width - margin * 2;
  const usableH = arena.height - margin * 2;
  const maxDist = Math.hypot(arena.width - arena.playerRadius * 2, arena.height - arena.playerRadius * 2);
  room.maxDistance = maxDist;

  let rx = margin + Math.random() * usableW;
  let ry = margin + Math.random() * usableH;
  let bx = margin + Math.random() * usableW;
  let by = margin + Math.random() * usableH;

  // Ensure fair initial separation (>= 55% of arena diagonal)
  for (let i = 0; i < 40; i++) {
    rx = margin + Math.random() * usableW;
    ry = margin + Math.random() * usableH;
    bx = margin + Math.random() * usableW;
    by = margin + Math.random() * usableH;
    if (Math.hypot(rx - bx, ry - by) >= maxDist * 0.55) {
      break;
    }
  }

  for (const [side, coords] of [
    ['red', { x: rx, y: ry }],
    ['blue', { x: bx, y: by }],
  ] as const) {
    const p = room.players[side];
    p.x = coords.x;
    p.y = coords.y;
    p.vx = 0;
    p.vy = 0;
    p.input = emptyInput();
    p.attacksLeft = room.settings.attackLimit;
    p.trail = [{ x: coords.x, y: coords.y }];
    p.lastWhiffAt = 0;
  }

  room.pulses = [];
  room.isTouching = false;
  room.contactStartedAt = null;
  updateDistanceMetrics(room, Date.now());
}

function updateDistanceMetrics(room: ServerRoom, now: number): void {
  const arena = ARENA_PRESETS[room.settings.arenaSize];
  const red = room.players.red;
  const blue = room.players.blue;
  const dist = Math.hypot(red.x - blue.x, red.y - blue.y);
  const maxDist = Math.hypot(arena.width - arena.playerRadius * 2, arena.height - arena.playerRadius * 2);

  room.distance = dist;
  room.maxDistance = maxDist;
  room.distanceRatio = Math.max(0, Math.min(1, dist / maxDist));

  const touchingNow = dist <= arena.contactRadius;
  if (touchingNow && !room.isTouching) {
    room.isTouching = true;
    room.contactStartedAt = now;
    room.pulses.push({
      id: `contact-${now}-${Math.random().toString(36).slice(2, 6)}`,
      x: (red.x + blue.x) / 2,
      y: (red.y + blue.y) / 2,
      side: 'contact',
      kind: 'contact',
      createdAt: now,
    });
  } else if (!touchingNow && room.isTouching) {
    room.isTouching = false;
    room.contactStartedAt = null;
  }
}

function tickRoom(room: ServerRoom): void {
  if (room.phase !== 'PLAYING') {
    stopLoop(room);
    return;
  }

  const now = Date.now();
  const rawDt = (now - room.lastTickAt) / 1000;
  const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
  room.lastTickAt = now;
  room.lastActivityAt = now;

  const arena = ARENA_PRESETS[room.settings.arenaSize];
  const minX = arena.playerRadius;
  const maxX = arena.width - arena.playerRadius;
  const minY = arena.playerRadius;
  const maxY = arena.height - arena.playerRadius;

  for (const side of ['red', 'blue'] as const) {
    const p = room.players[side];
    let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);

    if (dx !== 0 && dy !== 0) {
      const invSqrt2 = Math.SQRT1_2;
      dx *= invSqrt2;
      dy *= invSqrt2;
    }

    p.vx = dx * arena.speed;
    p.vy = dy * arena.speed;
    p.x = Math.max(minX, Math.min(maxX, p.x + p.vx * dt));
    p.y = Math.max(minY, Math.min(maxY, p.y + p.vy * dt));

    if ((dx !== 0 || dy !== 0) && now - p.lastTrailAt > 75) {
      p.lastTrailAt = now;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > MAX_TRAIL_POINTS) {
        p.trail.shift();
      }
    }
  }

  updateDistanceMetrics(room, now);
  broadcastRoomState(room);
}

function startCountdownForRound(room: ServerRoom, isNewMatch: boolean): void {
  clearTimers(room);
  if (isNewMatch) {
    room.roundNumber = 1;
    room.players.red.score = 0;
    room.players.blue.score = 0;
    room.roundHistory = [];
    room.lastRoundResult = null;
    room.matchWinner = null;
  } else {
    room.roundNumber += 1;
  }

  spawnPlayersForRound(room);
  room.phase = 'COUNTDOWN';
  room.countdownValue = 3;
  broadcastRoomState(room);

  room.countdownTimer = setInterval(() => {
    room.countdownValue -= 1;
    if (room.countdownValue <= 0) {
      if (room.countdownTimer) {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
      }
      room.phase = 'PLAYING';
      room.countdownValue = 0;
      broadcastRoomState(room);
      startLoop(room);
    } else {
      broadcastRoomState(room);
    }
  }, 850);
}

function handleAttack(room: ServerRoom, side: PlayerSide): void {
  if (room.phase !== 'PLAYING') return;

  const now = Date.now();
  const attacker = room.players[side];
  const oppSide: PlayerSide = side === 'red' ? 'blue' : 'red';
  const defender = room.players[oppSide];

  // Prevent accidental double tap within 240ms
  if (now - attacker.lastAttackAt < 240) return;

  if (typeof attacker.attacksLeft === 'number' && attacker.attacksLeft <= 0) {
    sendMsg(attacker.socket, { type: 'action_feedback', kind: 'empty', attacksLeft: 0 });
    return;
  }

  attacker.lastAttackAt = now;
  if (typeof attacker.attacksLeft === 'number') {
    attacker.attacksLeft -= 1;
  }

  // Re-evaluate distance at exact instant of attack
  updateDistanceMetrics(room, now);

  if (room.isTouching) {
    stopLoop(room);
    const reactionTimeMs = room.contactStartedAt ? Math.max(1, now - room.contactStartedAt) : 1;
    attacker.score += 1;

    const hitPos: Point2D = {
      x: (attacker.x + defender.x) / 2,
      y: (attacker.y + defender.y) / 2,
    };

    const result: RoundResult = {
      roundNumber: room.roundNumber,
      winner: side,
      reason: 'hit',
      reactionTimeMs,
      hitPosition: hitPos,
      timestamp: now,
    };

    room.lastRoundResult = result;
    room.roundHistory.push(result);
    room.pulses.push({
      id: `hit-${now}`,
      x: hitPos.x,
      y: hitPos.y,
      side,
      kind: 'hit',
      createdAt: now,
    });

    if (room.settings.targetWins > 0 && attacker.score >= room.settings.targetWins) {
      room.phase = 'MATCH_OVER';
      room.matchWinner = side;
    } else {
      room.phase = 'ROUND_OVER';
    }

    sendMsg(attacker.socket, {
      type: 'action_feedback',
      kind: 'hit_win',
      attacksLeft: attacker.attacksLeft,
      reactionTimeMs,
    });
    sendMsg(defender.socket, {
      type: 'action_feedback',
      kind: 'hit_lose',
      attacksLeft: defender.attacksLeft,
      reactionTimeMs,
    });
    broadcastRoomState(room);
    return;
  }

  // Whiff (missed attack while not in contact)
  attacker.lastWhiffAt = now;
  room.pulses.push({
    id: `whiff-${now}-${side}`,
    x: attacker.x,
    y: attacker.y,
    side,
    kind: 'whiff',
    createdAt: now,
  });

  sendMsg(attacker.socket, {
    type: 'action_feedback',
    kind: 'whiff',
    attacksLeft: attacker.attacksLeft,
  });

  // Check if both players ran out of ammo
  const redEmpty = typeof room.players.red.attacksLeft === 'number' && room.players.red.attacksLeft <= 0;
  const blueEmpty = typeof room.players.blue.attacksLeft === 'number' && room.players.blue.attacksLeft <= 0;

  if (redEmpty && blueEmpty) {
    stopLoop(room);
    const drawResult: RoundResult = {
      roundNumber: room.roundNumber,
      winner: 'draw',
      reason: 'out_of_ammo',
      reactionTimeMs: null,
      hitPosition: null,
      timestamp: now,
    };
    room.lastRoundResult = drawResult;
    room.roundHistory.push(drawResult);
    room.phase = 'ROUND_OVER';

    sendMsg(room.players.red.socket, { type: 'action_feedback', kind: 'draw', attacksLeft: 0 });
    sendMsg(room.players.blue.socket, { type: 'action_feedback', kind: 'draw', attacksLeft: 0 });
  }

  broadcastRoomState(room);
}

function handleDisconnect(ws: WebSocket): void {
  const meta = socketMetaMap.get(ws);
  if (!meta || !meta.roomCode || !meta.role) return;

  const room = rooms.get(meta.roomCode);
  if (!room) return;

  if (meta.role === 'host') {
    if (room.hostSocket === ws) {
      room.hostSocket = null;
    }
  } else {
    const p = room.players[meta.role];
    if (p.socket === ws) {
      p.socket = null;
      p.connected = false;
      p.input = emptyInput();
      p.vx = 0;
      p.vy = 0;

      if (room.phase === 'PLAYING' || room.phase === 'COUNTDOWN') {
        clearTimers(room);
        room.phase = 'PAUSED';
      }
      broadcastRoomState(room);
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ ok: true, rooms: rooms.size });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    socketMetaMap.set(ws, {
      roomCode: null,
      role: null,
      clientId: null,
      isAlive: true,
    });

    ws.on('pong', () => {
      const meta = socketMetaMap.get(ws);
      if (meta) meta.isAlive = true;
    });

    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMessage;
      } catch {
        return;
      }

      const meta = socketMetaMap.get(ws);
      if (!meta) return;

      if (msg.type === 'ping') {
        sendMsg(ws, { type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        return;
      }

      if (msg.type === 'create_room') {
        const room = createRoom();
        room.hostSocket = ws;
        meta.roomCode = room.roomCode;
        meta.role = 'host';
        sendMsg(ws, { type: 'room_created', roomCode: room.roomCode });
        sendMsg(ws, { type: 'joined', roomCode: room.roomCode, role: 'host' });
        broadcastRoomState(room);
        return;
      }

      if (msg.type === 'join_room') {
        const code = msg.roomCode.trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendMsg(ws, { type: 'error', message: `找不到房號「${code}」，請確認主控計分台房號。`, code: 'ROOM_NOT_FOUND' });
          return;
        }
        room.lastActivityAt = Date.now();

        if (msg.role === 'host') {
          room.hostSocket = ws;
          room.hostClientId = msg.clientId;
          meta.roomCode = code;
          meta.role = 'host';
          meta.clientId = msg.clientId;
          sendMsg(ws, { type: 'joined', roomCode: code, role: 'host' });
          broadcastRoomState(room);
          return;
        }

        const slot = room.players[msg.role];
        if (slot.connected && slot.socket && slot.socket !== ws && slot.clientId !== msg.clientId) {
          const roleName = msg.role === 'red' ? '紅方' : '藍方';
          sendMsg(ws, {
            type: 'error',
            message: `${roleName}位置目前已有裝置連線。請選擇另一陣營，或請主控台釋放該位置。`,
            code: 'ROLE_OCCUPIED',
          });
          return;
        }

        slot.socket = ws;
        slot.clientId = msg.clientId;
        slot.connected = true;
        meta.roomCode = code;
        meta.role = msg.role;
        meta.clientId = msg.clientId;

        sendMsg(ws, { type: 'joined', roomCode: code, role: msg.role });
        broadcastRoomState(room);
        return;
      }

      if (!meta.roomCode || !meta.role) return;
      const room = rooms.get(meta.roomCode);
      if (!room) {
        sendMsg(ws, { type: 'error', message: '房間已結束或過期', code: 'ROOM_EXPIRED' });
        return;
      }
      room.lastActivityAt = Date.now();

      if (msg.type === 'leave_room') {
        handleDisconnect(ws);
        meta.roomCode = null;
        meta.role = null;
        return;
      }

      if (meta.role === 'host') {
        if (msg.type === 'update_settings') {
          if (room.phase === 'LOBBY' || room.phase === 'MATCH_OVER' || room.phase === 'ROUND_OVER') {
            room.settings = { ...room.settings, ...msg.settings };
            if (room.phase === 'LOBBY') {
              room.players.red.attacksLeft = room.settings.attackLimit;
              room.players.blue.attacksLeft = room.settings.attackLimit;
              const arena = ARENA_PRESETS[room.settings.arenaSize];
              room.players.red.x = arena.width * 0.2;
              room.players.red.y = arena.height * 0.5;
              room.players.blue.x = arena.width * 0.8;
              room.players.blue.y = arena.height * 0.5;
              updateDistanceMetrics(room, Date.now());
            }
            broadcastRoomState(room);
          }
          return;
        }

        if (msg.type === 'kick_player') {
          const target = room.players[msg.side];
          if (target.socket) {
            sendMsg(target.socket, { type: 'error', message: '主控台已重置您的陣營位置。', code: 'KICKED' });
            target.socket.close();
          }
          target.socket = null;
          target.clientId = null;
          target.connected = false;
          target.ready = false;
          target.input = emptyInput();
          if (room.phase === 'PLAYING' || room.phase === 'COUNTDOWN') {
            clearTimers(room);
            room.phase = 'PAUSED';
          }
          broadcastRoomState(room);
          return;
        }

        if (msg.type === 'start_match') {
          startCountdownForRound(room, true);
          return;
        }

        if (msg.type === 'next_round') {
          startCountdownForRound(room, false);
          return;
        }

        if (msg.type === 'pause_game') {
          if (room.phase === 'PLAYING') {
            stopLoop(room);
            room.phase = 'PAUSED';
            room.players.red.input = emptyInput();
            room.players.blue.input = emptyInput();
            broadcastRoomState(room);
          }
          return;
        }

        if (msg.type === 'resume_game') {
          if (room.phase === 'PAUSED') {
            room.phase = 'PLAYING';
            broadcastRoomState(room);
            startLoop(room);
          }
          return;
        }

        if (msg.type === 'reset_match') {
          clearTimers(room);
          room.phase = msg.toLobby === false ? 'ROUND_OVER' : 'LOBBY';
          room.roundNumber = 0;
          room.players.red.score = 0;
          room.players.blue.score = 0;
          room.players.red.attacksLeft = room.settings.attackLimit;
          room.players.blue.attacksLeft = room.settings.attackLimit;
          room.players.red.trail = [];
          room.players.blue.trail = [];
          room.roundHistory = [];
          room.lastRoundResult = null;
          room.matchWinner = null;
          room.pulses = [];
          const arena = ARENA_PRESETS[room.settings.arenaSize];
          room.players.red.x = arena.width * 0.2;
          room.players.red.y = arena.height * 0.5;
          room.players.blue.x = arena.width * 0.8;
          room.players.blue.y = arena.height * 0.5;
          updateDistanceMetrics(room, Date.now());
          broadcastRoomState(room);
          return;
        }
      } else {
        const side: PlayerSide = meta.role;
        const player = room.players[side];

        if (msg.type === 'set_ready') {
          player.ready = msg.ready;
          broadcastRoomState(room);
          return;
        }

        if (msg.type === 'move_input') {
          player.input = {
            up: Boolean(msg.input.up),
            down: Boolean(msg.input.down),
            left: Boolean(msg.input.left),
            right: Boolean(msg.input.right),
          };
          return;
        }

        if (msg.type === 'attack') {
          handleAttack(room, side);
          return;
        }
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });
  });

  // WebSocket heartbeat & stale room cleanup
  setInterval(() => {
    const now = Date.now();
    wss.clients.forEach((client) => {
      const meta = socketMetaMap.get(client);
      if (!meta) return;
      if (!meta.isAlive) {
        client.terminate();
        return;
      }
      meta.isAlive = false;
      client.ping();
    });

    for (const [code, room] of rooms.entries()) {
      const anyConnected =
        room.hostSocket !== null || room.players.red.connected || room.players.blue.connected;
      if (!anyConnected && now - room.lastActivityAt > ROOM_TTL_MS) {
        clearTimers(room);
        rooms.delete(code);
      }
    }
  }, 30000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Heartbeat Duel server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
