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
    const code = generateCode();
    convoys.set(code, { leader: socket.id, members: [socket.id] });
    socket.join(code);
    console.log(`[convoy] ${socket.id} created ${code}`);
    callback({ ok: true, code });
  });

  socket.on('join-convoy', (code, callback) => {
    const convoy = convoys.get(code);
    if (!convoy) {
      console.log(`[join] ${socket.id} tried ${code} — not found. Active: [${[...convoys.keys()]}]`);
      return callback({ ok: false, error: 'Convoiul nu există' });
    }
    convoy.members.push(socket.id);
    socket.join(code);
    socket.to(code).emit('member-joined', { memberId: socket.id, count: convoy.members.length });
    console.log(`[convoy] ${socket.id} joined ${code} (${convoy.members.length} members)`);
    callback({ ok: true, count: convoy.members.length });
  });

  socket.on('gps-update', (data) => {
    if (!convoys.has(data.code)) return;
    socket.to(data.code).emit('gps-update', {
      memberId: socket.id,
      lat: data.lat,
      lng: data.lng,
      speed: data.speed,
      heading: data.heading,
    });
  });

  // WebRTC signaling
  socket.on('webrtc-offer', ({ to, offer }) => {
    console.log(`[webrtc] offer from ${socket.id} to ${to}`);
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    console.log(`[webrtc] answer from ${socket.id} to ${to}`);
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice-candidate', ({ to, candidate }) => {
    console.log(`[webrtc] ICE from ${socket.id} to ${to}`);
    io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate });
  });

  socket.on('rejoin-convoy', (code) => {
    const convoy = convoys.get(code);
    if (!convoy) return;
    if (!convoy.members.includes(socket.id)) {
      convoy.members.push(socket.id);
    }
    socket.join(code);
    console.log(`[convoy] ${socket.id} rejoined ${code}`);
  });

  socket.on('start-convoy', (code) => {
    const convoy = convoys.get(code);
    if (!convoy || convoy.leader !== socket.id) return;
    console.log(`[convoy] ${code} started by leader`);
    io.in(code).emit('convoy-started', { code });
  });

  socket.on('voice-ready', (code) => {
    const convoy = convoys.get(code);
    const membersInConvoy = convoy ? convoy.members.filter(m => m !== socket.id) : [];
    console.log(`[voice] ${socket.id} ready in ${code}, notifying: [${membersInConvoy}]`);
    socket.to(code).emit('voice-ready', { from: socket.id });
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
