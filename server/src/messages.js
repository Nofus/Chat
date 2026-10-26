const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router({ mergeParams: true });

router.get('/', requireAuth, async (req, res) => {
  const channelId = Number(req.params.channelId);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before ? Number(req.query.before) : null;

  try {
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.user.id]
    );
    if (member.rowCount === 0) return res.status(403).json({ error: 'not a member' });

    const params = [channelId, limit];
    let where = 'm.channel_id = $1';
    if (before) { where += ' AND m.id < $3'; params.push(before); }

    const r = await pool.query(
      `SELECT m.id, m.text, m.type, m.created_at,
              u.id AS user_id, u.username
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE ${where}
       ORDER BY m.id DESC
       LIMIT $2`,
      params
    );
    res.json(r.rows.reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  const channelId = Number(req.params.channelId);
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

  try {
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.user.id]
    );
    if (member.rowCount === 0) return res.status(403).json({ error: 'not a member' });

    const r = await pool.query(
      `INSERT INTO messages (channel_id, user_id, text, type) VALUES ($1, $2, $3, 'user')
       RETURNING id, text, type, created_at, user_id`,
      [channelId, req.user.id, text.trim()]
    );

    // Снимаем флаг скрытия для всех остальных участников
    await pool.query(
      'UPDATE channel_members SET is_hidden = false WHERE channel_id = $1 AND user_id != $2',
      [channelId, req.user.id]
    );

    const msg = { ...r.rows[0], username: req.user.username, channel_id: channelId };
    req.app.get('io').to(`channel:${channelId}`).emit('message:new', msg);
    res.status(201).json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;