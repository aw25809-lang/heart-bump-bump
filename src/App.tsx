import { useEffect, useMemo, useRef } from 'react';
import { EntryScreen } from './components/EntryScreen';
import { HostView } from './components/HostView';
import { ControllerView } from './components/ControllerView';
import { useDuelSocket } from './hooks/useDuelSocket';
import type { PlayerSide } from './shared/gameTypes';

export default function App() {
  const {
    connected,
    roomCode,
    role,
    hostState,
    controllerState,
    lastFeedback,
    errorMessage,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
    send,
  } = useDuelSocket();

  const urlParams = useMemo(() => {
    if (typeof window === 'undefined') {
      return { room: '', role: 'red' as PlayerSide, hasDirectJoin: false };
    }
    const params = new URLSearchParams(window.location.search);
    const room = (params.get('room') || '').trim().toUpperCase();
    const rawRole = params.get('role');
    const parsedRole: PlayerSide = rawRole === 'blue' ? 'blue' : 'red';
    return {
      room,
      role: parsedRole,
      hasDirectJoin: room.length >= 3 && (rawRole === 'red' || rawRole === 'blue'),
    };
  }, []);

  // Auto-join when scanning QR code URL (?room=XXXX&role=red|blue)
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (connected && urlParams.hasDirectJoin && !autoJoinedRef.current && !roomCode) {
      autoJoinedRef.current = true;
      joinRoom(urlParams.room, urlParams.role);
    }
  }, [connected, urlParams, roomCode, joinRoom]);

  if (role === 'host' && hostState) {
    return <HostView state={hostState} onSend={send} onLeave={leaveRoom} />;
  }

  if ((role === 'red' || role === 'blue') && controllerState) {
    return (
      <ControllerView
        state={controllerState}
        lastFeedback={lastFeedback}
        onSend={send}
        onLeave={leaveRoom}
      />
    );
  }

  return (
    <EntryScreen
      connected={connected}
      errorMessage={errorMessage}
      initialRoomCode={urlParams.room}
      initialRole={urlParams.role}
      onClearError={clearError}
      onCreateHostRoom={createRoom}
      onJoinRoom={joinRoom}
    />
  );
}
