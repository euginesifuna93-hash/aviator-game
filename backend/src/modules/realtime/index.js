// backend/src/modules/realtime/index.js
const { Server } = require('socket.io');
const logger = require('../../utils/logger');
const engine = require('../engine/engine');

let ioInstance = null;

function initRealtime(httpServer, sessionMiddleware) {
 
 
  ioInstance = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || 
            origin.includes('localhost') || 
            origin.includes('ngrok') || 
            origin.includes('127.0.0.1') ||
            origin.includes('onrender.com')) { // <--- ADD THIS LINE!
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Share session middleware
  ioInstance.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  ioInstance.on('connection', (socket) => {
    const userId = socket.request.session?.userId;

    if (userId) {
      socket.join(`user:${userId}`);
      logger.info(`Socket connected: userId=${userId}, socketId=${socket.id}`);
    } else {
      logger.info(`Socket connected (no session): socketId=${socket.id}`);
    }

    // Add this inside the ioInstance.on('connection', ...) callback, after the snapshot emit:

socket.on('bet:place', async (payload, ack) => {
    try {
      const userId = socket.request.session?.userId;
      if (!userId) {
        return ack({ ok: false, error: 'Not authenticated' });
      }
      
      const betsService = require('../bets/service');
      const bet = await betsService.placeBet(userId, payload.stakeCents, payload.autoCashout);
      
      ack({ ok: true, bet });
    } catch (err) {
      console.error('bet:place error:', err.message);
      ack({ ok: false, error: err.message || 'Bet failed' });
    }
  });
  
  socket.on('bet:cashout', async (payload, ack) => {
    try {
      const userId = socket.request.session?.userId;
      if (!userId) {
        return ack({ ok: false, error: 'Not authenticated' });
      }
      
      const betsService = require('../bets/service');
      const result = await betsService.cashOut(userId, payload.roundId, payload.betId);
      
      ack({ ok: true, ...result });
    } catch (err) {
      console.error('bet:cashout error:', err.message);
      ack({ ok: false, error: err.message || 'Cashout failed' });
    }
  });
  
  socket.on('bet:cancel', async (payload, ack) => {
    try {
      const userId = socket.request.session?.userId;
      if (!userId) {
        return ack({ ok: false, error: 'Not authenticated' });
      }
      
      const betsService = require('../bets/service');
      const result = await betsService.cancelBet(userId, payload.roundId);
      
      ack({ ok: true, ...result });
    } catch (err) {
      console.error('bet:cancel error:', err.message);
      ack({ ok: false, error: err.message || 'Cancel failed' });
    }
  });

    // ✅ CRITICAL: Send current game state immediately on connection
    const currentSnapshot = engine.snapshot();
    if (currentSnapshot) {
      logger.info(`Sending initial snapshot to ${socket.id}:`, currentSnapshot.phase, 'round:', currentSnapshot.roundId);
      socket.emit('snapshot', currentSnapshot);
    } else {
      logger.warn(`No snapshot available for ${socket.id}`);
    }

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: socketId=${socket.id}`);
    });
  });

  // ✅ CRITICAL: Listen to engine events and broadcast
  engine.on('snapshot', (s) => {
    logger.info('Broadcasting snapshot:', s.phase, 'round:', s.roundId);
    ioInstance.emit('snapshot', s);
  });

  engine.on('tick', (t) => {
    ioInstance.emit('tick', t);
  });

  engine.on('crashed', (c) => {
    logger.info('Broadcasting crash:', c.crashPoint);
    ioInstance.emit('crashed', c);
  });

  logger.info('Socket.IO initialized');
  return ioInstance;
}

function getIO() {
  return ioInstance;
}

module.exports = { initRealtime, getIO };