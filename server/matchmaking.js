const ELO_RANGE_INITIAL = 100;
const ELO_RANGE_INCREMENT = 50;
const ELO_RANGE_MAX = 500;
const EXPAND_INTERVAL_MS = 5000;

class MatchmakingQueue {
  constructor() {
    this.queue = new Map(); // userId -> { userId, username, elo, joinedAt, range }
    this.expandTimer = null;
  }

  addPlayer(userId, username, elo) {
    if (this.queue.has(userId)) return false;
    this.queue.set(userId, {
      userId,
      username,
      elo,
      joinedAt: Date.now(),
      range: ELO_RANGE_INITIAL,
    });
    this.startExpanding();
    return true;
  }

  removePlayer(userId) {
    this.queue.delete(userId);
    if (this.queue.size === 0) this.stopExpanding();
  }

  isInQueue(userId) {
    return this.queue.has(userId);
  }

  findMatch() {
    const players = Array.from(this.queue.values());
    if (players.length < 2) return null;

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        const diff = Math.abs(a.elo - b.elo);
        if (diff <= a.range && diff <= b.range) {
          this.queue.delete(a.userId);
          this.queue.delete(b.userId);
          return { player1: a, player2: b };
        }
      }
    }
    return null;
  }

  expandRanges() {
    for (const player of this.queue.values()) {
      player.range = Math.min(player.range + ELO_RANGE_INCREMENT, ELO_RANGE_MAX);
    }
  }

  startExpanding() {
    if (this.expandTimer) return;
    this.expandTimer = setInterval(() => {
      this.expandRanges();
    }, EXPAND_INTERVAL_MS);
  }

  stopExpanding() {
    if (this.expandTimer) {
      clearInterval(this.expandTimer);
      this.expandTimer = null;
    }
  }

  getQueueSize() {
    return this.queue.size;
  }
}

module.exports = new MatchmakingQueue();
