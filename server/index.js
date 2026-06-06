const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const auth = require('./auth');
const { games } = require('./database');
const roomManager = require('./gameRoom');
const matchmaking = require('./matchmaking');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- REST API ---

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await auth.register(username, password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await auth.login(username, password);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.get('/api/profile/:userId', async (req, res) => {
  const user = await auth.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.get('/api/games/:userId', async (req, res) => {
  const userId = req.params.userId;
  const userGames = await games.find({
    $or: [{ white_id: userId }, { black_id: userId }],
    result: { $ne: null }
  }).sort({ ended_at: -1 }).limit(20);
  res.json(userGames);
});

app.get('/api/game/:gameId', async (req, res) => {
  const game = await games.findOne({ _id: req.params.gameId });
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

app.get('/api/leaderboard', async (req, res) => {
  const leaders = await auth.getLeaderboard();
  res.json(leaders);
});

// --- Socket.IO ---

const connectedUsers = new Map();

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));

  const decoded = auth.verifyToken(token);
  if (!decoded) return next(new Error('Invalid token'));

  const user = await auth.getUserById(decoded.id);
  if (!user) return next(new Error('User not found'));

  socket.userId = user._id;
  socket.username = user.username;
  socket.userElo = user.elo_rating;
  next();
});

io.on('connection', (socket) => {
  connectedUsers.set(socket.id, {
    userId: socket.userId,
    username: socket.username,
    elo: socket.userElo,
  });

  socket.emit('connected', { userId: socket.userId, username: socket.username, elo: socket.userElo });

  // --- Room Management ---

  socket.on('create_room', () => {
    const existing = roomManager.getRoomByPlayer(socket.userId);
    if (existing) return socket.emit('error_msg', { message: 'Already in a game' });

    const roomId = uuidv4();
    socket.join(roomId);
    socket.pendingRoom = roomId;
    socket.emit('room_created', { roomId });
  });

  socket.on('join_room', async ({ roomId }) => {
    const creatorSocket = findSocketByPendingRoom(roomId);
    if (!creatorSocket) return socket.emit('error_msg', { message: 'Room not found or already started' });
    if (creatorSocket.userId === socket.userId) return socket.emit('error_msg', { message: 'Cannot join your own room' });

    socket.join(roomId);
    creatorSocket.pendingRoom = null;

    const whitePlayer = {
      userId: creatorSocket.userId,
      username: creatorSocket.username,
      elo: creatorSocket.userElo,
      socketId: creatorSocket.id,
    };
    const blackPlayer = {
      userId: socket.userId,
      username: socket.username,
      elo: socket.userElo,
      socketId: socket.id,
    };

    let room;
    if (Math.random() < 0.5) {
      room = await roomManager.createRoom(roomId, blackPlayer, whitePlayer, false);
    } else {
      room = await roomManager.createRoom(roomId, whitePlayer, blackPlayer, false);
    }
    io.to(roomId).emit('game_start', room.getState());
  });

  // --- Matchmaking ---

  socket.on('join_matchmaking', async () => {
    const existing = roomManager.getRoomByPlayer(socket.userId);
    if (existing) return socket.emit('error_msg', { message: 'Already in a game' });

    const user = await auth.getUserById(socket.userId);
    const added = matchmaking.addPlayer(socket.userId, socket.username, user.elo_rating);
    if (!added) return socket.emit('error_msg', { message: 'Already in queue' });

    socket.emit('matchmaking_joined', { queueSize: matchmaking.getQueueSize() });
    await tryMatch();
  });

  socket.on('leave_matchmaking', () => {
    matchmaking.removePlayer(socket.userId);
    socket.emit('matchmaking_left');
  });

  // --- Game Actions ---

  socket.on('move', ({ from, to, promotion }) => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room) return socket.emit('error_msg', { message: 'Not in a game' });

    const result = room.makeMove(socket.userId, from, to, promotion);
    if (result.error) return socket.emit('error_msg', { message: result.error });

    const roomId = room.id;
    io.to(roomId).emit('move_made', {
      move: result.move,
      fen: result.fen,
      state: room.getState(),
    });

    if (result.gameOver) {
      io.to(roomId).emit('game_over', result.gameOver);
    }
  });

  socket.on('resign', () => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room) return;

    const result = room.resign(socket.userId);
    if (result) {
      io.to(room.id).emit('game_over', result);
    }
  });

  socket.on('offer_draw', () => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room) return;

    const offered = room.offerDraw(socket.userId);
    if (offered) {
      const opponentSocketId = socket.userId === room.white.userId ? room.black.socketId : room.white.socketId;
      io.to(opponentSocketId).emit('draw_offered', { by: socket.username });
    }
  });

  socket.on('accept_draw', () => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room) return;

    const result = room.acceptDraw(socket.userId);
    if (result) {
      io.to(room.id).emit('game_over', result);
    }
  });

  socket.on('decline_draw', () => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room) return;

    const declined = room.declineDraw(socket.userId);
    if (declined) {
      const opponentSocketId = socket.userId === room.white.userId ? room.black.socketId : room.white.socketId;
      io.to(opponentSocketId).emit('draw_declined');
    }
  });

  socket.on('request_rematch', async () => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room || room.status !== 'ended') return;

    if (room.rematchRequest && room.rematchRequest !== socket.userId) {
      const oldRoom = room;
      const roomId = uuidv4();

      const whiteUser = await auth.getUserById(oldRoom.black.userId);
      const blackUser = await auth.getUserById(oldRoom.white.userId);

      const whitePlayer = {
        userId: oldRoom.black.userId,
        username: oldRoom.black.username,
        elo: whiteUser.elo_rating,
        socketId: getSocketIdForUser(oldRoom.black.userId),
      };
      const blackPlayer = {
        userId: oldRoom.white.userId,
        username: oldRoom.white.username,
        elo: blackUser.elo_rating,
        socketId: getSocketIdForUser(oldRoom.white.userId),
      };

      roomManager.removeRoom(oldRoom.id);

      const whiteSocket = io.sockets.sockets.get(whitePlayer.socketId);
      const blackSocket = io.sockets.sockets.get(blackPlayer.socketId);
      if (whiteSocket) { whiteSocket.leave(oldRoom.id); whiteSocket.join(roomId); }
      if (blackSocket) { blackSocket.leave(oldRoom.id); blackSocket.join(roomId); }

      const newRoom = await roomManager.createRoom(roomId, whitePlayer, blackPlayer, oldRoom.isRanked);
      io.to(roomId).emit('game_start', newRoom.getState());
    } else {
      room.rematchRequest = socket.userId;
      const opponentSocketId = socket.userId === room.white.userId ? room.black.socketId : room.white.socketId;
      io.to(opponentSocketId).emit('rematch_requested', { by: socket.username });
    }
  });

  socket.on('leave_game', () => {
    const room = roomManager.getRoomByPlayer(socket.userId);
    if (!room) return;
    if (room.status === 'playing') {
      const result = room.resign(socket.userId);
      if (result) io.to(room.id).emit('game_over', result);
    }
    socket.leave(room.id);
    roomManager.removeRoom(room.id);
  });

  // --- Disconnect ---

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    matchmaking.removePlayer(socket.userId);

    const room = roomManager.getRoomByPlayer(socket.userId);
    if (room && room.status === 'playing') {
      const result = room.resign(socket.userId);
      if (result) {
        io.to(room.id).emit('game_over', { ...result, reason: 'disconnect' });
      }
    }
  });
});

