import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { API_BASE_URL, refreshAccessTokenOnce } from '../api/client';

// Socket.IO is served from the API's origin (no /api/v1) — see backend/src/sockets/index.js.
const SOCKET_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

// Lightweight order summary pushed on every order save — see backend/src/sockets/orderEvents.js.
export interface OrderEventPayload {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  grandTotal: number;
  customer: string | null;
  store: string | null;
  delivery: string | null;
  pickTasks: { picker: string | null; store: string | null; status: string }[];
  updatedAt: string;
}

let socket: Socket | null = null;
function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SOCKET_URL, {
    autoConnect: false,
    // Read on every (re)connect attempt, so a token refreshed by the axios interceptor is picked up.
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
  });

  socket.on('connect_error', async (err) => {
    // Network errors are retried by Socket.IO itself (socket.active stays true). A rejection from
    // the server's auth middleware is not — refresh the access token once and retry manually.
    if (socket?.active) return;
    if (/token/i.test(err.message) && (await refreshAccessTokenOnce())) socket?.connect();
  });

  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected && !s.active) s.connect();
}

export function disconnectSocket() {
  socket?.disconnect();
}

export function onSocketEvent<T>(event: string, handler: (payload: T) => void): () => void {
  const s = getSocket();
  s.on(event, handler);
  return () => {
    s.off(event, handler);
  };
}
