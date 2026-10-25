const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// мои каналы (только те, где состою)
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.created_at, c.is_private, c.is_system,
              TRUE AS joined
       FROM channels c
       WHERE EXISTS(SELECT 1 FROM channel_members m
                    WHERE m.channel_id = c.id AND m.user_id = $1)
       ORDER BY c.is_system DESC, c.name`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// поиск по имени (включая system, исключая те, где уже состою)
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.is_private, c.is_system,
              EXISTS(SELECT 1 FROM channel_members m
                     WHERE m.channel_id = c.id AND m.user_id = $1) AS joined
       FROM channels c
       WHERE c.name ILIKE $2
       ORDER BY c.is_system DESC, c.name
       LIMIT 20`,
      [req.user.id, `%${q}%`]
    );
    res.json(r.rows.filter(row => !row.joined));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// создание
router.post('/', requireAuth, async (req, res) => {
  const { name, isPrivate, password } = req.body || {};
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'name required (min 2 chars)' });
  }
  if (isPrivate && (!password || password.length < 4)) {
    return res.status(400).json({ error: 'password required (min 4 chars) for private channel' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = isPrivate ? await bcrypt.hash(password, 10) : null;
    const c = await client.query(
      `INSERT INTO channels (name, created_by, is_private, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, created_at, is_private, is_system`,
      [name.trim(), req.user.id, !!isPrivate, hash]
    );
    await client.query(
      `INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [c.rows[0].id, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...c.rows[0], joined: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'channel name taken' });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// вступление
router.post('/:id/join', requireAuth, async (req, res) => {
  const channelId = Number(req.params.id);
  const { password } = req.body || {};
  try {
    const c = await pool.query(
      'SELECT id, is_private, password_hash FROM channels WHERE id = $1',
      [channelId]
    );
    if (c.rowCount === 0) return res.status(404).json({ error: 'channel not found' });
    const ch = c.rows[0];

    const existing = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.user.id]
    );
    if (existing.rowCount > 0) return res.json({ ok: true, already: true });

    if (ch.is_private) {
      if (!password) return res.status(401).json({ error: 'password required' });
      const ok = await bcrypt.compare(password, ch.password_hash);
      if (!ok) return res.status(403).json({ error: 'wrong password' });
    }

    await pool.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [channelId, req.user.id]
    );

    // системное сообщение «вступил в канал»
    const sysMsg = await pool.query(
      `INSERT INTO messages (channel_id, user_id, text, type)
       VALUES ($1, $2, 'вступает в канал', 'system')
       RETURNING id, text, type, created_at, user_id`,
      [channelId, req.user.id]
    );
    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channelId}`).emit('message:new', {
        ...sysMsg.rows[0],
        username: req.user.username,
        channel_id: channelId,
      });
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// выход из канала
router.delete('/:id/leave', requireAuth, async (req, res) => {
  const channelId = Number(req.params.id);
  try {
    const r = await pool.query(
      'DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not a member' });

    const sysMsg = await pool.query(
      `INSERT INTO messages (channel_id, user_id, text, type)
       VALUES ($1, $2, 'покидает канал', 'system')
       RETURNING id, text, type, created_at, user_id`,
      [channelId, req.user.id]
    );
    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channelId}`).emit('message:new', {
        ...sysMsg.rows[0],
        username: req.user.username,
        channel_id: channelId,
      });
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;