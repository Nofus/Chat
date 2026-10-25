const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const router = express.Router();

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 4) {
    return res.status(400).json({ error: 'username and password (min 4 chars) required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, hash]
    );
    const user = r.rows[0];

    // авто-вступление в general + системное сообщение
    const g = await pool.query(
      'SELECT id FROM channels WHERE is_system = true LIMIT 1'
    );
    if (g.rowCount > 0) {
      const gId = g.rows[0].id;
      await pool.query(
        `INSERT INTO channel_members (channel_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [gId, user.id]
      );
      const sysMsg = await pool.query(
        `INSERT INTO messages (channel_id, user_id, text, type)
         VALUES ($1, $2, 'вступает в канал', 'system')
         RETURNING id, text, type, created_at, user_id`,
        [gId, user.id]
      );
      const io = req.app.get('io');
      if (io) {
        io.to(`channel:${gId}`).emit('message:new', {
          ...sysMsg.rows[0],
          username: user.username,
          channel_id: gId,
        });
      }
    }

    res.json({ token: sign(user), user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username taken' });
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    res.json({ token: sign(user), user: { id: user.id, username: user.username } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

module.exports = { router, requireAuth };