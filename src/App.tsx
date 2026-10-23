/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import JSZip from 'jszip';
import {
  MessageSquare,
  Users,
  Copy,
  Check,
  Download,
  Server,
  Globe,
  DollarSign,
  Play,
  Square,
  SkipForward,
  Send,
  Volume2,
  VolumeX,
  ExternalLink,
  ShieldCheck,
  Zap,
  Code2,
  FileCode,
  Layers,
  ArrowRight,
  Terminal,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'you' | 'stranger' | 'system';
  text: string;
  timestamp: string;
  tone?: 'default' | 'success' | 'danger';
}

interface ServerStats {
  onlineCount: number;
  waitingCount: number;
  activeChats: number;
}

// Pre-loaded generated source files for inspection and 1-click export
const SOURCE_FILES = {
  'backend/package.json': {
    path: 'backend/package.json',
    lang: 'json',
    desc: 'Render.com Node.js dependencies (express, socket.io, cors) and start script.',
    code: `{
  "name": "omegle-clone-backend",
  "version": "1.0.0",
  "description": "Zero-cost real-time pairing and random text chat backend for Render deployment",
  "main": "server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "keywords": [
    "omegle-clone",
    "socket.io",
    "random-chat",
    "realtime",
    "render"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  }
}`,
  },
  'backend/server.js': {
    path: 'backend/server.js',
    lang: 'javascript',
    desc: 'Express + Socket.io server with matchmaking queue, room isolation, message relay, typing indicators, and Render health-checks.',
    code: `/**
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
    const roomId = \`room_\${Date.now()}_\${Math.random().toString(36).substring(2, 9)}\`;

    socket1.join(roomId);
    socket2.join(roomId);

    userRooms.set(user1Id, roomId);
    userRooms.set(user2Id, roomId);

    userPartners.set(user1Id, user2Id);
    userPartners.set(user2Id, user1Id);

    // Notify both clients that a partner has been found
    socket1.emit('partner-found', { roomId, role: 'Stranger' });
    socket2.emit('partner-found', { roomId, role: 'Stranger' });

    console.log(\`[MATCH] Paired \${user1Id} and \${user2Id} in \${roomId}\`);
  }

  broadcastStats();
}

// Socket.io Connection & Event Handling
io.on('connection', (socket) => {
  console.log(\`[CONNECT] User connected: \${socket.id}\`);
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

    console.log(\`[QUEUE] User \${socket.id} joined waiting queue (Queue length: \${waitingQueue.length})\`);

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
    console.log(\`[SKIP] User \${socket.id} skipped current chat.\`);
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
    console.log(\`[STOP] User \${socket.id} stopped chat.\`);
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
    console.log(\`[DISCONNECT] User \${socket.id} disconnected\`);
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
  console.log(\`=========================================\`);
  console.log(\` AnonChat Server running on port \${PORT}\`);
  console.log(\` Mode: 0-Cost Render.com Deployment Ready\`);
  console.log(\` CORS Client: \${CLIENT_URL}\`);
  console.log(\`=========================================\`);
});`,
  },
  'frontend/index.html': {
    path: 'frontend/index.html',
    lang: 'html',
    desc: 'Clean dark-mode mobile-friendly HTML with Adsterra/PropellerAds placeholders, status badge, and control buttons.',
    code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>AnonChat - Free Anonymous Random Text Chat</title>
  <meta name="description" content="Talk to strangers anonymously. Fast, free, random text-only chat with zero registration required." />
  <link rel="stylesheet" href="style.css" />
  
  <!-- Socket.io client from official CDN for standalone Cloudflare Pages deployment -->
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>

  <!-- ========================================================================= -->
  <!-- AD NETWORK PLACEHOLDER (Adsterra / PropellerAds / PopCash / Monetag)       -->
  <!-- ========================================================================= -->
  <!-- 
    Instructions for Ad Networks:
    1. For Adsterra Social Bar or PropellerAds OnClick/Push:
       Paste your global script tag directly inside the <head> below:
       <script type="text/javascript" src="//pl12345678.highperformancegate.com/xx/yy/zz.js"></script>
    2. For Banner Ads (728x90 Leaderboard or 320x50 Mobile Banner):
       Place the iframe/script code inside the .ad-banner-slot divs below.
  -->
</head>
<body>
  <div class="app-wrapper">
    <!-- Top Ad Network Banner Container -->
    <header class="app-header">
      <div class="header-main">
        <div class="brand">
          <div class="brand-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div class="brand-text">
            <span class="brand-title">Anon<span class="accent-text">Chat</span></span>
            <span class="brand-tag">Omegle Clone</span>
          </div>
        </div>

        <div class="header-meta">
          <div class="meta-item online-pill" id="online-counter" title="Total users connected">
            <span class="status-pulse-dot online"></span>
            <span id="online-text">Connecting...</span>
          </div>
          
          <button id="sound-toggle-btn" class="icon-action-btn" title="Toggle audio chime" aria-label="Toggle Sound">
            <svg id="sound-icon-on" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
            <svg id="sound-icon-off" class="hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
        </div>
      </div>

      <!-- Header Ad Slot (Configured for Adsterra 728x90 / 320x50 or PropellerAds Banner) -->
      <div class="ad-banner-slot" id="header-ad-container">
        <!-- REPLACE THIS WITH YOUR ADSTERRA / PROPELLERADS SCRIPT -->
        <div class="ad-placeholder-label">
          <span>SPONSORED AD SPACE (728x90 / 320x50 Adsterra • PropellerAds)</span>
        </div>
      </div>
    </header>

    <!-- Main Chat Workspace -->
    <main class="chat-viewport">
      <!-- Status Bar -->
      <div class="chat-status-bar" id="chat-status-bar">
        <div class="status-indicator">
          <span class="status-indicator-dot idle" id="status-indicator-dot"></span>
          <span class="status-text" id="status-text">Disconnected. Press "Start" to meet someone new!</span>
        </div>
        <div class="server-config-hint" id="server-config-indicator" title="Connected backend">
          <span class="server-badge" id="backend-label">Render: Connecting...</span>
        </div>
      </div>

      <!-- Message History Container -->
      <div class="chat-messages" id="chat-messages">
        <!-- Welcome intro card -->
        <div class="system-card" id="welcome-card">
          <div class="system-card-icon">👋</div>
          <h3>Welcome to AnonChat!</h3>
          <p>
            You are talking to a random stranger. Chats are completely anonymous, private, and text-only.
            No registration or credit card needed.
          </p>
          <ul class="guidelines-list">
            <li>Be respectful. Hate speech and harassment will get you reported.</li>
            <li>Press <strong>Esc</strong> on keyboard to quickly skip to the next stranger.</li>
            <li>Press <strong>Enter</strong> to send your message.</li>
          </ul>
        </div>
      </div>

      <!-- Typing Indicator -->
      <div class="typing-indicator-bar hidden" id="typing-indicator">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span class="typing-label">Stranger is typing...</span>
      </div>
    </main>

    <!-- Bottom Control Bar -->
    <footer class="chat-controls">
      <div class="control-actions-row">
        <!-- Primary Action Toggle: Start / Find Stranger -->
        <button id="btn-start" class="btn btn-primary" title="Find a random partner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span class="btn-text">Start Chat</span>
        </button>

        <!-- Skip / Next Button (Esc shortcut) -->
        <button id="btn-next" class="btn btn-secondary hidden" title="Disconnect and find someone else (Esc)" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 4 15 12 5 20 5 4"></polygon>
            <line x1="19" y1="5" x2="19" y2="19"></line>
          </svg>
          <span class="btn-text">Next <kbd class="kbd-hint">Esc</kbd></span>
        </button>

        <!-- Stop / Disconnect Button -->
        <button id="btn-stop" class="btn btn-danger hidden" title="End this conversation" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12"></rect>
          </svg>
          <span class="btn-text">Stop</span>
        </button>
      </div>

      <!-- Message Input Form -->
      <form id="chat-form" class="chat-input-form" autocomplete="off">
        <input
          type="text"
          id="message-input"
          class="chat-input"
          placeholder="Type your message here... (Press Enter to send)"
          maxlength="2000"
          disabled
          autocomplete="off"
        />
        <button type="submit" id="btn-send" class="btn btn-send" disabled title="Send message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    </footer>

    <!-- Bottom Ad Banner (Mobile friendly 300x250 or 320x50 Adsterra / PropellerAds) -->
    <div class="ad-footer-slot">
      <div class="ad-placeholder-label mini">
        <span>ADVERTISEMENT (PropellerAds / Adsterra / Popunder script placeholder)</span>
      </div>
    </div>
  </div>

  <script src="script.js"></script>
</body>
</html>`,
  },
  'frontend/style.css': {
    path: 'frontend/style.css',
    lang: 'css',
    desc: 'Modern dark theme styling with 100dvh mobile flex layout, pulse dots, typing bounce, and message bubbles.',
    code: `/* ==========================================================================
   AnonChat - Modern Dark Theme Stylesheet
   Designed for High Performance & Zero-Cost Cloudflare Pages Deployment
   ========================================================================== */

:root {
  --bg-primary: #0a0f1d;
  --bg-secondary: #111827;
  --bg-tertiary: #1f2937;
  --bg-card: rgba(31, 41, 55, 0.7);
  --border-color: #374151;
  --border-light: #4b5563;

  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;

  --accent-cyan: #06b6d4;
  --accent-blue: #3b82f6;
  --accent-green: #10b981;
  --accent-red: #ef4444;
  --accent-amber: #f59e0b;

  --stranger-msg-bg: #1e293b;
  --stranger-border: #38bdf8;
  --stranger-tag: #38bdf8;

  --you-msg-bg: #1e3a5f;
  --you-border: #60a5fa;
  --you-tag: #93c5fd;

  --system-msg-bg: rgba(31, 41, 55, 0.85);

  --font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 100%;
  height: 100%;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-family);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.app-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1100px;
  height: 100dvh;
  margin: 0 auto;
  background-color: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  position: relative;
}

.app-header {
  flex-shrink: 0;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.header-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
  color: #ffffff;
  border-radius: var(--radius-md);
  box-shadow: 0 0 12px rgba(6, 182, 212, 0.3);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.accent-text {
  color: var(--accent-cyan);
}

.brand-tag {
  font-size: 0.72rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.online-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  padding: 5px 12px;
  border-radius: 9999px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-primary);
}

.status-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--text-muted);
}

