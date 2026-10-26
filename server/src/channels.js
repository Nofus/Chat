const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `channel_${req.params.id}_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.created_at, c.is_private, c.is_system, c.is_direct, c.avatar_url,
              cm.role,
              COALESCE(u.username, c.name) AS display_name,
              u.id AS target_user_id,
              u.avatar_url AS target_avatar_url,
              (SELECT count(*) FROM messages msg 
               WHERE msg.channel_id = c.id 
                 AND msg.id > cm.last_read_message_id 
                 AND msg.user_id != $1 
                 AND msg.type = 'user') AS unread_count,
              COALESCE((SELECT MAX(created_at) FROM messages msg WHERE msg.channel_id = c.id), c.created_at) AS last_msg_time
       FROM channels c
       JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
       LEFT JOIN channel_members other_cm ON other_cm.channel_id = c.id AND other_cm.user_id != $1 AND c.is_direct = true
       LEFT JOIN users u ON u.id = other_cm.user_id
       WHERE cm.is_hidden = false
       ORDER BY last_msg_time DESC`,
      [req.user.id]
    );

    const io = req.app.get('io');
    const rows = r.rows.map(row => {
      if (row.is_direct && row.target_user_id) {
        const room = io.sockets.adapter.rooms.get(`user:${row.target_user_id}`);
        row.target_is_online = !!(room && room.size > 0);
      } else {
        row.target_is_online = false;
      }
      return row;
    });

    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  const searchQuery = (q === 'Публичный' || q === 'публичный') ? 'general' : q;

  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.is_private, c.is_system, c.avatar_url
       FROM channels c
       WHERE c.name ILIKE $2 AND c.is_direct = false
         AND NOT EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1)
       ORDER BY c.is_system DESC, c.name LIMIT 20`,
      [req.user.id, `%${searchQuery}%`]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

router.post('/direct', requireAuth, async (req, res) => {
  const { targetUserId } = req.body || {};
  if (!targetUserId || targetUserId === req.user.id) {
    return res.status(400).json({ error: 'invalid target user' });
  }

  const client = await pool.connect();
  const io = req.app.get('io');

  try {
    const existing = await client.query(
      `SELECT c.id FROM channels c
       JOIN channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $1
       JOIN channel_members m2 ON m2.channel_id = c.id AND m2.user_id = $2
       WHERE c.is_direct = true`,
      [req.user.id, targetUserId]
    );

    let channelId;
    if (existing.rowCount > 0) {
      channelId = existing.rows[0].id;
      await client.query(`UPDATE channel_members SET is_hidden = false WHERE channel_id = $1 AND user_id = $2`, [channelId, req.user.id]);
    } else {
      await client.query('BEGIN');
      const name = `dm_${req.user.id}_${targetUserId}`;
      const c = await client.query(
        `INSERT INTO channels (name, created_by, is_direct, is_private) VALUES ($1, $2, true, true) RETURNING id`,
        [name, req.user.id]
      );
      channelId = c.rows[0].id;
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`,
        [channelId, req.user.id, targetUserId]
      );
      await client.query('COMMIT');
    }

    if (io) {
      io.to(`user:${targetUserId}`).emit('dm:new', { channelId });
      io.to(`user:${req.user.id}`).emit('dm:new', { channelId });
    }

    res.json({ id: channelId, is_direct: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { name, isPrivate, password } = req.body || {};
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'name required' });
  if (isPrivate && (!password || password.length < 4)) return res.status(400).json({ error: 'password required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = isPrivate ? await bcrypt.hash(password, 10) : null;
    const c = await client.query(
      `INSERT INTO channels (name, created_by, is_private, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, created_at, is_private, is_system, avatar_url`,
      [name.trim(), req.user.id, !!isPrivate, hash]
    );
    await client.query(`INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner')`, [c.rows[0].id, req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({ ...c.rows[0], joined: true, role: 'owner' });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'channel name taken' });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post('/:id/join', requireAuth, async (req, res) => {
  const channelId = Number(req.params.id);
  const { password } = req.body || {};
  try {
    const banned = await pool.query('SELECT 1 FROM channel_bans WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
    if (banned.rowCount > 0) {
      return res.status(403).json({ error: 'Вы заблокированы в этом канале. Обратитесь к администратору.' });
    }

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

router.delete('/:id/leave', requireAuth, async (req, res) => {
  const channelId = Number(req.params.id);
  try {
    const ch = await pool.query('SELECT is_direct FROM channels WHERE id = $1', [channelId]);
    if (ch.rowCount === 0) return res.status(404).json({ error: 'channel not found' });

    if (ch.rows[0].is_direct) {
      await pool.query('UPDATE channel_members SET is_hidden = true WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
    } else {
      await pool.query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
      const sysMsg = await pool.query(`INSERT INTO messages (channel_id, user_id, text, type) VALUES ($1, $2, 'покидает канал', 'system') RETURNING id, text, type, created_at, user_id`, [channelId, req.user.id]);
      const io = req.app.get('io');
      if (io) io.to(`channel:${channelId}`).emit('message:new', { ...sysMsg.rows[0], username: req.user.username, channel_id: channelId });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE channel_members 
       SET last_read_message_id = COALESCE((SELECT MAX(id) FROM messages WHERE channel_id = $1), 0) 
       WHERE channel_id = $1 AND user_id = $2
       RETURNING last_read_message_id`,
      [req.params.id, req.user.id]
    );
    
    const io = req.app.get('io');
    if (io && r.rows[0]) {
      io.to(`channel:${req.params.id}`).emit('channel:read', {
        channelId: Number(req.params.id),
        userId: req.user.id,
        lastReadMessageId: r.rows[0].last_read_message_id
      });
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const channelId = req.params.id;
  
  try {
    const member = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
    if (!member.rows[0] || (member.rows[0].role !== 'owner' && member.rows[0].role !== 'admin')) {
      return res.status(403).json({ error: 'Только админ может менять аватарку' });
    }

    const avatarUrl = `/uploads/${req.file.filename}`;
    
    const old = await pool.query('SELECT avatar_url FROM channels WHERE id = $1', [channelId]);
    if (old.rows[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '..', old.rows[0].avatar_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const r = await pool.query('UPDATE channels SET avatar_url = $1 WHERE id = $2 RETURNING *', [avatarUrl, channelId]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, cm.role 
       FROM channel_members cm 
       JOIN users u ON u.id = cm.user_id 
       WHERE cm.channel_id = $1
       ORDER BY cm.role DESC, u.username`,
      [req.params.id]
    );

    const io = req.app.get('io');
    const members = r.rows.map(member => {
      const room = io.sockets.adapter.rooms.get(`user:${member.id}`);
      member.is_online = !!(room && room.size > 0);
      return member;
    });

    res.json(members);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/members/:userId', requireAuth, async (req, res) => {
  const channelId = req.params.id;
  const targetUserId = req.params.userId;

  try {
    const member = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, req.user.id]);
    if (!member.rows[0] || (member.rows[0].role !== 'owner' && member.rows[0].role !== 'admin')) {
      return res.status(403).json({ error: 'Нет прав для кика' });
    }

    const target = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, targetUserId]);
    if (target.rows[0]?.role === 'owner') {
      return res.status(403).json({ error: 'Нельзя кикнуть владельца' });
    }

    await pool.query('INSERT INTO channel_bans (channel_id, user_id, banned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [channelId, targetUserId, req.user.id]);
    await pool.query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, targetUserId]);
    
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${targetUserId}`).emit('channel:banned', { channelId: Number(channelId) });

      const sysMsg = await pool.query(
        `INSERT INTO messages (channel_id, user_id, text, type) VALUES ($1, $2, 'был исключен из канала', 'system') RETURNING id, text, type, created_at, user_id`,
        [channelId, targetUserId]
      );
      io.to(`channel:${channelId}`).emit('message:new', { ...sysMsg.rows[0], username: 'Система', channel_id: Number(channelId) });
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/bans', requireAuth, async (req, res) => {
  try {
    const member = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!member.rows[0] || (member.rows[0].role !== 'owner' && member.rows[0].role !== 'admin')) {
      return res.status(403).json({ error: 'Нет прав' });
    }

    const r = await pool.query(
      `SELECT u.id, u.username, u.avatar_url 
       FROM channel_bans b 
       JOIN users u ON u.id = b.user_id 
       WHERE b.channel_id = $1`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/bans/:userId', requireAuth, async (req, res) => {
  try {
    const member = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!member.rows[0] || (member.rows[0].role !== 'owner' && member.rows[0].role !== 'admin')) {
      return res.status(403).json({ error: 'Нет прав' });
    }

    await pool.query('DELETE FROM channel_bans WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;