function findSocketByPendingRoom(roomId) {
  for (const [, s] of io.sockets.sockets) {
    if (s.pendingRoom === roomId) return s;
  }
  return null;
}

function getSocketIdForUser(userId) {
  for (const [socketId, user] of connectedUsers) {
    if (user.userId === userId) return socketId;
  }
  return null;
}

function findSocketForUser(userId) {
  for (const [, s] of io.sockets.sockets) {
    if (s.userId === userId) return s;
  }
  return null;
}

async function tryMatch() {
  const match = matchmaking.findMatch();
  if (!match) return;

  const { player1, player2 } = match;
  const roomId = uuidv4();

  const socket1 = findSocketForUser(player1.userId);
  const socket2 = findSocketForUser(player2.userId);

  if (!socket1 || !socket2) return;

  socket1.join(roomId);
  socket2.join(roomId);

  const user1 = await auth.getUserById(player1.userId);
  const user2 = await auth.getUserById(player2.userId);

  const whitePlayer = {
    userId: player1.userId,
    username: player1.username,
    elo: user1.elo_rating,
    socketId: socket1.id,
  };
  const blackPlayer = {
    userId: player2.userId,
    username: player2.username,
    elo: user2.elo_rating,
    socketId: socket2.id,
  };

  let room;
  if (Math.random() < 0.5) {
    room = await roomManager.createRoom(roomId, blackPlayer, whitePlayer, true);
  } else {
    room = await roomManager.createRoom(roomId, whitePlayer, blackPlayer, true);
  }
  io.to(roomId).emit('game_start', room.getState());
}

setInterval(tryMatch, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ChessMatrix server running on http://localhost:${PORT}`);
});