.status-pulse-dot.online {
  background-color: var(--accent-green);
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
  animation: pulse-green 2s infinite;
}

@keyframes pulse-green {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

.icon-action-btn {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-action-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-light);
  background-color: #2a3749;
}

.ad-banner-slot {
  width: 100%;
  min-height: 52px;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ad-placeholder-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  font-weight: 500;
  padding: 6px;
  text-align: center;
}

.ad-placeholder-label.mini {
  font-size: 0.68rem;
  padding: 4px;
}

.ad-footer-slot {
  flex-shrink: 0;
  background-color: var(--bg-primary);
  border-top: 1px solid var(--border-color);
  padding: 4px 10px;
  text-align: center;
}

.chat-viewport {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--bg-primary);
  position: relative;
}

.chat-status-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.85rem;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 500;
}

.status-indicator-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transition: all 0.3s ease;
}

.status-indicator-dot.idle {
  background-color: var(--text-muted);
}

.status-indicator-dot.searching {
  background-color: var(--accent-amber);
  animation: pulse-amber 1.2s infinite;
}

.status-indicator-dot.connected {
  background-color: var(--accent-green);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
}

@keyframes pulse-amber {
  0% { transform: scale(0.9); opacity: 0.7; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.7; }
}

.status-text {
  color: var(--text-primary);
}

