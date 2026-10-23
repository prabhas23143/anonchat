import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

// Initialize Socket.io on the same HTTP server
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// State Management for Omegle Matchmaking
let waitingQueue: string[] = [];
const userRooms = new Map<string, string>();
const userPartners = new Map<string, string>();

function broadcastStats() {
  const onlineCount = io.engine.clientsCount;
  const waitingCount = waitingQueue.length;
  const activeChats = Math.floor(userRooms.size / 2);
  io.emit('stats-update', {
    onlineCount,
    waitingCount,
    activeChats,
  });
}

function leaveCurrentChat(socketId: string) {
  const socket = io.sockets.sockets.get(socketId);
  const currentRoom = userRooms.get(socketId);
  const partnerId = userPartners.get(socketId);

  if (currentRoom) {
    if (socket) socket.leave(currentRoom);
    userRooms.delete(socketId);
  }

  if (partnerId) {
    userPartners.delete(socketId);
    userPartners.delete(partnerId);

    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) {
      if (currentRoom) partnerSocket.leave(currentRoom);
      userRooms.delete(partnerId);
      partnerSocket.emit('partner-disconnected', {
        reason: 'Stranger has disconnected or skipped to the next chat.',
      });
    }
  }
}

function removeFromQueue(socketId: string) {
  const index = waitingQueue.indexOf(socketId);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

function tryPairing() {
  while (waitingQueue.length >= 2) {
    const user1Id = waitingQueue.shift()!;
    const user2Id = waitingQueue.shift()!;

    const socket1 = io.sockets.sockets.get(user1Id);
    const socket2 = io.sockets.sockets.get(user2Id);

    if (!socket1 || !socket1.connected) {
      if (socket2 && socket2.connected) {
        waitingQueue.unshift(user2Id);
      }
      continue;
    }

    if (!socket2 || !socket2.connected) {
      if (socket1 && socket1.connected) {
        waitingQueue.unshift(user1Id);
      }
      continue;
    }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    socket1.join(roomId);
    socket2.join(roomId);

    userRooms.set(user1Id, roomId);
    userRooms.set(user2Id, roomId);

    userPartners.set(user1Id, user2Id);
    userPartners.set(user2Id, user1Id);

    socket1.emit('partner-found', { roomId, role: 'Stranger' });
    socket2.emit('partner-found', { roomId, role: 'Stranger' });

    console.log(`[MATCH] Paired ${user1Id} and ${user2Id} in ${roomId}`);
  }

  broadcastStats();
}

io.on('connection', (socket) => {
  broadcastStats();

  socket.on('find-partner', () => {
    leaveCurrentChat(socket.id);
    removeFromQueue(socket.id);

    waitingQueue.push(socket.id);
    socket.emit('waiting', {
      message: 'Looking for someone you can chat with...',
      queuePosition: waitingQueue.length,
    });

    tryPairing();
  });

  socket.on('chat-message', (data: any) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) {
      socket.emit('error-message', { message: 'You are not connected to a stranger.' });
      return;
    }

    const rawText = typeof data === 'string' ? data : data?.text;
    if (!rawText || typeof rawText !== 'string') return;

    const trimmed = rawText.trim();
    if (!trimmed) return;

    const text = trimmed.slice(0, 2000);
    const timestamp = new Date().toISOString();

    socket.to(roomId).emit('chat-message', {
      text,
      sender: 'stranger',
      timestamp,
    });
  });

  socket.on('typing', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) socket.to(roomId).emit('typing');
  });

  socket.on('stop-typing', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) socket.to(roomId).emit('stop-typing');
  });

  socket.on('next-partner', () => {
    leaveCurrentChat(socket.id);
    removeFromQueue(socket.id);

    waitingQueue.push(socket.id);
    socket.emit('waiting', {
      message: 'Looking for someone you can chat with...',
      queuePosition: waitingQueue.length,
    });

    tryPairing();
  });

  socket.on('stop-chat', () => {
    leaveCurrentChat(socket.id);
    removeFromQueue(socket.id);
    socket.emit('chat-stopped', {
      message: 'You have stopped the chat.',
    });
    broadcastStats();
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    leaveCurrentChat(socket.id);
    broadcastStats();
  });
});

// Serve the standalone static frontend at /standalone
app.use('/standalone', express.static(path.join(__dirname, 'frontend')));

// API endpoint to inspect all generated source files
app.get('/api/code-files', (req, res) => {
  try {
    const files = {
      backendPackageJson: fs.readFileSync(path.join(__dirname, 'backend', 'package.json'), 'utf-8'),
      backendServerJs: fs.readFileSync(path.join(__dirname, 'backend', 'server.js'), 'utf-8'),
      frontendIndexHtml: fs.readFileSync(path.join(__dirname, 'frontend', 'index.html'), 'utf-8'),
      frontendStyleCss: fs.readFileSync(path.join(__dirname, 'frontend', 'style.css'), 'utf-8'),
      frontendScriptJs: fs.readFileSync(path.join(__dirname, 'frontend', 'script.js'), 'utf-8'),
    };
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    onlineCount: io.engine.clientsCount,
    waitingCount: waitingQueue.length,
    activeChats: Math.floor(userRooms.size / 2),
  });
});

async function startServer() {
  // Mount Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve dist folder
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AnonChat Server running on http://0.0.0.0:${PORT}`);
    console.log(`Standalone frontend available at http://0.0.0.0:${PORT}/standalone/`);
  });
}

startServer();
