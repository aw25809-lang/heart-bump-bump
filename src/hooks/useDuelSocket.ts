import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientRole,
  ClientToServerMessage,
  ControllerRoomState,
  HostRoomState,
  ServerToClientMessage,
} from '../shared/gameTypes';

function getOrCreateClientId(): string {
  try {
    const existing = sessionStorage.getItem('hd_client_id');
    if (existing) return existing;
    const generated = `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    sessionStorage.setItem('hd_client_id', generated);
    return generated;
  } catch {
    return `c_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export type ActionFeedbackEvent = Extract<ServerToClientMessage, { type: 'action_feedback' }> & {
  seq: number;
};

export interface UseDuelSocketReturn {
  connected: boolean;
  roomCode: string | null;
  role: ClientRole | null;
  hostState: HostRoomState | null;
  controllerState: ControllerRoomState | null;
  lastFeedback: ActionFeedbackEvent | null;
  errorMessage: string | null;
  clearError: () => void;
  createRoom: () => void;
  joinRoom: (code: string, role: ClientRole) => void;
  leaveRoom: () => void;
  send: (msg: ClientToServerMessage) => void;
}

export function useDuelSocket(): UseDuelSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(getOrCreateClientId());
  const desiredSessionRef = useRef<{ roomCode: string | null; role: ClientRole | null; pendingCreate: boolean }>({
    roomCode: null,
    role: null,
    pendingCreate: false,
  });
  const reconnectTimerRef = useRef<number | null>(null);
  const feedbackSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const [connected, setConnected] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [role, setRole] = useState<ClientRole | null>(null);
  const [hostState, setHostState] = useState<HostRoomState | null>(null);
  const [controllerState, setControllerState] = useState<ControllerRoomState | null>(null);
  const [lastFeedback, setLastFeedback] = useState<ActionFeedbackEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sendRaw = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      const desired = desiredSessionRef.current;
      if (desired.pendingCreate) {
        desired.pendingCreate = false;
        ws.send(JSON.stringify({ type: 'create_room' } satisfies ClientToServerMessage));
      } else if (desired.roomCode && desired.role) {
        ws.send(
          JSON.stringify({
            type: 'join_room',
            roomCode: desired.roomCode,
            role: desired.role,
            clientId: clientIdRef.current,
          } satisfies ClientToServerMessage),
        );
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg: ServerToClientMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerToClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'room_created') {
        desiredSessionRef.current.roomCode = msg.roomCode;
        desiredSessionRef.current.role = 'host';
        setRoomCode(msg.roomCode);
        setRole('host');
      } else if (msg.type === 'joined') {
        desiredSessionRef.current.roomCode = msg.roomCode;
        desiredSessionRef.current.role = msg.role;
        setRoomCode(msg.roomCode);
        setRole(msg.role);
        setErrorMessage(null);
      } else if (msg.type === 'host_state') {
        setHostState(msg.state);
      } else if (msg.type === 'controller_state') {
        setControllerState(msg.state);
      } else if (msg.type === 'action_feedback') {
        feedbackSeqRef.current += 1;
        setLastFeedback({ ...msg, seq: feedbackSeqRef.current });
      } else if (msg.type === 'error') {
        setErrorMessage(msg.message);
        if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'ROLE_OCCUPIED' || msg.code === 'KICKED') {
          desiredSessionRef.current.roomCode = null;
          desiredSessionRef.current.role = null;
          setRoomCode(null);
          setRole(null);
          setHostState(null);
          setControllerState(null);
        }
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, 1000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const createRoom = useCallback(() => {
    setErrorMessage(null);
    desiredSessionRef.current = { roomCode: null, role: 'host', pendingCreate: true };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      desiredSessionRef.current.pendingCreate = false;
      sendRaw({ type: 'create_room' });
    } else {
      connect();
    }
  }, [connect, sendRaw]);

  const joinRoom = useCallback(
    (code: string, targetRole: ClientRole) => {
      const normalized = code.trim().toUpperCase();
      if (!normalized) {
        setErrorMessage('請輸入 4 碼房號');
        return;
      }
      setErrorMessage(null);
      desiredSessionRef.current = { roomCode: normalized, role: targetRole, pendingCreate: false };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        sendRaw({
          type: 'join_room',
          roomCode: normalized,
          role: targetRole,
          clientId: clientIdRef.current,
        });
      } else {
        connect();
      }
    },
    [connect, sendRaw],
  );

  const leaveRoom = useCallback(() => {
    desiredSessionRef.current = { roomCode: null, role: null, pendingCreate: false };
    sendRaw({ type: 'leave_room' });
    setRoomCode(null);
    setRole(null);
    setHostState(null);
    setControllerState(null);
    setErrorMessage(null);
    // Clean URL query params without reloading
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [sendRaw]);

  const clearError = useCallback(() => setErrorMessage(null), []);

  return {
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
    send: sendRaw,
  };
}