.server-config-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.server-badge {
  background-color: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.system-card {
  align-self: center;
  max-width: 560px;
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  backdrop-filter: blur(8px);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin: 16px auto;
  text-align: center;
  box-shadow: var(--shadow-md);
}

.system-card-icon {
  font-size: 2.2rem;
  margin-bottom: 8px;
}

.system-card h3 {
  font-size: 1.2rem;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.system-card p {
  color: var(--text-secondary);
  font-size: 0.92rem;
  margin-bottom: 14px;
}

.guidelines-list {
  text-align: left;
  list-style-type: none;
  font-size: 0.85rem;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(17, 24, 39, 0.6);
  padding: 12px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.guidelines-list li {
  position: relative;
  padding-left: 18px;
}

.guidelines-list li::before {
  content: "•";
  position: absolute;
  left: 4px;
  color: var(--accent-cyan);
  font-weight: bold;
}

.message-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  animation: fadeInMsg 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes fadeInMsg {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-row.stranger { align-items: flex-start; }
.message-row.you { align-items: flex-end; }
.message-row.system { align-items: center; margin: 6px 0; }

.message-bubble {
  max-width: 82%;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  word-break: break-word;
  white-space: pre-wrap;
  font-size: 0.96rem;
  line-height: 1.45;
  box-shadow: var(--shadow-sm);
  position: relative;
}

.message-sender-tag {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
  display: block;
}

.message-row.stranger .message-sender-tag { color: var(--stranger-tag); }
.message-row.stranger .message-bubble {
  background-color: var(--stranger-msg-bg);
  border: 1px solid rgba(56, 189, 248, 0.25);
  border-top-left-radius: 2px;
  color: var(--text-primary);
}

.message-row.you .message-sender-tag { color: var(--you-tag); text-align: right; }
.message-row.you .message-bubble {
  background-color: var(--you-msg-bg);
  border: 1px solid rgba(96, 165, 250, 0.35);
  border-top-right-radius: 2px;
  color: #ffffff;
}

.message-time {
  display: inline-block;
  font-size: 0.68rem;
  color: var(--text-muted);
  margin-top: 4px;
  margin-left: 8px;
}

.system-pill {
  background-color: var(--system-msg-bg);
  border: 1px solid var(--border-color);
  color: var(--accent-amber);
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 0.84rem;
  font-weight: 500;
  text-align: center;
  max-width: 90%;
}

.system-pill.notice-danger {
  color: var(--accent-red);
  border-color: rgba(239, 68, 68, 0.3);
}

.system-pill.notice-success {
  color: var(--accent-green);
  border-color: rgba(16, 185, 129, 0.3);
}

.typing-indicator-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  background: rgba(17, 24, 39, 0.7);
  border-top: 1px solid var(--border-color);
  font-size: 0.82rem;
  color: var(--accent-cyan);
}

.typing-dots {
  display: flex;
  gap: 4px;
}

.typing-dots span {
  width: 6px;
  height: 6px;
  background-color: var(--accent-cyan);
  border-radius: 50%;
  animation: typingBounce 1.4s infinite ease-in-out both;
}

.typing-dots span:nth-child(1) { animation-delay: -0.32s; }
.typing-dots span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typingBounce {
  0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.chat-controls {
  flex-shrink: 0;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.control-actions-row {
  display: flex;
  gap: 10px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 16px;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
  user-select: none;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.btn-primary {
  background: linear-gradient(135deg, #2563eb, #0284c7);
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.4);
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #1d4ed8, #0369a1);
  transform: translateY(-1px);
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background-color: #374151;
  border-color: var(--border-light);
}

.btn-danger {
  background-color: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.btn-danger:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.kbd-hint {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 0.72rem;
  font-family: inherit;
  color: var(--text-secondary);
}

.chat-input-form {
  display: flex;
  gap: 8px;
  align-items: center;
}

.chat-input {
  flex: 1;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 11px 14px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.chat-input:focus:not(:disabled) {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.2);
}

.chat-input:disabled {
  background-color: rgba(17, 24, 39, 0.4);
  cursor: not-allowed;
  color: var(--text-muted);
}

.btn-send {
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
  color: #ffffff;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.btn-send:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(6, 182, 212, 0.4);
}

.hidden {
  display: none !important;
}

@media (max-width: 640px) {
  .app-wrapper { border: none; }
  .app-header { padding: 8px 12px; }
  .brand-title { font-size: 1.1rem; }
  .chat-status-bar { padding: 6px 12px; font-size: 0.8rem; }
  .server-config-hint { display: none; }
  .chat-messages { padding: 12px; gap: 10px; }
  .message-bubble { max-width: 90%; font-size: 0.92rem; }
  .system-card { padding: 16px; margin: 8px 0; }
  .chat-controls { padding: 10px 12px; }
  .btn { padding: 8px 12px; font-size: 0.86rem; }
  .btn-send { width: 40px; height: 40px; }
  .chat-input { padding: 9px 12px; font-size: 0.9rem; }
}`,
  },
  'frontend/script.js': {
    path: 'frontend/script.js',
    lang: 'javascript',
    desc: 'Client-side Socket.io connector, Web Audio chimes, typing throttler, Enter/Esc keyboard shortcuts, and state manager.',
    code: `/**
 * AnonChat - Production-ready Client-side Chat Logic
 * Designed for 0-cost deployment on Cloudflare Pages (Frontend) + Render.com (Backend)
 */

(function () {
  'use strict';

  // 1. BACKEND URL CONFIGURATION
  const urlParams = new URLSearchParams(window.location.search);
  const overrideUrl = urlParams.get('server') || localStorage.getItem('RENDER_SOCKET_URL');

  const DEFAULT_RENDER_URL = 'https://your-omegle-backend.onrender.com';
  
  const isLocalOrPreview = window.location.hostname === 'localhost' ||
                           window.location.hostname === '127.0.0.1' ||
                           window.location.hostname.includes('.run.app') ||
                           window.location.hostname.includes('webcontainer');

  const BACKEND_URL = overrideUrl || (isLocalOrPreview ? window.location.origin : DEFAULT_RENDER_URL);

  // 2. DOM ELEMENT REFERENCES
  const statusIndicatorDot = document.getElementById('status-indicator-dot');
  const statusText = document.getElementById('status-text');
  const onlineText = document.getElementById('online-text');
  const backendLabel = document.getElementById('backend-label');
  const chatMessages = document.getElementById('chat-messages');
  const typingIndicator = document.getElementById('typing-indicator');

  const btnStart = document.getElementById('btn-start');
  const btnNext = document.getElementById('btn-next');
  const btnStop = document.getElementById('btn-stop');

  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const btnSend = document.getElementById('btn-send');

  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundIconOn = document.getElementById('sound-icon-on');
  const soundIconOff = document.getElementById('sound-icon-off');

  // 3. APPLICATION STATE
  let socket = null;
  let chatState = 'disconnected';
  let soundEnabled = localStorage.getItem('anonchat_sound') !== 'false';
  let typingTimeout = null;
  let isTyping = false;

  if (backendLabel) {
    try {
      const parsed = new URL(BACKEND_URL);
      backendLabel.textContent = \`Server: \${parsed.hostname}\`;
    } catch {
      backendLabel.textContent = \`Server: Custom\`;
    }
  }

  updateSoundIcon();

  // 4. AUDIO NOTIFICATIONS (Web Audio API - Zero Asset Files Required)
  let audioCtx = null;

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (!soundEnabled) return;
    try {
      initAudioContext();
      if (!audioCtx) return;

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }

  function playPartnerFoundSound() {
    playTone(587.33, 0.12, 'sine', 0.2);
    setTimeout(() => { playTone(880, 0.25, 'sine', 0.2); }, 120);
  }

  function playMessageSound() {
    playTone(740, 0.08, 'triangle', 0.15);
  }

  function playDisconnectSound() {
    playTone(440, 0.15, 'sine', 0.15);
    setTimeout(() => { playTone(330, 0.2, 'sine', 0.15); }, 120);
  }

  function updateSoundIcon() {
    if (soundEnabled) {
      soundIconOn.classList.remove('hidden');
      soundIconOff.classList.add('hidden');
    } else {
      soundIconOn.classList.add('hidden');
      soundIconOff.classList.remove('hidden');
    }
  }

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('anonchat_sound', soundEnabled ? 'true' : 'false');
    updateSoundIcon();
    if (soundEnabled) {
      playTone(660, 0.1);
    }
  });

  // 5. SOCKET.IO CONNECTION INITIALIZATION
  function initSocket() {
    if (typeof io === 'undefined') {
      appendSystemMessage('Socket.io client library failed to load from CDN. Check your internet connection.', 'danger');
      return;
    }

    setConnectionStatus('idle', 'Connecting to real-time server...');

    try {
      socket = io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 15000,
      });

      setupSocketEvents();
    } catch (err) {
      console.error('Socket init error:', err);
      setConnectionStatus('disconnected', \`Connection error: \${err.message}\`);
    }
  }

  function setupSocketEvents() {
    socket.on('connect', () => {
      console.log('[SOCKET] Connected to server, ID:', socket.id);
      setConnectionStatus('idle', 'Connected. Press "Start Chat" to find a stranger.');
      if (backendLabel) {
        backendLabel.textContent = \`Server: Connected\`;
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[SOCKET] Disconnected:', reason);
      setConnectionStatus('disconnected', 'Disconnected from server. Reconnecting...');
      updateChatUIState('disconnected');
    });

    socket.on('connect_error', (err) => {
      console.warn('[SOCKET] Connect error:', err.message);
      setConnectionStatus('disconnected', 'Cannot reach server. Will retry...');
    });

    socket.on('waiting', (data) => {
      setConnectionStatus('searching', data?.message || 'Looking for someone you can chat with...');
      updateChatUIState('searching');
      appendSystemMessage('Looking for someone you can chat with... Hang tight!');
    });

    socket.on('partner-found', (data) => {
      setConnectionStatus('connected', 'Connected to stranger. Say hi!');
      updateChatUIState('connected');
      appendSystemMessage("You're now chatting with a random stranger. Say hi!", 'success');
      playPartnerFoundSound();
      messageInput.focus();
    });

    socket.on('chat-message', (data) => {
      hideTypingIndicator();
      appendMessage('stranger', data.text, data.timestamp);
      playMessageSound();
    });

    socket.on('typing', () => { showTypingIndicator(); });
    socket.on('stop-typing', () => { hideTypingIndicator(); });

    socket.on('partner-disconnected', (data) => {
      hideTypingIndicator();
      setConnectionStatus('idle', 'Stranger has disconnected.');
      updateChatUIState('partner-left');
      appendSystemMessage(data?.reason || 'Stranger has disconnected.', 'danger');
      playDisconnectSound();
    });

    socket.on('chat-stopped', (data) => {
      hideTypingIndicator();
      setConnectionStatus('idle', data?.message || 'Chat stopped.');
      updateChatUIState('idle');
      appendSystemMessage('You have disconnected.', 'default');
    });

    socket.on('stats-update', (data) => {
      if (onlineText && data) {
        const count = data.onlineCount || 1;
        onlineText.textContent = \`\${count.toLocaleString()} online\`;
      }
    });

    socket.on('error-message', (data) => {
      appendSystemMessage(data?.message || 'An error occurred.', 'danger');
    });
  }

  function setConnectionStatus(type, message) {
    statusIndicatorDot.className = 'status-indicator-dot';
    if (type === 'searching') {
      statusIndicatorDot.classList.add('searching');
    } else if (type === 'connected') {
      statusIndicatorDot.classList.add('connected');
    } else {
      statusIndicatorDot.classList.add('idle');
    }
    statusText.textContent = message;
  }

  function updateChatUIState(state) {
    chatState = state;

    if (state === 'searching') {
      btnStart.classList.add('hidden');
      btnNext.classList.remove('hidden');
      btnNext.disabled = false;
      btnStop.classList.remove('hidden');
      btnStop.disabled = false;
      messageInput.disabled = true;
      btnSend.disabled = true;
      messageInput.placeholder = 'Searching for a partner...';
    } else if (state === 'connected') {
      btnStart.classList.add('hidden');
      btnNext.classList.remove('hidden');
      btnNext.disabled = false;
      btnStop.classList.remove('hidden');
      btnStop.disabled = false;
      messageInput.disabled = false;
      btnSend.disabled = false;
      messageInput.placeholder = 'Type your message here... (Press Enter to send)';
      messageInput.value = '';
    } else if (state === 'partner-left') {
      btnStart.classList.add('hidden');
      btnNext.classList.remove('hidden');
      btnNext.disabled = false;
      btnStop.classList.remove('hidden');
      btnStop.disabled = false;
      messageInput.disabled = true;
      btnSend.disabled = true;
      messageInput.placeholder = 'Stranger disconnected. Click "Next" to meet someone else.';
    } else {
      btnStart.classList.remove('hidden');
      btnStart.disabled = !socket || !socket.connected;
      btnNext.classList.add('hidden');
      btnNext.disabled = true;
      btnStop.classList.add('hidden');
      btnStop.disabled = true;
      messageInput.disabled = true;
      btnSend.disabled = true;
      messageInput.placeholder = 'Press "Start Chat" to begin...';
    }
  }

  function formatTime(isoString) {
    try {
      const d = isoString ? new Date(isoString) : new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function appendMessage(sender, text, timestamp) {
    const row = document.createElement('div');
    row.className = \`message-row \${sender}\`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const senderTag = document.createElement('span');
    senderTag.className = 'message-sender-tag';
    senderTag.textContent = sender === 'you' ? 'You' : 'Stranger';

    const textContent = document.createTextNode(text);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatTime(timestamp);

    bubble.appendChild(senderTag);
    bubble.appendChild(textContent);
    bubble.appendChild(timeSpan);
    row.appendChild(bubble);

    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function appendSystemMessage(text, tone = 'default') {
    const row = document.createElement('div');
    row.className = 'message-row system';

    const pill = document.createElement('div');
    pill.className = 'system-pill';
    if (tone === 'danger') pill.classList.add('notice-danger');
    if (tone === 'success') pill.classList.add('notice-success');
    pill.textContent = text;

    row.appendChild(pill);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTypingIndicator() {
    typingIndicator.classList.remove('hidden');
    scrollToBottom();
  }

  function hideTypingIndicator() {
    typingIndicator.classList.add('hidden');
  }

  btnStart.addEventListener('click', () => {
    initAudioContext();
    if (!socket || !socket.connected) {
      initSocket();
      setTimeout(() => {
        if (socket && socket.connected) {
          socket.emit('find-partner');
        }
      }, 500);
      return;
    }
    socket.emit('find-partner');
  });

  btnNext.addEventListener('click', () => {
    initAudioContext();
    if (!socket || !socket.connected) return;
    appendSystemMessage('Skipping to next stranger...');
    socket.emit('next-partner');
  });

  btnStop.addEventListener('click', () => {
    if (!socket || !socket.connected) return;
    socket.emit('stop-chat');
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatState !== 'connected') return;

    const message = messageInput.value.trim();
    if (!message) return;

    socket.emit('chat-message', { text: message });
    appendMessage('you', message, new Date().toISOString());

    if (isTyping) {
      socket.emit('stop-typing');
      isTyping = false;
      clearTimeout(typingTimeout);
    }

    messageInput.value = '';
    messageInput.focus();
  });

  messageInput.addEventListener('input', () => {
    if (chatState !== 'connected' || !socket) return;

    if (!isTyping) {
      isTyping = true;
      socket.emit('typing');
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (isTyping) {
        socket.emit('stop-typing');
        isTyping = false;
      }
    }, 1500);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (chatState === 'connected' || chatState === 'searching' || chatState === 'partner-left') {
        e.preventDefault();
        btnNext.click();
      }
    }
  });

  initSocket();
})();`,
  },
};

/**
 * Reusable Interactive Chat Window for Split-screen simulator
 */
function ChatClientPane({
  name,
  accentColor,
  quickPrompts,
}: {
  name: string;
  accentColor: string;
  quickPrompts: string[];
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<'idle' | 'searching' | 'connected' | 'disconnected'>('idle');
  const [statusLabel, setStatusLabel] = useState('Idle. Press "Start Chat" to begin.');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'system',
      text: `👋 ${name} ready. Click Start to match with a random partner.`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<any>(null);

  // Initialize isolated socket instance
  useEffect(() => {
    const s = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      forceNew: true,
    });

    s.on('connect', () => {
      setStatus('idle');
      setStatusLabel('Connected to server. Ready to pair.');
    });

    s.on('disconnect', () => {
      setStatus('disconnected');
      setStatusLabel('Disconnected from server.');
    });

    s.on('waiting', (data) => {
      setStatus('searching');
      setStatusLabel(data?.message || 'Looking for someone to chat with...');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'system',
          text: '🔍 Looking for someone you can chat with...',
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    s.on('partner-found', () => {
      setStatus('connected');
      setStatusLabel('Connected to stranger. Say hi!');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'system',
          text: "🎉 You're now chatting with a random stranger! Say hi!",
          timestamp: new Date().toISOString(),
          tone: 'success',
        },
      ]);
    });

    s.on('chat-message', (data) => {
      setIsPartnerTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'stranger',
          text: data.text,
          timestamp: data.timestamp || new Date().toISOString(),
        },
      ]);
    });

    s.on('typing', () => setIsPartnerTyping(true));
    s.on('stop-typing', () => setIsPartnerTyping(false));

    s.on('partner-disconnected', (data) => {
      setIsPartnerTyping(false);
      setStatus('idle');
      setStatusLabel('Stranger has disconnected.');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'system',
          text: data?.reason || 'Stranger has disconnected.',
          timestamp: new Date().toISOString(),
          tone: 'danger',
        },
      ]);
    });

    s.on('chat-stopped', () => {
      setIsPartnerTyping(false);
      setStatus('idle');
      setStatusLabel('You have stopped the chat.');
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: 'system',
          text: 'You left the conversation.',
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPartnerTyping]);

  const handleStart = () => {
    if (!socket) return;
    socket.emit('find-partner');
  };

  const handleNext = () => {
    if (!socket) return;
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: 'system',
        text: 'Skipping to next stranger...',
        timestamp: new Date().toISOString(),
      },
    ]);
    socket.emit('next-partner');
  };

  const handleStop = () => {
    if (!socket) return;
    socket.emit('stop-chat');
  };

  const handleSendMessage = (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || !socket || status !== 'connected') return;

    socket.emit('chat-message', { text });
    socket.emit('stop-typing');

    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: 'you',
        text,
        timestamp: new Date().toISOString(),
      },
    ]);

    if (!textToSend) {
      setInputText('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!socket || status !== 'connected') return;

    socket.emit('typing');
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket.emit('stop-typing');
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      {/* Pane Header */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${accentColor}`} />
          <span className="font-bold text-white text-sm">{name}</span>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
            {socket?.id ? `#${socket.id.slice(0, 6)}` : 'Connecting...'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-500 animate-pulse'
                : status === 'searching'
                ? 'bg-amber-400 animate-ping'
                : 'bg-slate-500'
            }`}
          />
          <span className="text-xs text-slate-300 font-medium">
            {status === 'connected'
              ? 'Paired'
              : status === 'searching'
              ? 'Searching...'
              : 'Idle'}
          </span>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-slate-900/90 px-3 py-1.5 border-b border-slate-800/80 text-xs text-slate-300 flex items-center justify-between">
        <span className="truncate">{statusLabel}</span>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/60 font-sans">
        {messages.map((msg) => {
          if (msg.sender === 'system') {
            return (
              <div key={msg.id} className="flex justify-center my-2">
                <span
                  className={`text-xs px-3 py-1 rounded-full border ${
                    msg.tone === 'success'
                      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                      : msg.tone === 'danger'
                      ? 'bg-rose-950/70 text-rose-300 border-rose-800'
                      : 'bg-slate-800/80 text-amber-300 border-slate-700'
                  }`}
                >
                  {msg.text}
                </span>
              </div>
            );
          }

          const isYou = msg.sender === 'you';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isYou ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3.5 py-2 text-sm ${
                  isYou
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-slate-800 text-slate-100 border border-slate-700 rounded-tl-none'
                }`}
              >
                <div
                  className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${
                    isYou ? 'text-blue-200' : 'text-cyan-400'
                  }`}
                >
                  {isYou ? 'You' : 'Stranger'}
                </div>
                <div className="break-words whitespace-pre-wrap">{msg.text}</div>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          );
        })}

        {isPartnerTyping && (
          <div className="flex items-center gap-2 text-xs text-cyan-400 italic py-1">
            <span className="inline-flex gap-1">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
            </span>
            <span>Stranger is typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts bar (for rapid testing) */}
      {status === 'connected' && (
        <div className="bg-slate-900 px-3 py-1.5 border-t border-slate-800 flex items-center gap-1.5 overflow-x-auto text-xs">
          <span className="text-[11px] text-slate-500 shrink-0 font-medium">Quick:</span>
          {quickPrompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(prompt)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2 py-0.5 rounded text-xs shrink-0 transition"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Bottom Controls */}
      <div className="bg-slate-900 p-3 border-t border-slate-800 flex flex-col gap-2">
        <div className="flex gap-2">
          {status === 'idle' || status === 'disconnected' ? (
            <button
              onClick={handleStart}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-1.5 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition shadow"
            >
              <Play className="w-3.5 h-3.5" /> Start Chat
            </button>
          ) : (
            <>
              <button
                onClick={handleNext}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-medium py-1.5 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition border border-slate-700"
              >
                <SkipForward className="w-3.5 h-3.5" /> Next Stranger
              </button>
              <button
                onClick={handleStop}
                className="bg-rose-950/70 hover:bg-rose-900 text-rose-300 font-medium py-1.5 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition border border-rose-800/80"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
            </>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            disabled={status !== 'connected'}
            placeholder={
              status === 'connected'
                ? 'Type message...'
                : status === 'searching'
                ? 'Waiting for match...'
                : 'Click Start to chat...'
            }
            className="flex-1 bg-slate-950 border border-slate-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:border-cyan-500 transition"
          />
          <button
            type="submit"
            disabled={status !== 'connected' || !inputText.trim()}
            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center transition"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'split' | 'files' | 'deploy' | 'preview'>('split');
  const [selectedFileKey, setSelectedFileKey] = useState<keyof typeof SOURCE_FILES>('backend/server.js');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [stats, setStats] = useState<ServerStats>({ onlineCount: 1, waitingCount: 0, activeChats: 0 });

  // Fetch server stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setStats({
            onlineCount: data.onlineCount || 1,
            waitingCount: data.waitingCount || 0,
            activeChats: data.activeChats || 0,
          });
        }
      } catch {
        // Ignore fallback
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCopyCode = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadSingle = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.split('/').pop() || filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllZip = async () => {
    try {
      setIsZipping(true);
      const zip = new JSZip();

      // Add backend folder
      const backendFolder = zip.folder('backend');
      backendFolder?.file('package.json', SOURCE_FILES['backend/package.json'].code);
      backendFolder?.file('server.js', SOURCE_FILES['backend/server.js'].code);

      // Add frontend folder
      const frontendFolder = zip.folder('frontend');
      frontendFolder?.file('index.html', SOURCE_FILES['frontend/index.html'].code);
      frontendFolder?.file('style.css', SOURCE_FILES['frontend/style.css'].code);
      frontendFolder?.file('script.js', SOURCE_FILES['frontend/script.js'].code);

      // Add root README
      zip.file(
        'README.md',
        `# AnonChat (Omegle Clone)\n\nZero-Cost Deployment:\n- Backend: Deploy 'backend/' to Render.com Free Web Service\n- Frontend: Deploy 'frontend/' to Cloudflare Pages\n\nFull guide included in applet!`
      );

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'anonchat-omegle-clone-0cost.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('ZIP generation failed', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg text-white tracking-tight">AnonChat</h1>
                <span className="text-[11px] font-semibold uppercase tracking-wider bg-cyan-950 text-cyan-400 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                  Omegle Clone
                </span>
                <span className="text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                  $0 Hosting
                </span>
              </div>
              <p className="text-xs text-slate-400">Node.js/Socket.io (Render) + Static Dark UI (Cloudflare Pages)</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-slate-950 border border-slate-800 p-1 rounded-xl gap-1">
            <button
              onClick={() => setActiveTab('split')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'split'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Split-Screen Live Test</span>
            </button>

            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'preview'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Pure Frontend View</span>
            </button>

            <button
              onClick={() => setActiveTab('files')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'files'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Generated Source Files</span>
            </button>

            <button
              onClick={() => setActiveTab('deploy')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'deploy'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Deployment & Ad Guide</span>
            </button>
          </div>

          {/* Live Server Stats Badge */}
          <div className="hidden lg:flex items-center gap-3 text-xs bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-300 font-medium">Socket.io Active</span>
            </div>
            <div className="h-3 w-px bg-slate-800" />
            <div className="text-slate-400">
              <span className="text-white font-bold">{stats.onlineCount}</span> users
            </div>
            <div className="h-3 w-px bg-slate-800" />
            <div className="text-slate-400">
              <span className="text-amber-400 font-bold">{stats.waitingCount}</span> queue
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col">
        {/* TAB 1: Split-Screen Live Pair Simulator */}
        {activeTab === 'split' && (
          <div className="flex-1 flex flex-col gap-3 min-h-[640px]">
            {/* Simulator Explanation Bar */}
            <div className="bg-gradient-to-r from-blue-950/40 via-slate-900 to-cyan-950/40 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-blue-500/10 border border-blue-500/20 text-cyan-400 rounded-lg">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                    Instant Multi-User Pair Testing
                  </h2>
                  <p className="text-xs text-slate-400">
                    Both panels below connect via independent WebSockets. Click <strong>Start Chat</strong> on both sides to simulate instant matchmaking, real-time typing indicators, and skips!
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const btn1 = document.querySelectorAll<HTMLButtonElement>('button');
                    btn1.forEach((b) => {
                      if (b.textContent?.includes('Start Chat')) b.click();
                    });
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 shadow transition"
                >
                  <Play className="w-3.5 h-3.5" /> Auto-Pair Both (One-Click)
                </button>
              </div>
            </div>

            {/* Side-by-side Chat Panes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 h-[680px]">
              <ChatClientPane
                name="Stranger A (Window 1)"
                accentColor="bg-blue-500"
                quickPrompts={['Hey there!', 'What are your hobbies?', 'Where are you from?', 'Haha that is awesome!']}
              />
              <ChatClientPane
                name="Stranger B (Window 2)"
                accentColor="bg-cyan-400"
                quickPrompts={['Hello! 👋', 'I love coding and music!', 'New York! You?', 'Press Next to test skip!']}
              />
            </div>
          </div>
        )}

        {/* TAB 2: Standalone Pure Frontend View */}
        {activeTab === 'preview' && (
          <div className="flex-1 flex flex-col gap-3 min-h-[700px]">
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Cloudflare Pages Pure Static Build Preview</h2>
                <p className="text-xs text-slate-400">
                  This preview renders the exact standalone <code className="text-cyan-400 font-mono">frontend/index.html</code>, <code className="text-cyan-400 font-mono">frontend/style.css</code>, and <code className="text-cyan-400 font-mono">frontend/script.js</code> files.
                </p>
              </div>

              <a
                href="/standalone/index.html"
                target="_blank"
                rel="noreferrer"
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <span>Open in Full New Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl h-[700px]">
              <iframe
                src="/standalone/index.html"
                title="AnonChat Standalone Preview"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}

        {/* TAB 3: Source Code Inspector & Exporter */}
        {activeTab === 'files' && (
          <div className="flex-1 flex flex-col gap-4">
            {/* Top Toolbar */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-cyan-400" />
                  Generated Production Files (Ready for Deployment)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Full standalone code generated for zero-cost deployment on Render + Cloudflare Pages.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadAllZip}
                  disabled={isZipping}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>{isZipping ? 'Creating ZIP...' : 'Download Full Project (.ZIP)'}</span>
                </button>
              </div>
            </div>

            {/* File Switcher Tabs */}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SOURCE_FILES) as Array<keyof typeof SOURCE_FILES>).map((key) => {
                const file = SOURCE_FILES[key];
                const isSelected = selectedFileKey === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedFileKey(key)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-mono font-medium transition border ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-850 hover:text-white'
                    }`}
                  >
                    <span>{file.path}</span>
                  </button>
                );
              })}
            </div>

            {/* Code Display Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col flex-1">
              {/* Code Card Header */}
              <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs font-bold text-cyan-400">
                    {SOURCE_FILES[selectedFileKey].path}
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {SOURCE_FILES[selectedFileKey].desc}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      handleCopyCode(
                        SOURCE_FILES[selectedFileKey].code,
                        selectedFileKey
                      )
                    }
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    {copiedKey === selectedFileKey ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy File</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() =>
                      handleDownloadSingle(
                        SOURCE_FILES[selectedFileKey].path,
                        SOURCE_FILES[selectedFileKey].code
                      )
                    }
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              </div>

              {/* Code Pre Block */}
              <div className="p-4 overflow-x-auto bg-[#0d1117] flex-1 max-h-[600px] overflow-y-auto font-mono text-xs text-slate-200 leading-relaxed">
                <pre>{SOURCE_FILES[selectedFileKey].code}</pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Zero-Cost Deployment Guide & Monetization */}
        {activeTab === 'deploy' && (
          <div className="flex-1 flex flex-col gap-6 max-w-5xl mx-auto">
            {/* Hero Overview */}
            <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 border border-blue-900/60 p-6 rounded-2xl shadow-xl">
              <div className="flex items-center gap-3 mb-2">
                <span className="p-2 bg-blue-500/20 text-cyan-400 rounded-xl">
                  <DollarSign className="w-6 h-6" />
                </span>
                <h2 className="text-xl font-bold text-white">
                  Zero Hosting Cost Blueprint ($0/Month)
                </h2>
              </div>
              <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
                By separating the stateless static frontend from the Node.js Socket.io real-time backend, you take advantage of Cloudflare Pages' <strong>unlimited bandwidth free tier</strong> and Render's <strong>free Web Service tier</strong>. No monthly server bills, ever.
              </p>
            </div>

            {/* 3 Step Deployment Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Step 1 */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between shadow-lg">
                <div>
                  <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 flex items-center justify-center font-bold text-sm mb-3">
                    1
                  </div>
                  <h3 className="font-bold text-white text-base mb-1 flex items-center gap-2">
                    <Server className="w-4 h-4 text-cyan-400" />
                    Deploy Backend (Render)
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Deploy the <code className="text-cyan-300 font-mono">backend/</code> folder as a free Node.js Web Service on Render.
                  </p>
                  <ul className="text-xs text-slate-300 space-y-2">
                    <li>• Root Directory: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-cyan-300">backend</code></li>
                    <li>• Build Command: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-cyan-300">npm install</code></li>
                    <li>• Start Command: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-cyan-300">node server.js</code></li>
                    <li>• Plan: <strong className="text-emerald-400">Free ($0/mo)</strong></li>
                  </ul>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800">
                  <a
                    href="https://dashboard.render.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
                  >
                    <span>Go to Render.com</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between shadow-lg">
                <div>
                  <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 text-cyan-400 flex items-center justify-center font-bold text-sm mb-3">
                    2
                  </div>
                  <h3 className="font-bold text-white text-base mb-1 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    Deploy Frontend (Cloudflare)
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Deploy <code className="text-cyan-300 font-mono">frontend/</code> to Cloudflare Pages for instant CDN delivery and zero bandwidth limits.
                  </p>
                  <ul className="text-xs text-slate-300 space-y-2">
                    <li>• Framework: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-cyan-300">None</code></li>
                    <li>• Build Command: <em>(Leave empty)</em></li>
                    <li>• Output Directory: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-cyan-300">frontend</code></li>
                    <li>• In <code className="text-cyan-300">script.js</code>: Set your Render URL!</li>
                  </ul>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800">
                  <a
                    href="https://pages.cloudflare.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
                  >
                    <span>Go to Cloudflare Pages</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between shadow-lg">
                <div>
                  <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold text-sm mb-3">
                    3
                  </div>
                  <h3 className="font-bold text-white text-base mb-1 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    Keep-Warm (UptimeRobot)
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Render free instances sleep after 15 mins idle. Keep your backend awake 24/7 for free!
                  </p>
                  <ul className="text-xs text-slate-300 space-y-2">
                    <li>• Register free at <strong>uptimerobot.com</strong></li>
                    <li>• Monitor Type: <strong>HTTP(s)</strong></li>
                    <li>• Target: <code className="bg-slate-950 px-1 py-0.5 rounded text-cyan-300">https://your-app.onrender.com/health</code></li>
                    <li>• Interval: <strong>Every 10 minutes</strong></li>
                  </ul>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800">
                  <a
                    href="https://uptimerobot.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                  >
                    <span>Go to UptimeRobot</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Monetization / Ad Networks Section */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
              <h3 className="font-bold text-white text-base mb-2 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-amber-400" />
                Alternative Ad Networks (Adsterra & PropellerAds)
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                Mainstream networks like Google AdSense do not allow anonymous Omegle chat websites. 
                Instead, top high-revenue networks tailored for chat sites are <strong>Adsterra</strong> and <strong>PropellerAds</strong>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider block mb-1">
                    Adsterra Units
                  </span>
                  <ul className="text-xs text-slate-300 space-y-2">
                    <li>
                      <strong>1. 728x90 Banner:</strong> Paste code directly inside <code className="text-cyan-300 font-mono">#header-ad-container</code> in <code className="text-slate-400 font-mono">frontend/index.html</code>.
                    </li>
                    <li>
                      <strong>2. Social Bar:</strong> Highly lucrative iOS notification style banner. Paste in the <code className="text-cyan-300 font-mono">&lt;head&gt;</code> tag.
                    </li>
                    <li>
                      <strong>3. Popunder (OnClick):</strong> Highest CPM. Paste before the closing <code className="text-cyan-300 font-mono">&lt;/body&gt;</code> tag.
                    </li>
                  </ul>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block mb-1">
                    PropellerAds Units
                  </span>
                  <ul className="text-xs text-slate-300 space-y-2">
                    <li>
                      <strong>1. MultiTag:</strong> Automatic AI monetization tag that shows optimal banners, interstitials, and in-page push.
                    </li>
                    <li>
                      <strong>2. In-Page Push (Banner):</strong> Non-intrusive floating notification ad.
                    </li>
                    <li>
                      <strong>3. Interstitial:</strong> Can trigger after a user completes 3-5 chats.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 px-4 py-3 text-center text-xs text-slate-500">
        AnonChat &bull; Free Random Text Chat System &bull; Production Ready for Render + Cloudflare Pages
      </footer>
    </div>
  );
}
