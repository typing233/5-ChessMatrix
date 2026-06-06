const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { users } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'chess-matrix-secret-key-change-in-production';
const SALT_ROUNDS = 10;

function generateToken(user) {
  return jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function register(username, password) {
  if (!username || !password) throw new Error('Username and password required');
  if (username.length < 3 || username.length > 20) throw new Error('Username must be 3-20 characters');
  if (password.length < 4) throw new Error('Password must be at least 4 characters');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new Error('Username can only contain letters, numbers, and underscores');

  const existing = await users.findOne({ username });
  if (existing) throw new Error('Username already taken');

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await users.insert({
    username,
    password_hash: hash,
    elo_rating: 1200,
    games_played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    created_at: new Date().toISOString(),
  });

  const publicUser = { _id: user._id, username: user.username, elo_rating: user.elo_rating, games_played: 0, wins: 0, losses: 0, draws: 0 };
  return { user: publicUser, token: generateToken(user) };
}

async function login(username, password) {
  if (!username || !password) throw new Error('Username and password required');

  const user = await users.findOne({ username });
  if (!user) throw new Error('Invalid username or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('Invalid username or password');

  const publicUser = { _id: user._id, username: user.username, elo_rating: user.elo_rating, games_played: user.games_played, wins: user.wins, losses: user.losses, draws: user.draws };
  return { user: publicUser, token: generateToken(user) };
}

async function getUserById(id) {
  const user = await users.findOne({ _id: id });
  if (!user) return null;
  return { _id: user._id, username: user.username, elo_rating: user.elo_rating, games_played: user.games_played, wins: user.wins, losses: user.losses, draws: user.draws };
}

async function updateUserElo(userId, newElo) {
  await users.update({ _id: userId }, { $set: { elo_rating: newElo }, $inc: { games_played: 1 } });
}

async function incrementWins(userId) {
  await users.update({ _id: userId }, { $inc: { wins: 1 } });
}

async function incrementLosses(userId) {
  await users.update({ _id: userId }, { $inc: { losses: 1 } });
}

async function incrementDraws(userId) {
  await users.update({ _id: userId }, { $inc: { draws: 1 } });
}

async function getLeaderboard() {
  return users.find({}).sort({ elo_rating: -1 }).limit(20).exec().then(list =>
    list.map(u => ({ _id: u._id, username: u.username, elo_rating: u.elo_rating, games_played: u.games_played, wins: u.wins, losses: u.losses, draws: u.draws }))
  );
}

module.exports = { register, login, verifyToken, generateToken, getUserById, updateUserElo, incrementWins, incrementLosses, incrementDraws, getLeaderboard };
