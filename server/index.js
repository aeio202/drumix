const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const io = new Server(PORT, {
  cors: { origin: '*' },
});

const convoys = new Map();

const WORDS = [
  'WOLF', 'BEAR', 'HAWK', 'LYNX', 'BOLT', 'FURY', 'BLAZ', 'IRON',
  'STORM', 'FANG', 'CLAW', 'VIPER', 'RUSH', 'APEX', 'ONYX', 'FIRE',
  'DARK', 'GRIT', 'HUNT', 'KING', 'FAST', 'ROAD', 'TANK', 'WARP',
];

function generateCode() {
  for (let i = 0; i < 10; i++) {
    const code = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (!convoys.has(code)) return code;
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * 26)];
  return code;
}

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('create-convoy', (callback) => {
    if (typeof callback !== 'function') return;
    try {
      const code = generateCode();
      convoys.set(code, { leader: socket.id, members: [socket.id] });
      socket.join(code);
      console.log(`[convoy] ${socket.id} created ${code}`);
      callback({ ok: true, code });
    } catch (err) {
      console.error('[create-convoy] error:', err);
      callback({ ok: false, error: 'Internal server error' });
    }
  });

  socket.on('join-convoy', (code, callback) => {
    if (typeof callback !== 'function') return;
    if (typeof code !== 'string' || !code.trim()) {
      return callback({ ok: false, error: 'Invalid convoy code' });
    }
    try {
      const convoy = convoys.get(code);
      if (!convoy) {
        console.log(`[join] ${socket.id} tried ${code} — not found. Active: [${[...convoys.keys()]}]`);
        return callback({ ok: false, error: 'Convoiul nu există' });
      }
      if (convoy.members.includes(socket.id)) {
        return callback({ ok: true, count: convoy.members.length });
      }
      convoy.members.push(socket.id);
      socket.join(code);
      socket.to(code).emit('member-joined', { memberId: socket.id, count: convoy.members.length });
      console.log(`[convoy] ${socket.id} joined ${code} (${convoy.members.length} members)`);
      callback({ ok: true, count: convoy.members.length });
    } catch (err) {
      console.error('[join-convoy] error:', err);
      callback({ ok: false, error: 'Internal server error' });
    }
  });

  socket.on('gps-update', (data) => {
    if (!data || typeof data.code !== 'string') return;
    if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return;
    const convoy = convoys.get(data.code);
    if (!convoy || !convoy.members.includes(socket.id)) return;
    socket.to(data.code).emit('gps-update', {
      memberId: socket.id,
      lat: data.lat,
      lng: data.lng,
      speed: typeof data.speed === 'number' ? data.speed : 0,
      heading: typeof data.heading === 'number' ? data.heading : 0,
    });
  });

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    if (!data || typeof data.to !== 'string' || !data.offer) return;
    console.log(`[webrtc] offer from ${socket.id} to ${data.to}`);
    io.to(data.to).emit('webrtc-offer', { from: socket.id, offer: data.offer });
  });

  socket.on('webrtc-answer', (data) => {
    if (!data || typeof data.to !== 'string' || !data.answer) return;
    console.log(`[webrtc] answer from ${socket.id} to ${data.to}`);
    io.to(data.to).emit('webrtc-answer', { from: socket.id, answer: data.answer });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    if (!data || typeof data.to !== 'string' || !data.candidate) return;
    console.log(`[webrtc] ICE from ${socket.id} to ${data.to}`);
    io.to(data.to).emit('webrtc-ice-candidate', { from: socket.id, candidate: data.candidate });
  });

  socket.on('rejoin-convoy', (code) => {
    if (typeof code !== 'string' || !code.trim()) return;
    try {
      const convoy = convoys.get(code);
      if (!convoy) return;
      if (!convoy.members.includes(socket.id)) {
        convoy.members.push(socket.id);
      }
      socket.join(code);
      console.log(`[convoy] ${socket.id} rejoined ${code}`);
    } catch (err) {
      console.error('[rejoin-convoy] error:', err);
    }
  });

  socket.on('set-destination', (data) => {
    if (!data || typeof data.code !== 'string') return;
    if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return;
    try {
      const convoy = convoys.get(data.code);
      if (!convoy || convoy.leader !== socket.id) return;
      convoy.destination = { lat: data.lat, lng: data.lng };
      io.in(data.code).emit('destination-set', { lat: data.lat, lng: data.lng });
      console.log(`[convoy] ${data.code} destination set: ${data.lat}, ${data.lng}`);
    } catch (err) {
      console.error('[set-destination] error:', err);
    }
  });

  socket.on('start-convoy', (code) => {
    if (typeof code !== 'string' || !code.trim()) return;
    try {
      const convoy = convoys.get(code);
      if (!convoy || convoy.leader !== socket.id) return;
      console.log(`[convoy] ${code} started by leader`);
      io.in(code).emit('convoy-started', { code, count: convoy.members.length });
    } catch (err) {
      console.error('[start-convoy] error:', err);
    }
  });

  socket.on('voice-ready', (code) => {
    if (typeof code !== 'string' || !code.trim()) return;
    try {
      const convoy = convoys.get(code);
      if (!convoy || !convoy.members.includes(socket.id)) return;
      const membersInConvoy = convoy.members.filter(m => m !== socket.id);
      console.log(`[voice] ${socket.id} ready in ${code}, notifying: [${membersInConvoy}]`);
      socket.to(code).emit('voice-ready', { from: socket.id });
    } catch (err) {
      console.error('[voice-ready] error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    for (const [code, convoy] of convoys) {
      const idx = convoy.members.indexOf(socket.id);
      if (idx === -1) continue;
      convoy.members.splice(idx, 1);
      socket.to(code).emit('member-left', { memberId: socket.id, count: convoy.members.length });
      if (convoy.members.length === 0) {
        convoys.delete(code);
        console.log(`[convoy] ${code} deleted (empty)`);
      }
    }
  });
});

console.log(`Drumix server running on port ${PORT}`);
