/**
 * AnonChat - Production-ready Socket.io Random Text Chat Backend
 * Designed for 0-cost deployment on Render.com (Web Service - Free Tier)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Environment & Port configuration (Render passes PORT automatically)
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || '*';

// Enable CORS for Express REST routes
app.use(cors({
  origin: CLIENT_URL === '*' ? true : CLIENT_URL.split(','),
  methods: ['GET', 'POST'],
  credentials: true,
}));

app.use(express.json());

// Initialize Socket.io with permissive CORS for Cloudflare Pages frontend
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL === '*' ? '*' : CLIENT_URL.split(','),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// State Management
// Array of socket IDs currently waiting for a chat partner
let waitingQueue = [];

// Map of socket.id -> roomId
const userRooms = new Map();

// Map of socket.id -> partner socket.id
const userPartners = new Map();

/**
 * Helper: Broadcast current online stats to all connected users
 */
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

/**
 * Helper: Safely leave any active chat and inform the partner
 */
function leaveCurrentChat(socket) {
  const currentRoom = userRooms.get(socket.id);
  const partnerId = userPartners.get(socket.id);

  if (currentRoom) {
    socket.leave(currentRoom);
    userRooms.delete(socket.id);
  }

  if (partnerId) {
    userPartners.delete(socket.id);
    userPartners.delete(partnerId);

    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket) {
      partnerSocket.leave(currentRoom);
      userRooms.delete(partnerId);
      partnerSocket.emit('partner-disconnected', {
        reason: 'Stranger has disconnected or skipped to the next chat.',
      });
    }
  }
}

/**
 * Helper: Remove a socket ID from the waiting queue
 */
function removeFromQueue(socketId) {
  const index = waitingQueue.indexOf(socketId);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

/**
 * Matchmaking algorithm: pair waiting users into isolated Socket.io rooms
 */
function tryPairing() {
  while (waitingQueue.length >= 2) {
    const user1Id = waitingQueue.shift();
    const user2Id = waitingQueue.shift();

    const socket1 = io.sockets.sockets.get(user1Id);
    const socket2 = io.sockets.sockets.get(user2Id);

    // If either socket disconnected while waiting in queue, skip them
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

    // Both sockets are valid & connected: create a unique room ID
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    socket1.join(roomId);
    socket2.join(roomId);

    userRooms.set(user1Id, roomId);
    userRooms.set(user2Id, roomId);

    userPartners.set(user1Id, user2Id);
    userPartners.set(user2Id, user1Id);

    // Notify both clients that a partner has been found
    socket1.emit('partner-found', { roomId, role: 'Stranger' });
    socket2.emit('partner-found', { roomId, role: 'Stranger' });

    console.log(`[MATCH] Paired ${user1Id} and ${user2Id} in ${roomId}`);
  }

  broadcastStats();
}

// Socket.io Connection & Event Handling
io.on('connection', (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);
  broadcastStats();

  /**
   * User clicks 'Start / Find Stranger' or requests a new match
   */
  socket.on('find-partner', () => {
    // 1. Leave any active chat or pairing first
    leaveCurrentChat(socket);

    // 2. Prevent duplicate entries in waiting queue
    removeFromQueue(socket.id);

    // 3. Add to queue & notify client that search is active
    waitingQueue.push(socket.id);
    socket.emit('waiting', {
      message: 'Looking for someone you can chat with...',
      queuePosition: waitingQueue.length,
    });

    console.log(`[QUEUE] User ${socket.id} joined waiting queue (Queue length: ${waitingQueue.length})`);

    // 4. Trigger pairing
    tryPairing();
  });

  /**
   * Relay chat messages to partner in the same room
   */
  socket.on('chat-message', (data) => {
    const roomId = userRooms.get(socket.id);
    if (!roomId) {
      socket.emit('error-message', { message: 'You are not connected to a stranger.' });
      return;
    }

    const rawText = typeof data === 'string' ? data : data?.text;
    if (!rawText || typeof rawText !== 'string') return;

    const trimmed = rawText.trim();
    if (trimmed.length === 0) return;

    // Limit maximum character length to 2000 chars for safety
    const text = trimmed.slice(0, 2000);
    const timestamp = new Date().toISOString();

    // Relay solely to the other client(s) in this room
    socket.to(roomId).emit('chat-message', {
      text,
      sender: 'stranger',
      timestamp,
    });
  });

  /**
   * Real-time typing indicators
   */
  socket.on('typing', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('typing');
    }
  });

  socket.on('stop-typing', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('stop-typing');
    }
  });

  /**
   * Skip / Next handler: leaves current room and immediately queues for next stranger
   */
  socket.on('next-partner', () => {
    console.log(`[SKIP] User ${socket.id} skipped current chat.`);
    leaveCurrentChat(socket);
    removeFromQueue(socket.id);

    waitingQueue.push(socket.id);
    socket.emit('waiting', {
      message: 'Looking for someone you can chat with...',
      queuePosition: waitingQueue.length,
    });

    tryPairing();
  });

  /**
   * Stop handler: leaves current room and does not re-queue
   */
  socket.on('stop-chat', () => {
    console.log(`[STOP] User ${socket.id} stopped chat.`);
    leaveCurrentChat(socket);
    removeFromQueue(socket.id);
    socket.emit('chat-stopped', {
      message: 'You have stopped the chat.',
    });
    broadcastStats();
  });

  /**
   * Disconnect handler: cleans up all references
   */
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] User disconnected: ${socket.id}`);
    removeFromQueue(socket.id);
    leaveCurrentChat(socket);
    broadcastStats();
  });
});

// REST Health Check & Keep-Alive Endpoints (for Render free-tier health checks / UptimeRobot)
app.get('/', (req, res) => {
  res.json({
    name: 'AnonChat Socket.io Server',
    status: 'online',
    version: '1.0.0',
    onlineUsers: io.engine.clientsCount,
    waitingQueue: waitingQueue.length,
    activeRooms: Math.floor(userRooms.size / 2),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start HTTP + Socket.io Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(` AnonChat Server running on port ${PORT}`);
  console.log(` Mode: 0-Cost Render.com Deployment Ready`);
  console.log(` CORS Client: ${CLIENT_URL}`);
  console.log(`=========================================`);
});
