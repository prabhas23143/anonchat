/**
 * AnonChat - Production-ready Client-side Chat Logic
 * Designed for 0-cost deployment on Cloudflare Pages (Frontend) + Render.com (Backend)
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. BACKEND URL CONFIGURATION
  // =========================================================================
  // When deploying to Cloudflare Pages:
  // Replace the placeholder below with your live Render URL (e.g. 'https://my-chat-app.onrender.com')
  // Or pass it via URL query string: ?server=https://my-chat-app.onrender.com
  // Or via localStorage.setItem('RENDER_SOCKET_URL', 'https://...')
  const urlParams = new URLSearchParams(window.location.search);
  const overrideUrl = urlParams.get('server') || localStorage.getItem('RENDER_SOCKET_URL');

  const DEFAULT_RENDER_URL = 'https://your-omegle-backend.onrender.com';
  
  // If served from same host (e.g. fullstack dev or local proxy), use window.location.origin
  const isLocalOrPreview = window.location.hostname === 'localhost' ||
                           window.location.hostname === '127.0.0.1' ||
                           window.location.hostname.includes('.run.app') ||
                           window.location.hostname.includes('webcontainer');

  const BACKEND_URL = overrideUrl || (isLocalOrPreview ? window.location.origin : DEFAULT_RENDER_URL);

  // =========================================================================
  // 2. DOM ELEMENT REFERENCES
  // =========================================================================
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

  // =========================================================================
  // 3. APPLICATION STATE
  // =========================================================================
  let socket = null;
  // States: 'disconnected' | 'idle' | 'searching' | 'connected'
  let chatState = 'disconnected';
  let soundEnabled = localStorage.getItem('anonchat_sound') !== 'false';
  let typingTimeout = null;
  let isTyping = false;

  // Display active backend URL
  if (backendLabel) {
    try {
      const parsed = new URL(BACKEND_URL);
      backendLabel.textContent = `Server: ${parsed.hostname}`;
    } catch {
      backendLabel.textContent = `Server: Custom`;
    }
  }

  // Update sound icon initial state
  updateSoundIcon();

  // =========================================================================
  // 4. AUDIO NOTIFICATIONS (Web Audio API - Zero Asset Files Required)
  // =========================================================================
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
    // Upbeat two-tone chime
    playTone(587.33, 0.12, 'sine', 0.2); // D5
    setTimeout(() => {
      playTone(880, 0.25, 'sine', 0.2); // A5
    }, 120);
  }

  function playMessageSound() {
    // Soft subtle water-drop pop
    playTone(740, 0.08, 'triangle', 0.15);
  }

  function playDisconnectSound() {
    // Downbeat chime
    playTone(440, 0.15, 'sine', 0.15);
    setTimeout(() => {
      playTone(330, 0.2, 'sine', 0.15);
    }, 120);
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

  // =========================================================================
  // 5. SOCKET.IO CONNECTION INITIALIZATION
  // =========================================================================
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
      setConnectionStatus('disconnected', `Connection error: ${err.message}`);
    }
  }

  function setupSocketEvents() {
    socket.on('connect', () => {
      console.log('[SOCKET] Connected to server, ID:', socket.id);
      setConnectionStatus('idle', 'Connected. Press "Start Chat" to find a stranger.');
      if (backendLabel) {
        backendLabel.textContent = `Server: Connected`;
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[SOCKET] Disconnected:', reason);
      setConnectionStatus('disconnected', 'Disconnected from server. Reconnecting...');
      updateChatUIState('disconnected');
    });

    socket.on('connect_error', (err) => {
      console.warn('[SOCKET] Connect error:', err.message);
      setConnectionStatus('disconnected', `Cannot reach server. Will retry...`);
    });

    // Server notifies user they are queued
    socket.on('waiting', (data) => {
      console.log('[SOCKET] Waiting in queue:', data);
      setConnectionStatus('searching', data?.message || 'Looking for someone you can chat with...');
      updateChatUIState('searching');
      appendSystemMessage('Looking for someone you can chat with... Hang tight!');
    });

    // Matchmaking success: two users paired
    socket.on('partner-found', (data) => {
      console.log('[SOCKET] Partner found:', data);
      setConnectionStatus('connected', 'Connected to stranger. Say hi!');
      updateChatUIState('connected');
      appendSystemMessage("You're now chatting with a random stranger. Say hi!", 'success');
      playPartnerFoundSound();
      messageInput.focus();
    });

    // Partner sends message
    socket.on('chat-message', (data) => {
      hideTypingIndicator();
      appendMessage('stranger', data.text, data.timestamp);
      playMessageSound();
    });

    // Real-time typing indicators
    socket.on('typing', () => {
      showTypingIndicator();
    });

    socket.on('stop-typing', () => {
      hideTypingIndicator();
    });

    // Partner leaves or skips
    socket.on('partner-disconnected', (data) => {
      hideTypingIndicator();
      setConnectionStatus('idle', 'Stranger has disconnected.');
      updateChatUIState('partner-left');
      appendSystemMessage(data?.reason || 'Stranger has disconnected.', 'danger');
      playDisconnectSound();
    });

    // Current user stopped chat
    socket.on('chat-stopped', (data) => {
      hideTypingIndicator();
      setConnectionStatus('idle', data?.message || 'Chat stopped.');
      updateChatUIState('idle');
      appendSystemMessage('You have disconnected.', 'default');
    });

    // Live active stats
    socket.on('stats-update', (data) => {
      if (onlineText && data) {
        const count = data.onlineCount || 1;
        onlineText.textContent = `${count.toLocaleString()} online`;
      }
    });

    // Generic error
    socket.on('error-message', (data) => {
      appendSystemMessage(data?.message || 'An error occurred.', 'danger');
    });
  }

  // =========================================================================
  // 6. UI STATE CONTROLS
  // =========================================================================
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
      // 'idle' or 'disconnected'
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

  // =========================================================================
  // 7. MESSAGE RENDERING & AUTO-SCROLL
  // =========================================================================
  function formatTime(isoString) {
    try {
      const d = isoString ? new Date(isoString) : new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function appendMessage(sender, text, timestamp) {
    const welcomeCard = document.getElementById('welcome-card');
    if (welcomeCard && welcomeCard.parentElement) {
      // Keep welcome card until first active message
    }

    const row = document.createElement('div');
    row.className = `message-row ${sender}`;

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

  // =========================================================================
  // 8. USER ACTION EVENT LISTENERS
  // =========================================================================

  // Start button: enter waiting queue
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

  // Next / Skip button: leaves current chat and requests a new stranger immediately
  btnNext.addEventListener('click', () => {
    initAudioContext();
    if (!socket || !socket.connected) return;
    appendSystemMessage('Skipping to next stranger...');
    socket.emit('next-partner');
  });

  // Stop button: leaves current chat without searching again
  btnStop.addEventListener('click', () => {
    if (!socket || !socket.connected) return;
    socket.emit('stop-chat');
  });

  // Chat message submission
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatState !== 'connected') return;

    const message = messageInput.value.trim();
    if (!message) return;

    // Send to partner via Socket.io
    socket.emit('chat-message', { text: message });

    // Render locally for instant feedback
    appendMessage('you', message, new Date().toISOString());

    // Stop local typing emission
    if (isTyping) {
      socket.emit('stop-typing');
      isTyping = false;
      clearTimeout(typingTimeout);
    }

    messageInput.value = '';
    messageInput.focus();
  });

  // Typing event throttling
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

  // Keyboard shortcut: Esc to Skip/Next
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (chatState === 'connected' || chatState === 'searching' || chatState === 'partner-left') {
        e.preventDefault();
        btnNext.click();
      }
    }
  });

  // =========================================================================
  // 9. BOOTSTRAP APPLICATION
  // =========================================================================
  // Start socket connection on load
  initSocket();

})();
