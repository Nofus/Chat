const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router({ mergeParams: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `msg_img_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только картинки'));
  }
});

router.post('/upload', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ image_url: `/uploads/${req.file.filename}` });
});

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
      `SELECT m.id, m.text, m.type, m.created_at, m.image_url,
              u.id AS user_id, u.username, u.avatar_url
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE ${where}
       ORDER BY m.id DESC
       LIMIT $2`,
      params
    );

    const readRes = await pool.query(
      `SELECT COALESCE(MAX(last_read_message_id), 0) as max_read
       FROM channel_members
       WHERE channel_id = $1 AND user_id != $2`,
      [channelId, req.user.id]
    );
    const maxReadByOthers = Number(readRes.rows[0].max_read);

    res.json({ 
      messages: r.rows.reverse(), 
      maxReadByOthers 
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  const channelId = Number(req.params.channelId);
  const { text, image_url } = req.body || {};
  if ((!text || !text.trim()) && !image_url) return res.status(400).json({ error: 'text or image required' });

  try {
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.user.id]
    );
    if (member.rowCount === 0) return res.status(403).json({ error: 'not a member' });

    const r = await pool.query(
      `INSERT INTO messages (channel_id, user_id, text, type, image_url) 
       VALUES ($1, $2, $3, 'user', $4)
       RETURNING id, text, type, created_at, user_id, image_url`,
      [channelId, req.user.id, text ? text.trim() : '', image_url || null]
    );

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