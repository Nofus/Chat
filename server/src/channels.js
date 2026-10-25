const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.created_at,
              EXISTS(SELECT 1 FROM channel_members m
                     WHERE m.channel_id = c.id AND m.user_id = $1) AS joined
       FROM channels c
       ORDER BY c.id`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'name required (min 2 chars)' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await client.query(
      'INSERT INTO channels (name, created_by) VALUES ($1, $2) RETURNING *',
      [name, req.user.id]
    );
    await client.query(
      'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)',
      [c.rows[0].id, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(c.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'channel name taken' });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// вступить в канал
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;