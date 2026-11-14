import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  Copy,
  ExternalLink,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  UserX,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ARENA_PRESETS,
  type ArenaSize,
  type AttackLimit,
  type ClientToServerMessage,
  type HostRoomState,
  type TargetWins,
} from '../shared/gameTypes';
import { audioHaptics } from '../utils/audioHaptics';

interface HostViewProps {
  state: HostRoomState;
  onSend: (msg: ClientToServerMessage) => void;
  onLeave: () => void;
}

const ARENA_OPTIONS: ArenaSize[] = ['small', 'medium', 'large'];
const ATTACK_OPTIONS: { value: AttackLimit; label: string }[] = [
  { value: 1, label: '1 次' },
  { value: 2, label: '2 次' },
  { value: 3, label: '3 次' },
  { value: 'unlimited', label: '無限次' },
];
const TARGET_OPTIONS: { value: TargetWins; label: string }[] = [
  { value: 1, label: '單局決勝' },
  { value: 3, label: '搶 3 勝' },
  { value: 5, label: '搶 5 勝' },
  { value: 0, label: '自由連戰' },
];

export const HostView: React.FC<HostViewProps> = ({ state, onSend, onLeave }) => {
  const [copiedRole, setCopiedRole] = useState<'code' | 'red' | 'blue' | null>(null);
  const [hostMuted, setHostMuted] = useState(false);

  // Latest state ref for isolated 60fps canvas loop
  const stateRef = useRef<HostRoomState>(state);
  stateRef.current = state;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevCountdownRef = useRef<number>(0);
  const prevRoundTimestampRef = useRef<number>(0);
  const prevPulseIdsRef = useRef<Set<string>>(new Set());
  const shakeRef = useRef<number>(0);
  const flashRef = useRef<{ color: string; alpha: number }>({ color: '#FFFFFF', alpha: 0 });
  const interpRef = useRef<{ rx: number; ry: number; bx: number; by: number }>({
    rx: state.red.x,
    ry: state.red.y,
    bx: state.blue.x,
    by: state.blue.y,
  });

  // Host audio cues for countdown, whiffs, and hits
  useEffect(() => {
    if (hostMuted) return;
    if (state.phase === 'COUNTDOWN' && state.countdownValue !== prevCountdownRef.current) {
      prevCountdownRef.current = state.countdownValue;
      audioHaptics.playCountdownTick(state.countdownValue);
    } else if (state.phase === 'PLAYING' && prevCountdownRef.current !== 0) {
      prevCountdownRef.current = 0;
      audioHaptics.playCountdownTick(0);
    }
  }, [state.phase, state.countdownValue, hostMuted]);

  useEffect(() => {
    if (state.lastRoundResult && state.lastRoundResult.timestamp !== prevRoundTimestampRef.current) {
      prevRoundTimestampRef.current = state.lastRoundResult.timestamp;
      if (state.lastRoundResult.reason === 'hit') {
        shakeRef.current = 14;
        flashRef.current = {
          color: state.lastRoundResult.winner === 'red' ? '#EF4444' : '#3B82F6',
          alpha: 0.35,
        };
        if (!hostMuted) {
          audioHaptics.playHitWin();
        }
      }
    }
  }, [state.lastRoundResult, hostMuted]);

  useEffect(() => {
    for (const p of state.pulses) {
      if (!prevPulseIdsRef.current.has(p.id)) {
        prevPulseIdsRef.current.add(p.id);
        if (p.kind === 'whiff' && !hostMuted) {
          audioHaptics.playWhiff();
        }
      }
    }
    if (prevPulseIdsRef.current.size > 60) {
      prevPulseIdsRef.current = new Set(state.pulses.map((p) => p.id));
    }
  }, [state.pulses, hostMuted]);

  const toggleHostMute = () => {
    const next = !hostMuted;
    setHostMuted(next);
    audioHaptics.setMuted(next);
    if (!next) {
      void audioHaptics.unlockAndTest();
    }
  };

  // Isolated 60fps Arena Canvas Loop (only active outside LOBBY)
  useEffect(() => {
    if (state.phase === 'LOBBY') return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const s = stateRef.current;
      const arena = s.arena;

      // Fit canvas cleanly into container preserving arena aspect ratio
      const rect = container.getBoundingClientRect();
      const pad = 16;
      const availW = Math.max(200, rect.width - pad * 2);
      const availH = Math.max(200, rect.height - pad * 2);
      const scale = Math.min(availW / arena.width, availH / arena.height);
      const displayW = Math.floor(arena.width * scale);
      const displayH = Math.floor(arena.height * scale);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetPixelW = Math.floor(displayW * dpr);
      const targetPixelH = Math.floor(displayH * dpr);

      if (canvas.width !== targetPixelW || canvas.height !== targetPixelH) {
        canvas.width = targetPixelW;
        canvas.height = targetPixelH;
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;
      }

      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

      // Smoothly interpolate positions toward authoritative server coordinates
      const lerpAlpha = 1 - Math.exp(-22 * dt);
      const interp = interpRef.current;
      if (Math.hypot(s.red.x - interp.rx, s.red.y - interp.ry) > 150) {
        interp.rx = s.red.x;
        interp.ry = s.red.y;
      } else {
        interp.rx += (s.red.x - interp.rx) * lerpAlpha;
        interp.ry += (s.red.y - interp.ry) * lerpAlpha;
      }

      if (Math.hypot(s.blue.x - interp.bx, s.blue.y - interp.by) > 150) {
        interp.bx = s.blue.x;
        interp.by = s.blue.y;
      } else {
        interp.bx += (s.blue.x - interp.bx) * lerpAlpha;
        interp.by += (s.blue.y - interp.by) * lerpAlpha;
      }

      // Decay screen shake & hit flash
      let offsetX = 0;
      let offsetY = 0;
      if (shakeRef.current > 0.2) {
        offsetX = (Math.random() - 0.5) * shakeRef.current * 2;
        offsetY = (Math.random() - 0.5) * shakeRef.current * 2;
        shakeRef.current *= Math.exp(-12 * dt);
      } else {
        shakeRef.current = 0;
      }

      ctx.save();
      ctx.translate(offsetX, offsetY);

      // Background
      ctx.fillStyle = '#0B111B';
      ctx.fillRect(0, 0, arena.width, arena.height);

      // Tactical Grid
      const gridStep = 60;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = gridStep; gx < arena.width; gx += gridStep) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, arena.height);
      }
      for (let gy = gridStep; gy < arena.height; gy += gridStep) {
        ctx.moveTo(0, gy);
        ctx.lineTo(arena.width, gy);
      }
      ctx.stroke();

      // Center crosshair & subtle sonar ring
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
      ctx.beginPath();
      ctx.arc(arena.width / 2, arena.height / 2, Math.min(arena.width, arena.height) * 0.22, 0, Math.PI * 2);
      ctx.stroke();

      // Distance line between Red & Blue
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash(s.isTouching ? [] : [6, 6]);
      ctx.moveTo(interp.rx, interp.ry);
      ctx.lineTo(interp.bx, interp.by);
      ctx.strokeStyle = s.isTouching
        ? 'rgba(245, 158, 11, 0.85)'
        : `rgba(226, 232, 240, ${(0.08 + (1 - s.distanceRatio) * 0.28).toFixed(2)})`;
      ctx.lineWidth = s.isTouching ? 2.5 : 1.5;
      ctx.stroke();
      ctx.restore();

      // Movement Trails
      const drawTrail = (trail: { x: number; y: number }[], rgb: string) => {
        if (trail.length < 2) return;
        for (let i = 1; i < trail.length; i++) {
          const alpha = (i / trail.length) * 0.35;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      };
      drawTrail(s.red.trail, '239, 68, 68');
      drawTrail(s.blue.trail, '59, 130, 246');

      // Heartbeat proximity rings radiating from each player
      const proximity = Math.pow(1 - s.distanceRatio, 1.4);
      const bpm = s.isTouching ? 172 : 52 + proximity * 116;
      const beatHz = bpm / 60;
      const wavePhase = ((now / 1000) * beatHz) % 1;

      const drawHeartbeatHalo = (x: number, y: number, rgb: string) => {
        const radius = arena.playerRadius + wavePhase * (36 + proximity * 32);
        const alpha = (1 - wavePhase) * (0.2 + proximity * 0.45);
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      };

      if (s.phase === 'PLAYING') {
        drawHeartbeatHalo(interp.rx, interp.ry, s.isTouching ? '245, 158, 11' : '239, 68, 68');
        drawHeartbeatHalo(interp.bx, interp.by, s.isTouching ? '245, 158, 11' : '59, 130, 246');
      }

      // Contact threshold ring when touching
      if (s.isTouching) {
        const mx = (interp.rx + interp.bx) / 2;
        const my = (interp.ry + interp.by) / 2;
        ctx.beginPath();
        ctx.arc(mx, my, arena.contactRadius * 0.72, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.14)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Expanding action pulses (whiffs, contacts, hits)
      const nowServer = Date.now();
      for (const pulse of s.pulses) {
        const age = Math.max(0, (nowServer - pulse.createdAt) / 1000);
        const maxAge = pulse.kind === 'hit' ? 1.1 : 0.75;
        if (age > maxAge) continue;
        const progress = age / maxAge;
        const r = arena.playerRadius + progress * (pulse.kind === 'hit' ? 140 : 85);
        const alpha = (1 - progress) * 0.85;
        const color =
          pulse.side === 'red'
            ? `rgba(239, 68, 68, ${alpha.toFixed(3)})`
            : pulse.side === 'blue'
              ? `rgba(59, 130, 246, ${alpha.toFixed(3)})`
              : `rgba(245, 158, 11, ${alpha.toFixed(3)})`;

        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = pulse.kind === 'hit' ? 4 : 2.5;
        ctx.stroke();
      }

      // Draw Player Beacons
      const drawPlayer = (x: number, y: number, color: string, glow: string, label: string) => {
        // Outer contact radius hint
        ctx.beginPath();
        ctx.arc(x, y, arena.contactRadius / 2, 0, Math.PI * 2);
        ctx.strokeStyle = s.isTouching ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.09)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Glow
        ctx.beginPath();
        ctx.arc(x, y, arena.playerRadius * 1.45, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Core body
        ctx.beginPath();
        ctx.arc(x, y, arena.playerRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();

        // Label
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 11px "Outfit", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, y + 0.5);
      };

      drawPlayer(interp.rx, interp.ry, '#EF4444', 'rgba(239, 68, 68, 0.24)', 'R');
      drawPlayer(interp.bx, interp.by, '#3B82F6', 'rgba(59, 130, 246, 0.24)', 'B');

      // Arena border
      ctx.strokeStyle = s.isTouching ? '#F59E0B' : 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = s.isTouching ? 4 : 2;
      ctx.strokeRect(1, 1, arena.width - 2, arena.height - 2);

      // Hit flash overlay
      if (flashRef.current.alpha > 0.01) {
        ctx.fillStyle = flashRef.current.color;
        ctx.globalAlpha = flashRef.current.alpha;
        ctx.fillRect(0, 0, arena.width, arena.height);
        ctx.globalAlpha = 1;
        flashRef.current.alpha *= Math.exp(-8 * dt);
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [state.phase]);

  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
  const redJoinUrl = `${baseUrl}?room=${state.roomCode}&role=red`;
  const blueJoinUrl = `${baseUrl}?room=${state.roomCode}&role=blue`;

  const copyText = async (text: string, tag: 'code' | 'red' | 'blue') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRole(tag);
      window.setTimeout(() => setCopiedRole(null), 1800);
    } catch {
      // Fallback ignored
    }
  };

  const renderAttackCount = (val: number | 'unlimited') => (val === 'unlimited' ? '∞' : `${val}`);

  const proximityPct = Math.round((1 - state.distanceRatio) * 100);
  const currentBpm = state.isTouching
    ? 172
    : Math.round(52 + Math.pow(1 - state.distanceRatio, 1.4) * 116);

  // =========================================================================
  // LOBBY / SETUP VIEW
  // =========================================================================
  if (state.phase === 'LOBBY') {
    const bothConnected = state.red.connected && state.blue.connected;
    const bothReady = state.red.ready && state.blue.ready;

    return (
      <div className="min-h-dvh bg-[#090D14] text-slate-100 flex flex-col">
        {/* Top Bar */}
        <header className="border-b border-white/10 bg-[#0D131E] px-5 py-3.5 sm:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
                心跳對決 · 主控計分台
              </span>
              <span className="text-slate-600" aria-hidden="true">/</span>
              <button
                type="button"
                onClick={() => copyText(state.roomCode, 'code')}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-sm font-bold text-amber-300 hover:bg-amber-500/20"
              >
                <span>房號</span>
                <span className="font-mono-tabular tracking-[0.2em] text-white">{state.roomCode}</span>
                {copiedRole === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={toggleHostMute}
                aria-label={hostMuted ? '開啟主控台音效' : '靜音主控台音效'}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#101722] text-slate-300 hover:text-white"
              >
                {hostMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onLeave}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#101722] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-white/25 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                離開房間
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-6 px-5 py-6 sm:px-8 lg:grid-cols-12">
          {/* Left: Red & Blue Mobile Pairing Cards */}
          <section className="lg:col-span-7 flex flex-col gap-5">
            <div className="flex items-baseline justify-between">
              <h1 className="text-xl font-bold text-white">1. 手機裝置配對連線</h1>
              <span className="text-xs text-slate-400">請兩位玩家用手機掃描 QR Code 或輸入房號加入</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(['red', 'blue'] as const).map((side) => {
                const player = state[side];
                const isRed = side === 'red';
                const joinUrl = isRed ? redJoinUrl : blueJoinUrl;
                const copyTag = side;

                return (
                  <div
                    key={side}
                    className={`flex flex-col justify-between rounded-2xl border p-5 ${
                      isRed
                        ? 'border-red-500/25 bg-[#121622]'
                        : 'border-blue-500/25 bg-[#101724]'
                    }`}
                  >
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h2 className={`text-lg font-extrabold ${isRed ? 'text-red-400' : 'text-blue-400'}`}>
                            {isRed ? '紅方 RED' : '藍方 BLUE'}
                          </h2>
                          <p className="text-xs text-slate-400">
                            {player.connected
                              ? player.ready
                                ? '已連線 · 耳機震動已校準'
                                : '已連線 · 等待玩家點選校準'
                              : '等待手機掃碼加入'}
                          </p>
                        </div>

                        {player.connected && (
                          <button
                            type="button"
                            onClick={() => onSend({ type: 'kick_player', side })}
                            title="重置此玩家連線"
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:border-red-500/40 hover:text-red-300"
                          >
                            <UserX className="h-3.5 w-3.5" />
                            重置
                          </button>
                        )}
                      </div>

                      {/* QR Code Container */}
                      <div className="mx-auto my-3 flex w-fit flex-col items-center rounded-xl bg-white p-3">
                        <QRCodeSVG value={joinUrl} size={148} level="M" />
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyText(joinUrl, copyTag)}
                        className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#090D14] px-3 py-2 text-xs font-medium text-slate-200 hover:border-white/25"
                      >
                        {copiedRole === copyTag ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            已複製連結
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            複製加入連結
                          </>
                        )}
                      </button>

                      <a
                        href={joinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-white/10 bg-[#090D14] px-3 py-2 text-xs font-medium text-slate-300 hover:border-white/25 hover:text-white"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        新分頁
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right: Game Settings & Start Match */}
          <section className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-white/10 bg-[#101722] p-6">
            <div className="space-y-6">
              <div className="flex items-center gap-2.5 border-b border-white/10 pb-4">
                <Settings2 className="h-5 w-5 text-amber-400" />
                <h2 className="text-xl font-bold text-white">2. 對戰規則設定</h2>
              </div>

              {/* Arena Size */}
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-slate-200">場地尺寸</span>
                  <span className="font-mono-tabular text-xs text-slate-400">
                    {state.arena.width} × {state.arena.height}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {ARENA_OPTIONS.map((sizeKey) => {
                    const preset = ARENA_PRESETS[sizeKey];
                    const active = state.settings.arenaSize === sizeKey;
                    return (
                      <button
                        key={sizeKey}
                        type="button"
                        onClick={() => onSend({ type: 'update_settings', settings: { arenaSize: sizeKey } })}
                        className={`flex min-h-[60px] flex-col items-center justify-center rounded-xl border px-3 py-2 text-center transition-all ${
                          active
                            ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                            : 'border-white/10 bg-[#090D14] text-slate-400 hover:border-white/25 hover:text-slate-200'
                        }`}
                      >
                        <span className="text-sm font-bold">{preset.shortLabel}</span>
                        <span className="mt-0.5 text-[11px] opacity-80">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">{state.arena.description}</p>
              </div>

              {/* Attack Charges */}
              <div>
                <span className="mb-2 block text-sm font-semibold text-slate-200">每回合可攻擊次數</span>
                <div className="grid grid-cols-4 gap-2">
                  {ATTACK_OPTIONS.map((opt) => {
                    const active = state.settings.attackLimit === opt.value;
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => onSend({ type: 'update_settings', settings: { attackLimit: opt.value } })}
                        className={`min-h-[44px] rounded-xl border px-2 py-2 text-xs font-bold transition-all sm:text-sm ${
                          active
                            ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                            : 'border-white/10 bg-[#090D14] text-slate-400 hover:border-white/25 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  未接觸時也能按下攻擊，但會消耗一次攻擊次數。
                </p>
              </div>

              {/* Match Target */}
              <div>
                <span className="mb-2 block text-sm font-semibold text-slate-200">計分賽制</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TARGET_OPTIONS.map((opt) => {
                    const active = state.settings.targetWins === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onSend({ type: 'update_settings', settings: { targetWins: opt.value } })}
                        className={`min-h-[44px] rounded-xl border px-2 py-2 text-xs font-bold transition-all ${
                          active
                            ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                            : 'border-white/10 bg-[#090D14] text-slate-400 hover:border-white/25 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Start Match CTA */}
            <div className="mt-8 border-t border-white/10 pt-5">
              {!bothConnected ? (
                <p className="mb-3 text-center text-xs text-slate-400">
                  需等待紅方與藍方皆連線後才能開始對戰（紅方：{state.red.connected ? '已連線' : '未連線'} · 藍方：
                  {state.blue.connected ? '已連線' : '未連線'}）
                </p>
              ) : !bothReady ? (
                <p className="mb-3 text-center text-xs text-amber-300">
                  提醒：尚有選手未在手機上完成耳機與震動校準，點擊開始後仍會直接開局。
                </p>
              ) : (
                <p className="mb-3 text-center text-xs text-emerald-400">
                  雙方玩家皆已就緒，可隨時開始對戰！
                </p>
              )}

              <button
                type="button"
                disabled={!bothConnected}
                onClick={() => {
                  void audioHaptics.unlockAndTest();
                  onSend({ type: 'start_match' });
                }}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-base font-extrabold text-slate-950 transition-transform duration-150 hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-5 w-5 fill-current" />
                開始對戰
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // =========================================================================
  // ACTIVE ARENA & LIVE SCOREBOARD VIEW
  // =========================================================================
  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#090D14] text-slate-100">
      {/* Compact Top Scoreboard Strip */}
      <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0D131E] px-4 py-2.5 sm:px-6">
        {/* Red Score Cluster */}
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-xs font-bold tracking-wider text-red-400 sm:text-sm">紅方 RED</span>
            <span className="font-mono-tabular text-2xl font-extrabold text-white sm:text-4xl">
              {state.red.score}
            </span>
          </div>
          <div className="hidden sm:flex flex-col text-xs text-slate-400">
            <span>
              剩餘攻擊：<strong className="font-mono-tabular text-red-300">{renderAttackCount(state.red.attacksLeft)}</strong>
            </span>
            <span>{state.red.connected ? '連線正常' : '已斷線'}</span>
          </div>
        </div>

        {/* Center Telemetry & Round */}
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">第 {state.roundNumber} 回合</span>
            <span aria-hidden="true">·</span>
            <span>{state.arena.label}</span>
            <span aria-hidden="true">·</span>
            <span>{state.settings.targetWins > 0 ? `搶 ${state.settings.targetWins} 勝` : '自由連戰'}</span>
          </div>
          <div className="font-mono-tabular mt-0.5 text-xs font-bold sm:text-sm">
            {state.isTouching ? (
              <span className="text-amber-400">雙方接觸中 · 等待搶攻！</span>
            ) : (
              <span className="text-slate-300">
                接近度 {proximityPct}% · {currentBpm} BPM
              </span>
            )}
          </div>
        </div>

        {/* Blue Score Cluster + Host Controls */}
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="hidden sm:flex flex-col items-end text-xs text-slate-400">
            <span>
              剩餘攻擊：<strong className="font-mono-tabular text-blue-300">{renderAttackCount(state.blue.attacksLeft)}</strong>
            </span>
            <span>{state.blue.connected ? '連線正常' : '已斷線'}</span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono-tabular text-2xl font-extrabold text-white sm:text-4xl">
              {state.blue.score}
            </span>
            <span className="text-xs font-bold tracking-wider text-blue-400 sm:text-sm">BLUE 藍方</span>
          </div>

          <div className="ml-1 flex items-center gap-1.5 border-l border-white/10 pl-3">
            <button
              type="button"
              onClick={toggleHostMute}
              title={hostMuted ? '開啟音效' : '靜音'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#101722] text-slate-300 hover:text-white"
            >
              {hostMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            {state.phase === 'PLAYING' && (
              <button
                type="button"
                onClick={() => onSend({ type: 'pause_game' })}
                title="暫停對戰"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#101722] text-slate-300 hover:text-white"
              >
                <Pause className="h-4 w-4" />
              </button>
            )}

            {state.phase === 'PAUSED' && (
              <button
                type="button"
                onClick={() => onSend({ type: 'resume_game' })}
                title="繼續對戰"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
              >
                <Play className="h-4 w-4 fill-current" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onSend({ type: 'reset_match', toLobby: true })}
              title="返回規則設定"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#101722] text-slate-300 hover:text-white"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Isolated 60fps Arena Viewport (85%+ unobstructed area) */}
      <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden p-3">
        <canvas ref={canvasRef} className="rounded-lg shadow-2xl" />

        {/* Mobile-width compact attack counters */}
        <div className="pointer-events-none absolute bottom-3 left-4 right-4 flex justify-between text-xs font-mono-tabular sm:hidden">
          <span className="text-red-300">紅方攻擊：{renderAttackCount(state.red.attacksLeft)}</span>
          <span className="text-blue-300">藍方攻擊：{renderAttackCount(state.blue.attacksLeft)}</span>
        </div>

        {/* Countdown Overlay */}
        {state.phase === 'COUNTDOWN' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#090D14]/45">
            <span className="text-sm font-bold tracking-widest text-amber-300">準備聽音辨位</span>
            <span className="font-display font-mono-tabular mt-2 text-8xl font-black text-white drop-shadow-lg">
              {state.countdownValue}
            </span>
          </div>
        )}

        {/* Paused Overlay */}
        {state.phase === 'PAUSED' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#090D14]/80 p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#101722] p-6 text-center">
              <h2 className="text-2xl font-extrabold text-white">對戰已暫停</h2>
              <p className="mt-2 text-sm text-slate-400">
                {!state.red.connected || !state.blue.connected
                  ? '偵測到有選手手機斷線，請確認對方重新連線後再繼續。'
                  : '可點擊繼續對戰或返回大廳重新設定場地。'}
              </p>
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  disabled={!state.red.connected || !state.blue.connected}
                  onClick={() => onSend({ type: 'resume_game' })}
                  className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                >
                  <Play className="h-4 w-4 fill-current" />
                  繼續對戰
                </button>
                <button
                  type="button"
                  onClick={() => onSend({ type: 'reset_match', toLobby: true })}
                  className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#090D14] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-white/30"
                >
                  返回規則設定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Round Over / Match Over Modal */}
        {(state.phase === 'ROUND_OVER' || state.phase === 'MATCH_OVER') && state.lastRoundResult && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#090D14]/75 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#101722] p-6 sm:p-7 text-center shadow-2xl">
              <p className="text-xs font-bold tracking-widest text-slate-400">
                {state.phase === 'MATCH_OVER' ? '最終勝負已分' : `第 ${state.roundNumber} 回合結束`}
              </p>

              <h2
                className={`font-display mt-2 text-3xl font-black sm:text-4xl ${
                  state.lastRoundResult.winner === 'red'
                    ? 'text-red-400'
                    : state.lastRoundResult.winner === 'blue'
                      ? 'text-blue-400'
                      : 'text-amber-300'
                }`}
              >
                {state.lastRoundResult.winner === 'red'
                  ? state.phase === 'MATCH_OVER'
                    ? '紅方奪得總冠軍！'
                    : '紅方搶攻獲勝！'
                  : state.lastRoundResult.winner === 'blue'
                    ? state.phase === 'MATCH_OVER'
                      ? '藍方奪得總冠軍！'
                      : '藍方搶攻獲勝！'
                    : '攻擊次數耗盡 · 本局平手'}
              </h2>

              {state.lastRoundResult.reactionTimeMs !== null && (
                <p className="font-mono-tabular mt-2 text-sm text-slate-300">
                  接觸後反應時間：<strong className="text-amber-300">{state.lastRoundResult.reactionTimeMs} ms</strong>
                </p>
              )}

              {/* Scoreboard Summary */}
              <div className="mt-5 grid grid-cols-3 items-center rounded-xl border border-white/10 bg-[#090D14] px-4 py-3.5">
                <div>
                  <span className="block text-xs font-bold text-red-400">紅方 RED</span>
                  <span className="font-mono-tabular text-3xl font-black text-white">{state.red.score}</span>
                </div>
                <span className="font-mono-tabular text-sm font-bold text-slate-500">VS</span>
                <div>
                  <span className="block text-xs font-bold text-blue-400">藍方 BLUE</span>
                  <span className="font-mono-tabular text-3xl font-black text-white">{state.blue.score}</span>
                </div>
              </div>

              {/* Recent Round History */}
              {state.roundHistory.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
                  {state.roundHistory.slice(-6).map((r) => (
                    <span key={r.roundNumber} className="font-mono-tabular">
                      R{r.roundNumber}:{' '}
                      <strong
                        className={
                          r.winner === 'red'
                            ? 'text-red-400'
                            : r.winner === 'blue'
                              ? 'text-blue-400'
                              : 'text-amber-300'
                        }
                      >
                        {r.winner === 'red' ? '紅' : r.winner === 'blue' ? '藍' : '平'}
                      </strong>
                      {r.reactionTimeMs ? `(${r.reactionTimeMs}ms)` : ''}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                {state.phase === 'ROUND_OVER' ? (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'next_round' })}
                    className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-400"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    開始下一回合
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'start_match' })}
                    className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-400"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    原規則再戰一局
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onSend({ type: 'reset_match', toLobby: true })}
                  className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#090D14] px-5 py-3 text-sm font-semibold text-slate-200 hover:border-white/30"
                >
                  調整規則設定
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
