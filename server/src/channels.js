const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Мои каналы и личные чаты (с непрочитанными и сортировкой по времени)
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.created_at, c.is_private, c.is_system, c.is_direct,
              CASE 
                WHEN c.is_direct THEN (
                  SELECT u.username FROM channel_members m2 
                  JOIN users u ON u.id = m2.user_id 
                  WHERE m2.channel_id = c.id AND m2.user_id != $1 LIMIT 1
                )
                ELSE c.name 
              END AS display_name,
              (SELECT count(*) FROM messages msg 
               WHERE msg.channel_id = c.id 
                 AND msg.id > cm.last_read_message_id 
                 AND msg.user_id != $1 
                 AND msg.type = 'user') AS unread_count,
              COALESCE((SELECT MAX(created_at) FROM messages msg WHERE msg.channel_id = c.id), c.created_at) AS last_msg_time
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
       WHERE cm.is_hidden = false
       ORDER BY last_msg_time DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// поиск каналов
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  const searchQuery = (q === 'Публичный' || q === 'публичный') ? 'general' : q;

  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.is_private, c.is_system
       FROM channels c
       WHERE c.name ILIKE $2 
         AND c.is_direct = false
         AND NOT EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1)
       ORDER BY c.is_system DESC, c.name
       LIMIT 20`,
      [req.user.id, `%${searchQuery}%`]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// поиск юзеров
router.get('/users/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  try {
    const r = await pool.query(
      `SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 20`,
      [`%${q}%`, req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// создание или получение личного чата (с авто-раскрытием, если был скрыт)
router.post('/direct', requireAuth, async (req, res) => {
  const { targetUserId } = req.body || {};
  if (!targetUserId || targetUserId === req.user.id) {
    return res.status(400).json({ error: 'invalid target user' });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT c.id FROM channels c
       JOIN channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $1
       JOIN channel_members m2 ON m2.channel_id = c.id AND m2.user_id = $2
       WHERE c.is_direct = true`,
      [req.user.id, targetUserId]
    );

    if (existing.rowCount > 0) {
      const channelId = existing.rows[0].id;
      // Раскрываем чат для текущего пользователя, если он был скрыт
      await client.query(
        `UPDATE channel_members SET is_hidden = false WHERE channel_id = $1 AND user_id = $2`,
        [channelId, req.user.id]
      );
      return res.json({ id: channelId, is_direct: true });
    }

    await client.query('BEGIN');
    const name = `dm_${req.user.id}_${targetUserId}`;
    const c = await client.query(
      `INSERT INTO channels (name, created_by, is_direct, is_private) 
       VALUES ($1, $2, true, true) RETURNING id`,
      [name, req.user.id]
    );
    
    const channelId = c.rows[0].id;
    await client.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [channelId, req.user.id, targetUserId]
    );
    await client.query('COMMIT');
    
    res.status(201).json({ id: channelId, is_direct: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// создание обычного канала
router.post('/', requireAuth, async (req, res) => {
  // ... (остаётся без изменений, как в прошлом шаге)
  const { name, isPrivate, password } = req.body || {};
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'name required' });
  if (isPrivate && (!password || password.length < 4)) return res.status(400).json({ error: 'password required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = isPrivate ? await bcrypt.hash(password, 10) : null;
    const c = await client.query(
      `INSERT INTO channels (name, created_by, is_private, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, created_at, is_private, is_system`,
      [name.trim(), req.user.id, !!isPrivate, hash]
    );
    await client.query(`INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner')`, [c.rows[0].id, req.user.id]);
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
  // ... (без изменений)
  const channelId = Number(req.params.id);
  const { password } = req.body || {};
  try {
    const c = await pool.query('SELECT id, is_private, password_hash FROM channels WHERE id = $1', [channelId]);
    if (c.rowCount === 0) return res.status(404).json({ error: 'channel not found' });
    const ch = c.rows[0];
    const existing = await pool.query('SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
    if (existing.rowCount > 0) {
      await pool.query('UPDATE channel_members SET is_hidden = false WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
      return res.json({ ok: true, already: true });
    }
    if (ch.is_private) {
      if (!password) return res.status(401).json({ error: 'password required' });
      const ok = await bcrypt.compare(password, ch.password_hash);
      if (!ok) return res.status(403).json({ error: 'wrong password' });
    }
    await pool.query(`INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)`, [channelId, req.user.id]);
    const sysMsg = await pool.query(`INSERT INTO messages (channel_id, user_id, text, type) VALUES ($1, $2, 'вступает в канал', 'system') RETURNING id, text, type, created_at, user_id`, [channelId, req.user.id]);
    const io = req.app.get('io');
    if (io) io.to(`channel:${channelId}`).emit('message:new', { ...sysMsg.rows[0], username: req.user.username, channel_id: channelId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Выход (или скрытие для DM)
router.delete('/:id/leave', requireAuth, async (req, res) => {
  const channelId = Number(req.params.id);
  try {
    const ch = await pool.query('SELECT is_direct FROM channels WHERE id = $1', [channelId]);
    if (ch.rowCount === 0) return res.status(404).json({ error: 'channel not found' });

    if (ch.rows[0].is_direct) {
      // Если это личный чат, просто скрываем его
      await pool.query('UPDATE channel_members SET is_hidden = true WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
    } else {
      // Если канал, удаляем членство
      await pool.query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
      const sysMsg = await pool.query(`INSERT INTO messages (channel_id, user_id, text, type) VALUES ($1, $2, 'покидает канал', 'system') RETURNING id, text, type, created_at, user_id`, [channelId, req.user.id]);
      const io = req.app.get('io');
      if (io) io.to(`channel:${channelId}`).emit('message:new', { ...sysMsg.rows[0], username: req.user.username, channel_id: channelId });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Отметить чат прочитанным
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE channel_members SET last_read_message_id = COALESCE((SELECT MAX(id) FROM messages WHERE channel_id = $1), 0) WHERE channel_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;