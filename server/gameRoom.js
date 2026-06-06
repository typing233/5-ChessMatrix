const { Chess } = require('chess.js');
const { games } = require('./database');
const { calculateNewRatings } = require('./elo');
const auth = require('./auth');

const DEFAULT_TIME = 10 * 60 * 1000;
const DEFAULT_INCREMENT = 5000;

class GameRoom {
  constructor(id, whitePlayer, blackPlayer, isRanked = false) {
    this.id = id;
    this.chess = new Chess();
    this.white = whitePlayer;
    this.black = blackPlayer;
    this.isRanked = isRanked;
    this.moves = [];
    this.status = 'playing';
    this.drawOffer = null;
    this.rematchRequest = null;
    this.createdAt = Date.now();

    this.whiteTime = DEFAULT_TIME;
    this.blackTime = DEFAULT_TIME;
    this.increment = DEFAULT_INCREMENT;
    this.lastMoveTimestamp = Date.now();
    this.timerInterval = null;

    this.disconnectedPlayer = null;
    this.disconnectTimer = null;
    this.disconnectTimestamp = null;

    this.onTimeout = null;
    this.onDisconnectExpire = null;

    this.startTimer();
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      if (this.status !== 'playing') return;
      if (this.disconnectedPlayer) return;

      const now = Date.now();
      const elapsed = now - this.lastMoveTimestamp;
      const isWhiteTurn = this.chess.turn() === 'w';

      const remaining = isWhiteTurn
        ? this.whiteTime - elapsed
        : this.blackTime - elapsed;

      if (remaining <= 0) {
        if (isWhiteTurn) this.whiteTime = 0;
        else this.blackTime = 0;
        this.lastMoveTimestamp = now;

        const loser = isWhiteTurn ? 'white' : 'black';
        const result = loser === 'white' ? 'black' : 'white';
        const gameOver = this.endGame(result, 'timeout');
        if (this.onTimeout) this.onTimeout(gameOver);
      }
    }, 100);
  }

  getTimeState() {
    const now = Date.now();
    const elapsed = now - this.lastMoveTimestamp;
    const isWhiteTurn = this.chess.turn() === 'w';

    return {
      whiteTime: isWhiteTurn ? Math.max(0, this.whiteTime - elapsed) : this.whiteTime,
      blackTime: !isWhiteTurn ? Math.max(0, this.blackTime - elapsed) : this.blackTime,
      activeSide: this.chess.turn(),
    };
  }

  makeMove(userId, from, to, promotion) {
    if (this.status !== 'playing') return { error: 'Game has ended' };

    const isWhiteTurn = this.chess.turn() === 'w';
    if (isWhiteTurn && userId !== this.white.userId) return { error: 'Not your turn' };
    if (!isWhiteTurn && userId !== this.black.userId) return { error: 'Not your turn' };

    const now = Date.now();
    const elapsed = now - this.lastMoveTimestamp;

    if (isWhiteTurn) {
      this.whiteTime -= elapsed;
      if (this.whiteTime <= 0) {
        this.whiteTime = 0;
        const gameOver = this.endGame('black', 'timeout');
        return { error: null, timeout: true, gameOver };
      }
      if (this.moves.length > 1) this.whiteTime += this.increment;
    } else {
      this.blackTime -= elapsed;
      if (this.blackTime <= 0) {
        this.blackTime = 0;
        const gameOver = this.endGame('white', 'timeout');
        return { error: null, timeout: true, gameOver };
      }
      if (this.moves.length > 1) this.blackTime += this.increment;
    }

    this.lastMoveTimestamp = now;

    try {
      const move = this.chess.move({ from, to, promotion: promotion || 'q' });
      if (!move) return { error: 'Invalid move' };

      this.moves.push({ from, to, promotion: move.promotion, san: move.san, fen: this.chess.fen() });
      this.drawOffer = null;

      games.update({ _id: this.id }, { $set: { moves: this.moves, fen: this.chess.fen(), pgn: this.chess.pgn() } });

      let gameOver = null;
      if (this.chess.isGameOver()) {
        gameOver = this.resolveGameOver();
      }

      return { move, fen: this.chess.fen(), gameOver, timeState: this.getTimeState() };
    } catch (e) {
      return { error: 'Invalid move' };
    }
  }

  resolveGameOver() {
    let result, reason;

    if (this.chess.isCheckmate()) {
      result = this.chess.turn() === 'w' ? 'black' : 'white';
      reason = 'checkmate';
    } else if (this.chess.isStalemate()) {
      result = 'draw';
      reason = 'stalemate';
    } else if (this.chess.isThreefoldRepetition()) {
      result = 'draw';
      reason = 'threefold';
    } else if (this.chess.isDraw()) {
      result = 'draw';
      reason = this.chess.isInsufficientMaterial() ? 'insufficient' : 'fifty_move';
    }

    return this.endGame(result, reason);
  }

  resign(userId) {
    if (this.status !== 'playing') return null;
    const result = userId === this.white.userId ? 'black' : 'white';
    return this.endGame(result, 'resignation');
  }

  offerDraw(userId) {
    if (this.status !== 'playing') return null;
    if (this.drawOffer === userId) return null;
    this.drawOffer = userId;
    return true;
  }

  acceptDraw(userId) {
    if (this.status !== 'playing') return null;
    if (!this.drawOffer || this.drawOffer === userId) return null;
    return this.endGame('draw', 'draw_agreement');
  }

  declineDraw(userId) {
    if (this.drawOffer && this.drawOffer !== userId) {
      this.drawOffer = null;
      return true;
    }
    return false;
  }

  handleDisconnect(userId) {
    this.disconnectedPlayer = userId;
    this.disconnectTimestamp = Date.now();
    this.disconnectTimer = setTimeout(() => {
      if (this.status !== 'playing') return;
      const result = userId === this.white.userId ? 'black' : 'white';
      const gameOver = this.endGame(result, 'disconnect');
      if (this.onDisconnectExpire) this.onDisconnectExpire(gameOver);
    }, 60000);
  }

  handleReconnect(userId, newSocketId) {
    if (this.disconnectedPlayer === userId) {
      this.disconnectedPlayer = null;
      this.disconnectTimestamp = null;
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      if (userId === this.white.userId) {
        this.white.socketId = newSocketId;
      } else {
        this.black.socketId = newSocketId;
      }
      return true;
    }
    return false;
  }

  getDisconnectRemaining() {
    if (!this.disconnectTimestamp) return null;
    return Math.max(0, 60000 - (Date.now() - this.disconnectTimestamp));
  }

  endGame(result, reason) {
    this.status = 'ended';
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    let whiteEloAfter = this.white.elo;
    let blackEloAfter = this.black.elo;

    if (this.isRanked) {
      const { newWhiteElo, newBlackElo } = calculateNewRatings(this.white.elo, this.black.elo, result);
      whiteEloAfter = newWhiteElo;
      blackEloAfter = newBlackElo;

      auth.updateUserElo(this.white.userId, newWhiteElo);
      auth.updateUserElo(this.black.userId, newBlackElo);

      if (result === 'white') {
        auth.incrementWins(this.white.userId);
        auth.incrementLosses(this.black.userId);
      } else if (result === 'black') {
        auth.incrementWins(this.black.userId);
        auth.incrementLosses(this.white.userId);
      } else {
        auth.incrementDraws(this.white.userId);
        auth.incrementDraws(this.black.userId);
      }
    }

    games.update({ _id: this.id }, {
      $set: { result, result_reason: reason, ended_at: new Date().toISOString(), white_elo_after: whiteEloAfter, black_elo_after: blackEloAfter }
    });

    return {
      result,
      reason,
      whiteElo: whiteEloAfter,
      blackElo: blackEloAfter,
      whiteEloDelta: whiteEloAfter - this.white.elo,
      blackEloDelta: blackEloAfter - this.black.elo,
    };
  }

  getState() {
    const timeState = this.getTimeState();
    return {
      id: this.id,
      fen: this.chess.fen(),
      pgn: this.chess.pgn(),
      moves: this.moves,
      turn: this.chess.turn(),
      white: { userId: this.white.userId, username: this.white.username, elo: this.white.elo },
      black: { userId: this.black.userId, username: this.black.username, elo: this.black.elo },
      status: this.status,
      isCheck: this.chess.isCheck(),
      isRanked: this.isRanked,
      drawOffer: this.drawOffer,
      legalMoves: this.getLegalMoves(),
      whiteTime: timeState.whiteTime,
      blackTime: timeState.blackTime,
      activeSide: timeState.activeSide,
      disconnectedPlayer: this.disconnectedPlayer,
      disconnectRemaining: this.getDisconnectRemaining(),
    };
  }

  getLegalMoves() {
    const moves = this.chess.moves({ verbose: true });
    const result = {};
    for (const m of moves) {
      if (!result[m.from]) result[m.from] = [];
      result[m.from].push(m.to);
    }
    return result;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map();
  }

  async createRoom(id, whitePlayer, blackPlayer, isRanked = false) {
    const room = new GameRoom(id, whitePlayer, blackPlayer, isRanked);
    this.rooms.set(id, room);
    this.playerRooms.set(whitePlayer.userId, id);
    this.playerRooms.set(blackPlayer.userId, id);

    await games.insert({
      _id: id,
      white_id: whitePlayer.userId,
      black_id: blackPlayer.userId,
      white_username: whitePlayer.username,
      black_username: blackPlayer.username,
      is_ranked: isRanked,
      white_elo_before: whitePlayer.elo,
      black_elo_before: blackPlayer.elo,
      moves: [],
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      pgn: '',
      result: null,
      started_at: new Date().toISOString(),
    });

    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomByPlayer(userId) {
    const roomId = this.playerRooms.get(userId);
    if (!roomId) return null;
    return this.rooms.get(roomId);
  }

  removeRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
      this.playerRooms.delete(room.white.userId);
      this.playerRooms.delete(room.black.userId);
      this.rooms.delete(roomId);
    }
  }
}

module.exports = new RoomManager();
