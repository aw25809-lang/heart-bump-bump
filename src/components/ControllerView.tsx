import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Headphones,
  LogOut,
  Swords,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ARENA_PRESETS,
  type ClientToServerMessage,
  type ControllerRoomState,
  type MoveInput,
} from '../shared/gameTypes';
import type { ActionFeedbackEvent } from '../hooks/useDuelSocket';
import { audioHaptics } from '../utils/audioHaptics';

interface ControllerViewProps {
  state: ControllerRoomState;
  lastFeedback: ActionFeedbackEvent | null;
  onSend: (msg: ClientToServerMessage) => void;
  onLeave: () => void;
}

type DirectionKey = keyof MoveInput;

const EMPTY_MOVE: MoveInput = { up: false, down: false, left: false, right: false };

export const ControllerView: React.FC<ControllerViewProps> = ({
  state,
  lastFeedback,
  onSend,
  onLeave,
}) => {
  const isRed = state.side === 'red';
  const sideLabel = isRed ? '紅方 RED' : '藍方 BLUE';
  const arenaLabel = ARENA_PRESETS[state.settings.arenaSize].label;

  const [muted, setMuted] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(() => audioHaptics.isUnlocked());
  const [moveInput, setMoveInput] = useState<MoveInput>(EMPTY_MOVE);
  const [beatVisual, setBeatVisual] = useState<{ bpm: number; pulse: boolean }>({ bpm: 60, pulse: false });
  const [whiffNotice, setWhiffNotice] = useState<string | null>(null);

  const activePointersRef = useRef<Map<number, DirectionKey>>(new Map());
  const heldKeysRef = useRef<Set<DirectionKey>>(new Set());
  const lastSentMoveRef = useRef<MoveInput>(EMPTY_MOVE);
  const prevTouchingRef = useRef<boolean>(false);
  const prevCountdownRef = useRef<number>(0);
  const lastFeedbackSeqRef = useRef<number>(0);

  const syncMoveToServer = useCallback(
    (next: MoveInput) => {
      const prev = lastSentMoveRef.current;
      if (
        prev.up === next.up &&
        prev.down === next.down &&
        prev.left === next.left &&
        prev.right === next.right
      ) {
        return;
      }
      lastSentMoveRef.current = next;
      setMoveInput(next);
      onSend({ type: 'move_input', input: next });
    },
    [onSend],
  );

  const recomputeMoveInput = useCallback(() => {
    const next: MoveInput = { up: false, down: false, left: false, right: false };
    for (const dir of activePointersRef.current.values()) {
      next[dir] = true;
    }
    for (const dir of heldKeysRef.current.values()) {
      next[dir] = true;
    }
    syncMoveToServer(next);
  }, [syncMoveToServer]);

  const clearAllInputs = useCallback(() => {
    activePointersRef.current.clear();
    heldKeysRef.current.clear();
    syncMoveToServer(EMPTY_MOVE);
  }, [syncMoveToServer]);

  // Clear held inputs when phase leaves PLAYING or window blurs
  useEffect(() => {
    if (state.phase !== 'PLAYING') {
      clearAllInputs();
    }
  }, [state.phase, clearAllInputs]);

  useEffect(() => {
    const onBlur = () => clearAllInputs();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [clearAllInputs]);

  // Audio heartbeat lifecycle
  useEffect(() => {
    audioHaptics.setBeatListener((bpm) => {
      setBeatVisual({ bpm, pulse: true });
      window.setTimeout(() => {
        setBeatVisual((prev) => ({ ...prev, pulse: false }));
      }, 140);
    });
    return () => {
      audioHaptics.setBeatListener(null);
      audioHaptics.stopHeartbeat();
    };
  }, []);

  useEffect(() => {
    audioHaptics.updateTelemetry(state.distanceRatio, state.isTouching);
    if (state.phase === 'PLAYING') {
      audioHaptics.startHeartbeat();
    } else {
      audioHaptics.stopHeartbeat();
    }
  }, [state.phase, state.distanceRatio, state.isTouching]);

  // Contact vibration + sonar alert cue
  useEffect(() => {
    if (state.phase !== 'PLAYING') {
      prevTouchingRef.current = false;
      return;
    }

    if (state.isTouching && !prevTouchingRef.current) {
      prevTouchingRef.current = true;
      audioHaptics.triggerContactCue(true);
    } else if (!state.isTouching && prevTouchingRef.current) {
      prevTouchingRef.current = false;
    }

    if (!state.isTouching) return;

    const repeatTimer = window.setInterval(() => {
      audioHaptics.triggerContactCue(false);
    }, 650);

    return () => window.clearInterval(repeatTimer);
  }, [state.isTouching, state.phase]);

  // Countdown tick sound on player headphones
  useEffect(() => {
    if (muted) return;
    if (state.phase === 'COUNTDOWN' && state.countdownValue !== prevCountdownRef.current) {
      prevCountdownRef.current = state.countdownValue;
      audioHaptics.playCountdownTick(state.countdownValue);
    } else if (state.phase === 'PLAYING' && prevCountdownRef.current !== 0) {
      prevCountdownRef.current = 0;
      audioHaptics.playCountdownTick(0);
    }
  }, [state.phase, state.countdownValue, muted]);

  // Handle server action feedback (whiff, hit_win, hit_lose, empty)
  useEffect(() => {
    if (!lastFeedback || lastFeedback.seq === lastFeedbackSeqRef.current) return;
    lastFeedbackSeqRef.current = lastFeedback.seq;

    if (lastFeedback.kind === 'whiff') {
      audioHaptics.playWhiff();
      const leftTxt =
        lastFeedback.attacksLeft === 'unlimited' ? '無限次' : `剩餘 ${lastFeedback.attacksLeft} 次`;
      setWhiffNotice(`揮空！${leftTxt}`);
      const t = window.setTimeout(() => setWhiffNotice(null), 900);
      return () => window.clearTimeout(t);
    }
    if (lastFeedback.kind === 'hit_win') {
      audioHaptics.playHitWin();
    } else if (lastFeedback.kind === 'hit_lose') {
      audioHaptics.playHitLose();
    }
  }, [lastFeedback]);

  const handleCalibrate = async () => {
    const ok = await audioHaptics.unlockAndTest();
    setAudioUnlocked(ok || true);
    onSend({ type: 'set_ready', ready: true });
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioHaptics.setMuted(next);
    if (!next) {
      void audioHaptics.unlockAndTest();
      setAudioUnlocked(true);
    }
  };

  const handleAttack = useCallback(() => {
    if (!audioHaptics.isUnlocked()) {
      void audioHaptics.unlockAndTest().then(() => setAudioUnlocked(true));
    }
    if (state.phase !== 'PLAYING') return;
    if (typeof state.myAttacksLeft === 'number' && state.myAttacksLeft <= 0) return;
    onSend({ type: 'attack' });
  }, [state.phase, state.myAttacksLeft, onSend]);

  // Keyboard fallback for desktop/laptop browser testing
  useEffect(() => {
    const mapKey = (key: string): DirectionKey | null => {
      switch (key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          return 'up';
        case 's':
        case 'arrowdown':
          return 'down';
        case 'a':
        case 'arrowleft':
          return 'left';
        case 'd':
        case 'arrowright':
          return 'right';
        default:
          return null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleAttack();
        return;
      }
      const dir = mapKey(e.key);
      if (dir && state.phase === 'PLAYING') {
        e.preventDefault();
        heldKeysRef.current.add(dir);
        recomputeMoveInput();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const dir = mapKey(e.key);
      if (dir) {
        heldKeysRef.current.delete(dir);
        recomputeMoveInput();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [state.phase, recomputeMoveInput, handleAttack]);

  const bindDpadPointer = (dir: DirectionKey) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (!audioHaptics.isUnlocked()) {
        void audioHaptics.unlockAndTest().then(() => setAudioUnlocked(true));
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if capture fails
      }
      activePointersRef.current.set(e.pointerId, dir);
      recomputeMoveInput();
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      activePointersRef.current.delete(e.pointerId);
      recomputeMoveInput();
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      activePointersRef.current.delete(e.pointerId);
      recomputeMoveInput();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const attacksLeftLabel =
    state.myAttacksLeft === 'unlimited' ? '∞' : `${state.myAttacksLeft}`;
  const outOfAmmo = typeof state.myAttacksLeft === 'number' && state.myAttacksLeft <= 0;

  // =========================================================================
  // LOBBY WAITING & AUDIO/HAPTIC CALIBRATION VIEW
  // =========================================================================
  if (state.phase === 'LOBBY') {
    return (
      <div className="flex min-h-dvh w-full flex-col justify-between bg-[#090D14] px-5 py-6 text-slate-100">
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <span className={`text-lg font-black ${isRed ? 'text-red-400' : 'text-blue-400'}`}>
              {sideLabel}
            </span>
            <p className="font-mono-tabular text-xs text-slate-400">房間：{state.roomCode}</p>
          </div>
          <button
            type="button"
            onClick={onLeave}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/10 bg-[#101722] px-3 py-2 text-xs text-slate-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            退出
          </button>
        </header>

        <main className="mx-auto my-auto flex w-full max-w-md flex-col items-center py-6 text-center">
          <div
            className={`mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border ${
              isRed
                ? 'border-red-500/35 bg-red-500/15 text-red-400'
                : 'border-blue-500/35 bg-blue-500/15 text-blue-400'
            }`}
          >
            <Headphones className="h-9 w-9" />
          </div>

          <h1 className="text-2xl font-extrabold text-white">請戴上耳機準備對戰</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            對戰開始後手機不會顯示地圖。請專心聆聽耳機內的心跳聲：距離越近心跳越快越響；接觸瞬間手機將震動提示，搶先按下攻擊鍵即獲勝！
          </p>

          {/* Synced Host Rules Summary */}
          <div className="mt-6 grid w-full grid-cols-3 gap-2 rounded-xl border border-white/10 bg-[#101722] p-3.5 text-center">
            <div>
              <span className="block text-[11px] text-slate-400">場地尺寸</span>
              <strong className="mt-0.5 block text-sm text-white">{arenaLabel}</strong>
            </div>
            <div>
              <span className="block text-[11px] text-slate-400">攻擊次數</span>
              <strong className="font-mono-tabular mt-0.5 block text-sm text-white">
                {state.settings.attackLimit === 'unlimited' ? '無限次' : `${state.settings.attackLimit} 次`}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] text-slate-400">賽制目標</span>
              <strong className="mt-0.5 block text-sm text-white">
                {state.settings.targetWins > 0 ? `搶 ${state.settings.targetWins} 勝` : '自由連戰'}
              </strong>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCalibrate}
            className={`mt-6 flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl px-5 py-3.5 text-base font-extrabold text-white transition-transform active:scale-[0.98] ${
              state.ready
                ? 'border border-emerald-500/50 bg-emerald-600/25 text-emerald-200'
                : isRed
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            <Vibrate className="h-5 w-5" />
            {state.ready ? '已校準就緒（點擊可再測試音效與震動）' : '點擊啟用耳機心跳與震動測試'}
          </button>

          {!audioHaptics.supportsVibration() && (
            <p className="mt-3 text-xs text-amber-300/90">
              偵測到此瀏覽器不支援網頁震動（例如 iOS Safari），接觸時將改以「螢幕琥珀閃爍 + 耳機鎖定提示音」提醒。
            </p>
          )}

          <p className="mt-5 text-xs text-slate-400">
            對手連線狀態：
            <strong className="text-slate-200">
              {state.opponentConnected ? (state.opponentReady ? '已連線並就緒' : '已連線（校準中）') : '等待加入中'}
            </strong>
          </p>
        </main>

        <footer className="text-center text-xs text-slate-500">
          等待主控計分台按下「開始對戰」
        </footer>
      </div>
    );
  }

  // =========================================================================
  // ACTIVE MOBILE CONTROLLER VIEW (BLIND ACOUSTIC + MULTI-TOUCH D-PAD & ATTACK)
  // =========================================================================
  const contactHighlight = state.isTouching && state.phase === 'PLAYING';

  return (
    <div
      className={`touch-control relative flex h-dvh w-full flex-col justify-between overflow-hidden transition-colors duration-100 ${
        contactHighlight
          ? 'bg-[#261805] ring-4 ring-inset ring-amber-400'
          : 'bg-[#090D14]'
      }`}
    >
      {/* Top Compact Status Strip */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0D131E]/95 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-black ${isRed ? 'text-red-400' : 'text-blue-400'}`}>
            {sideLabel}
          </span>
          <span className="font-mono-tabular text-xs text-slate-300">
            比分 <strong className="text-white">{state.myScore}</strong> : {state.opponentScore}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!audioUnlocked && (
            <button
              type="button"
              onClick={handleCalibrate}
              className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-slate-950"
            >
              點此開聲音
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? '開啟音效' : '靜音'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#101722] text-slate-300"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onLeave}
            aria-label="離開房間"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#101722] text-slate-300"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Center Blind Acoustic Heartbeat Indicator (Zero Map Leak) */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-4 text-center">
        {/* Heartbeat Pulse Ring */}
        <div
          className={`flex h-36 w-36 flex-col items-center justify-center rounded-full border-2 transition-transform duration-150 sm:h-44 sm:w-44 ${
            contactHighlight
              ? 'scale-110 border-amber-400 bg-amber-500/20 shadow-[0_0_45px_rgba(245,158,11,0.45)]'
              : beatVisual.pulse
                ? isRed
                  ? 'scale-105 border-red-500/80 bg-red-500/15'
                  : 'scale-105 border-blue-500/80 bg-blue-500/15'
                : 'scale-100 border-white/10 bg-[#101722]/70'
          }`}
        >
          {contactHighlight ? (
            <>
              <span className="text-lg font-black text-amber-300">已接觸！</span>
              <span className="mt-1 text-xs font-bold text-amber-100">立即按攻擊！</span>
            </>
          ) : whiffNotice ? (
            <span className="text-sm font-extrabold text-amber-300">{whiffNotice}</span>
          ) : state.phase === 'PLAYING' ? (
            <>
              <span className="font-mono-tabular text-3xl font-black text-white">
                {beatVisual.bpm}
              </span>
              <span className="text-[11px] font-medium tracking-wider text-slate-400">
                心跳 BPM · 盲戰模式
              </span>
            </>
          ) : (
            <span className="text-sm font-bold text-slate-300">
              {state.phase === 'COUNTDOWN'
                ? `倒數 ${state.countdownValue}`
                : state.phase === 'PAUSED'
                  ? '對戰暫停中'
                  : '回合結算'}
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-xs text-slate-400">
          <span>
            剩餘攻擊次數：
            <strong className={`font-mono-tabular ${outOfAmmo ? 'text-red-400' : 'text-white'}`}>
              {attacksLeftLabel}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>第 {state.roundNumber} 回合</span>
        </div>

        {/* Countdown / Paused / Round Over Inline Overlay */}
        {state.phase !== 'PLAYING' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#090D14]/80 p-5">
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#101722] p-6 text-center">
              {state.phase === 'COUNTDOWN' && (
                <>
                  <p className="text-xs font-bold tracking-widest text-amber-300">對戰即將開始</p>
                  <p className="font-mono-tabular mt-2 text-7xl font-black text-white">
                    {state.countdownValue}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">請將雙手拇指放上方向鍵與攻擊鍵</p>
                </>
              )}

              {state.phase === 'PAUSED' && (
                <>
                  <h2 className="text-xl font-extrabold text-white">對戰已暫停</h2>
                  <p className="mt-2 text-xs text-slate-400">請等待主控計分台恢復對戰或重新開局</p>
                </>
              )}

              {(state.phase === 'ROUND_OVER' || state.phase === 'MATCH_OVER') && state.lastRoundResult && (
                <>
                  <p className="text-xs font-bold text-slate-400">
                    {state.phase === 'MATCH_OVER' ? '總賽果出爐' : `第 ${state.roundNumber} 回合結束`}
                  </p>
                  <h2
                    className={`mt-1.5 text-2xl font-black ${
                      state.lastRoundResult.winner === state.side
                        ? 'text-emerald-400'
                        : state.lastRoundResult.winner === 'draw'
                          ? 'text-amber-300'
                          : 'text-red-400'
                    }`}
                  >
                    {state.lastRoundResult.winner === state.side
                      ? '你搶攻獲勝！'
                      : state.lastRoundResult.winner === 'draw'
                        ? '雙方次數耗盡 · 平手'
                        : '對手搶先一步！'}
                  </h2>
                  {state.lastRoundResult.reactionTimeMs !== null && (
                    <p className="font-mono-tabular mt-1.5 text-xs text-slate-300">
                      接觸反應時間：{state.lastRoundResult.reactionTimeMs} ms
                    </p>
                  )}
                  <p className="font-mono-tabular mt-4 text-lg font-extrabold text-white">
                    目前比分 {state.myScore} : {state.opponentScore}
                  </p>
                  <p className="mt-3 text-xs text-slate-400">等待主控台開啟下一回合</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Ergonomic Multi-Touch Thumb Zone (D-Pad Left + Attack Right) */}
      <section className="touch-control shrink-0 border-t border-white/10 bg-[#0D131E] px-4 pt-4 pb-6 sm:px-8 sm:pb-8">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          {/* Left: 4-Way D-Pad (Up / Down / Left / Right) */}
          <div className="grid grid-cols-3 grid-rows-3 gap-2">
            <div />
            <button
              type="button"
              aria-label="向上移動"
              {...bindDpadPointer('up')}
              className={`touch-control flex h-[56px] w-[56px] items-center justify-center rounded-xl border transition-transform sm:h-[64px] sm:w-[64px] ${
                moveInput.up
                  ? 'scale-95 border-white bg-slate-200 text-slate-950'
                  : 'border-white/15 bg-[#151E2E] text-slate-200'
              }`}
            >
              <ArrowUp className="h-6 w-6" />
            </button>
            <div />

            <button
              type="button"
              aria-label="向左移動"
              {...bindDpadPointer('left')}
              className={`touch-control flex h-[56px] w-[56px] items-center justify-center rounded-xl border transition-transform sm:h-[64px] sm:w-[64px] ${
                moveInput.left
                  ? 'scale-95 border-white bg-slate-200 text-slate-950'
                  : 'border-white/15 bg-[#151E2E] text-slate-200'
              }`}
            >
              <ArrowLeft className="h-6 w-6" />
            </button>

            <div className="flex h-[56px] w-[56px] items-center justify-center rounded-xl border border-white/5 bg-[#090D14] text-[10px] font-bold text-slate-500 sm:h-[64px] sm:w-[64px]">
              移動
            </div>

            <button
              type="button"
              aria-label="向右移動"
              {...bindDpadPointer('right')}
              className={`touch-control flex h-[56px] w-[56px] items-center justify-center rounded-xl border transition-transform sm:h-[64px] sm:w-[64px] ${
                moveInput.right
                  ? 'scale-95 border-white bg-slate-200 text-slate-950'
                  : 'border-white/15 bg-[#151E2E] text-slate-200'
              }`}
            >
              <ArrowRight className="h-6 w-6" />
            </button>

            <div />
            <button
              type="button"
              aria-label="向下移動"
              {...bindDpadPointer('down')}
              className={`touch-control flex h-[56px] w-[56px] items-center justify-center rounded-xl border transition-transform sm:h-[64px] sm:w-[64px] ${
                moveInput.down
                  ? 'scale-95 border-white bg-slate-200 text-slate-950'
                  : 'border-white/15 bg-[#151E2E] text-slate-200'
              }`}
            >
              <ArrowDown className="h-6 w-6" />
            </button>
            <div />
          </div>

          {/* Right: Primary Attack Trigger */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              disabled={outOfAmmo || state.phase !== 'PLAYING'}
              onPointerDown={(e) => {
                e.preventDefault();
                handleAttack();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={`touch-control flex h-32 w-32 flex-col items-center justify-center rounded-full border-4 font-display transition-transform duration-100 active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 sm:h-36 sm:w-36 ${
                contactHighlight
                  ? 'border-amber-200 bg-amber-500 text-slate-950 shadow-[0_0_40px_rgba(245,158,11,0.75)]'
                  : isRed
                    ? 'border-red-400/70 bg-red-600 text-white shadow-[0_0_24px_rgba(239,68,68,0.35)]'
                    : 'border-blue-400/70 bg-blue-600 text-white shadow-[0_0_24px_rgba(59,130,246,0.35)]'
              }`}
            >
              <Swords className="h-8 w-8 sm:h-9 sm:w-9" />
              <span className="mt-1 text-lg font-black tracking-wide">
                {outOfAmmo ? '已耗盡' : '攻擊'}
              </span>
              <span className="font-mono-tabular text-[11px] font-bold opacity-85">
                {state.myAttacksLeft === 'unlimited' ? '無限次' : `剩 ${state.myAttacksLeft} 次`}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
