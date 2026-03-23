import { io } from 'socket.io-client';

const SERVER_URL = 'https://drumix.onrender.com';

export const socket = io(SERVER_URL, {
  autoConnect: false,
});
