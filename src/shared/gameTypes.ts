export type ArenaSize = 'small' | 'medium' | 'large';
export type AttackLimit = 1 | 2 | 3 | 'unlimited';
export type TargetWins = 1 | 3 | 5 | 0; // 0 = continuous free play
export type RoomPhase =
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'PAUSED'
  | 'ROUND_OVER'
  | 'MATCH_OVER';

export type PlayerSide = 'red' | 'blue';
export type ClientRole = 'host' | PlayerSide;

export interface ArenaPreset {
  id: ArenaSize;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  playerRadius: number;
  contactRadius: number;
  speed: number; // units per second
  description: string;
}

export const ARENA_PRESETS: Record<ArenaSize, ArenaPreset> = {
  small: {
    id: 'small',
    label: '小型場地',
    shortLabel: '小',
    width: 620,
    height: 440,
    playerRadius: 18,
    contactRadius: 46,
    speed: 205,
    description: '緊湊近身搏鬥，快速遭遇戰',
  },
  medium: {
    id: 'medium',
    label: '中型場地',
    shortLabel: '中',
    width: 900,
    height: 600,
    playerRadius: 18,
    contactRadius: 48,
    speed: 235,
    description: '標準戰術空間，兼顧游擊與追蹤',
  },
  large: {
    id: 'large',
    label: '大型場地',
    shortLabel: '大',
    width: 1200,
    height: 780,
    playerRadius: 18,
    contactRadius: 50,
    speed: 265,
    description: '廣闊潛行獵場，考驗聽音辨位耐力',
  },
};

export interface GameSettings {
  arenaSize: ArenaSize;
  attackLimit: AttackLimit;
  targetWins: TargetWins;
}

export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface PulseEvent {
  id: string;
  x: number;
  y: number;
  side: PlayerSide | 'contact';
  kind: 'whiff' | 'hit' | 'contact';
  createdAt: number;
}

export interface RoundResult {
  roundNumber: number;
  winner: PlayerSide | 'draw';
  reason: 'hit' | 'out_of_ammo' | 'forfeit';
  reactionTimeMs: number | null;
  hitPosition: Point2D | null;
  timestamp: number;
}

export interface HostPlayerSnapshot {
  connected: boolean;
  ready: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  attacksLeft: number | 'unlimited';
  score: number;
  trail: Point2D[];
  lastWhiffAt: number;
}

export interface HostRoomState {
  roomCode: string;
  phase: RoomPhase;
  roundNumber: number;
  countdownValue: number;
  settings: GameSettings;
  arena: ArenaPreset;
  red: HostPlayerSnapshot;
  blue: HostPlayerSnapshot;
  distance: number;
  maxDistance: number;
  distanceRatio: number; // 0 (overlapping) -> 1 (farthest corners)
  isTouching: boolean;
  contactStartedAt: number | null;
  pulses: PulseEvent[];
  lastRoundResult: RoundResult | null;
  roundHistory: RoundResult[];
  matchWinner: PlayerSide | null;
  serverTime: number;
}

export interface ControllerRoomState {
  roomCode: string;
  side: PlayerSide;
  phase: RoomPhase;
  roundNumber: number;
  countdownValue: number;
  settings: GameSettings;
  connected: boolean;
  ready: boolean;
  opponentConnected: boolean;
  opponentReady: boolean;
  myScore: number;
  opponentScore: number;
  myAttacksLeft: number | 'unlimited';
  opponentAttacksLeft: number | 'unlimited';
  distanceRatio: number;
  isTouching: boolean;
  lastWhiffAt: number;
  opponentWhiffAt: number;
  lastRoundResult: RoundResult | null;
  matchWinner: PlayerSide | null;
  serverTime: number;
}

export type ClientToServerMessage =
  | { type: 'create_room' }
  | { type: 'join_room'; roomCode: string; role: ClientRole; clientId: string }
  | { type: 'leave_room' }
  | { type: 'kick_player'; side: PlayerSide }
  | { type: 'update_settings'; settings: Partial<GameSettings> }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_match' }
  | { type: 'next_round' }
  | { type: 'pause_game' }
  | { type: 'resume_game' }
  | { type: 'reset_match'; toLobby?: boolean }
  | { type: 'move_input'; input: MoveInput }
  | { type: 'attack' }
  | { type: 'ping'; clientTime: number };

export type ServerToClientMessage =
  | { type: 'room_created'; roomCode: string }
  | { type: 'joined'; roomCode: string; role: ClientRole }
  | { type: 'host_state'; state: HostRoomState }
  | { type: 'controller_state'; state: ControllerRoomState }
  | {
      type: 'action_feedback';
      kind: 'whiff' | 'empty' | 'hit_win' | 'hit_lose' | 'draw';
      attacksLeft: number | 'unlimited';
      reactionTimeMs?: number | null;
    }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong'; clientTime: number; serverTime: number };
