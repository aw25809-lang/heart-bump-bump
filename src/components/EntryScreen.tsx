import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Monitor, Server, Smartphone, Vibrate, Zap } from 'lucide-react';
import type { ClientRole, PlayerSide } from '../shared/gameTypes';

interface EntryScreenProps {
  connected: boolean;
  activeWsUrl: string;
  customWsUrl: string;
  hasEnvWsUrl: boolean;
  errorMessage: string | null;
  initialRoomCode: string;
  initialRole: PlayerSide;
  onClearError: () => void;
  onSetCustomWsUrl: (url: string) => void;
  onCreateHostRoom: () => void;
  onJoinRoom: (code: string, role: ClientRole) => void;
}

export const EntryScreen: React.FC<EntryScreenProps> = ({
  connected,
  activeWsUrl,
  customWsUrl,
  hasEnvWsUrl,
  errorMessage,
  initialRoomCode,
  initialRole,
  onClearError,
  onSetCustomWsUrl,
  onCreateHostRoom,
  onJoinRoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [selectedSide, setSelectedSide] = useState<PlayerSide>(initialRole);
  const [wsInput, setWsInput] = useState(customWsUrl);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const isStaticHost =
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('github.io') &&
    !hasEnvWsUrl &&
    !customWsUrl;

  useEffect(() => {
    setWsInput(customWsUrl);
  }, [customWsUrl]);

  useEffect(() => {
    if (initialRoomCode) setJoinCode(initialRoomCode);
  }, [initialRoomCode]);

  useEffect(() => {
    setSelectedSide(initialRole);
  }, [initialRole]);

  // Atmospheric live acoustic radar background canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      elapsed += dt;

      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      // Subtle tactical grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
      ctx.lineWidth = 1;
      const step = 48;
      ctx.beginPath();
      for (let x = (w % step) / 2; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = (h % step) / 2; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Orbiting Red & Blue acoustic beacons
      const cx = w * 0.5;
      const cy = h * 0.48;
      const radiusX = Math.min(w * 0.28, 280);
      const radiusY = Math.min(h * 0.18, 150);

      const redX = cx + Math.cos(elapsed * 0.45) * radiusX;
      const redY = cy + Math.sin(elapsed * 0.65) * radiusY;
      const blueX = cx + Math.cos(elapsed * 0.45 + Math.PI) * radiusX;
      const blueY = cy + Math.sin(elapsed * 0.65 + Math.PI) * radiusY;

      const drawWaves = (px: number, py: number, rgb: string, phaseOffset: number) => {
        for (let i = 0; i < 3; i++) {
          const t = ((elapsed * 0.55 + phaseOffset + i / 3) % 1);
          const r = 14 + t * 140;
          const alpha = (1 - t) * 0.18;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, 0.65)`;
        ctx.fill();
      };

      drawWaves(redX, redY, '239, 68, 68', 0);
      drawWaves(blueX, blueY, '59, 130, 246', 0.35);

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onJoinRoom(joinCode, selectedSide);
  };

  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden bg-[#090D14] text-slate-100 flex flex-col justify-between">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full"
      />

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-8 sm:px-8">
        {/* Title Lockup */}
        <div className="mb-8 text-center sm:mb-10">
          <div className="mx-auto mb-3 inline-flex items-center justify-center">
            <svg
              width="52"
              height="36"
              viewBox="0 0 52 36"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M2 18H12L17 6L23 30L29 12L34 22L38 18H50"
                stroke="url(#pulseGrad)"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient id="pulseGrad" x1="2" y1="18" x2="50" y2="18" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#EF4444" />
                  <stop offset="0.5" stopColor="#F59E0B" />
                  <stop offset="1" stopColor="#3B82F6" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h1 className="font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl text-balance">
            心跳對決
          </h1>
          <p className="mt-2 text-sm text-slate-400 sm:text-base">
            三裝置即時聽覺與震動雙人競技 · Heartbeat Duel
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mx-auto mb-6 flex w-full max-w-2xl items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-950/60 px-4 py-3 text-sm text-red-200"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={onClearError}
              className="shrink-0 text-xs font-medium text-red-300 underline hover:text-white"
            >
              關閉
            </button>
          </div>
        )}

        {/* Two Entry Paths: Host Console vs Player Mobile Controller */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Card 1: Host / Scoreboard */}
          <section className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#101722]/90 p-6 sm:p-7">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                  <Monitor className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">主控計分台</h2>
                  <p className="text-xs text-slate-400">第 1 台裝置 · 電腦或平板大螢幕</p>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-slate-300">
                建立對戰房間並產生紅、藍兩方掃碼連結。負責設定場地大小（小／中／大）、攻擊次數限制與賽制，即時呈現場上雙方位置、距離脈衝與比分數據。
              </p>
            </div>

            <div className="mt-6">
              <button
                type="button"
                disabled={!connected}
                onClick={onCreateHostRoom}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 transition-transform duration-150 hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Monitor className="h-4 w-4" />
                {connected ? '建立對戰房間' : '連線伺服器中...'}
              </button>
            </div>
          </section>

          {/* Card 2: Mobile Player Join */}
          <section className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#101722]/90 p-6 sm:p-7">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-200">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">選手手機加入</h2>
                  <p className="text-xs text-slate-400">第 2、3 台裝置 · 需佩戴耳機</p>
                </div>
              </div>

              <form id="join-form" onSubmit={handleJoinSubmit} className="space-y-4">
                <div>
                  <label htmlFor="room-code-input" className="mb-1.5 block text-xs font-medium text-slate-400">
                    輸入主控台 4 碼房號
                  </label>
                  <input
                    id="room-code-input"
                    type="text"
                    maxLength={6}
                    autoCapitalize="characters"
                    autoComplete="off"
                    value={joinCode}
                    onChange={(e) => {
                      onClearError();
                      setJoinCode(e.target.value.toUpperCase());
                    }}
                    placeholder="例如：H7K2"
                    className="font-mono-tabular w-full rounded-xl border border-white/10 bg-[#090D14] px-4 py-3 text-center text-xl font-bold tracking-[0.25em] text-white placeholder:tracking-normal placeholder:text-sm placeholder:font-normal placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <span className="mb-1.5 block text-xs font-medium text-slate-400">選擇對戰陣營</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedSide('red')}
                      className={`min-h-[46px] rounded-xl border px-3 py-2.5 text-sm font-bold transition-all ${
                        selectedSide === 'red'
                          ? 'border-red-500 bg-red-500/20 text-red-200'
                          : 'border-white/10 bg-[#090D14] text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                    >
                      紅方 RED
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSide('blue')}
                      className={`min-h-[46px] rounded-xl border px-3 py-2.5 text-sm font-bold transition-all ${
                        selectedSide === 'blue'
                          ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                          : 'border-white/10 bg-[#090D14] text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                    >
                      藍方 BLUE
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="mt-5">
              <button
                type="submit"
                form="join-form"
                disabled={!connected || joinCode.trim().length < 3}
                className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition-transform duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
                  selectedSide === 'red'
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                加入{selectedSide === 'red' ? '紅方' : '藍方'}控制器
              </button>
            </div>
          </section>
        </div>

        {/* Concise Mechanics Strip */}
        <div className="mt-8 grid grid-cols-1 gap-3 border-t border-white/10 pt-6 text-xs text-slate-400 sm:grid-cols-3 sm:gap-6">
          <div className="flex items-center gap-2.5">
            <Headphones className="h-4 w-4 shrink-0 text-amber-400" />
            <span>手機盲戰視野，戴耳機依心跳聲強弱辨別距離</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Vibrate className="h-4 w-4 shrink-0 text-amber-400" />
            <span>虛擬空間內接觸瞬間，手機震動與脈衝同步提示</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Zap className="h-4 w-4 shrink-0 text-amber-400" />
            <span>接觸時搶先按下攻擊鍵獲勝，未接觸揮擊會消耗次數</span>
          </div>
        </div>

        {/* External WebSocket Server Config (Helpful for GitHub Pages static deployment) */}
        <div className="mt-5">
          {(isStaticHost || !connected || showServerConfig) && (
            <div className="rounded-xl border border-white/10 bg-[#101722]/90 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-300">
                  <Server className="h-4 w-4 text-amber-400" />
                  <span>
                    {connected
                      ? `已連線對戰伺服器：${activeWsUrl}`
                      : isStaticHost
                        ? '目前為靜態託管環境且尚未設定 VITE_WS_URL，請輸入外部後端 WebSocket 位址：'
                        : `無法連線至伺服器（${activeWsUrl}），可手動指定外部 WebSocket 位址：`}
                  </span>
                </div>
                {connected && (
                  <button
                    type="button"
                    onClick={() => setShowServerConfig(false)}
                    className="text-slate-400 underline hover:text-white"
                  >
                    收合
                  </button>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onSetCustomWsUrl(wsInput);
                }}
                className="mt-3 flex flex-col gap-2 sm:flex-row"
              >
                <input
                  type="text"
                  value={wsInput}
                  onChange={(e) => setWsInput(e.target.value)}
                  placeholder="例如：wss://your-server.run.app/ws"
                  className="font-mono-tabular flex-1 rounded-lg border border-white/10 bg-[#090D14] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="min-h-[36px] rounded-lg bg-amber-500 px-4 py-1.5 font-bold text-slate-950 hover:bg-amber-400"
                  >
                    套用連線
                  </button>
                  {customWsUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setWsInput('');
                        onSetCustomWsUrl('');
                      }}
                      className="min-h-[36px] rounded-lg border border-white/10 px-3 py-1.5 text-slate-300 hover:text-white"
                    >
                      恢復預設
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {connected && !showServerConfig && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowServerConfig(true)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                切換外部 WebSocket 伺服器位址
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
