const express = require('express');
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
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, username, avatar_url, bio, last_seen_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'user not found' });
    
    const user = r.rows[0];
    const io = req.app.get('io');
    
    const room = io.sockets.adapter.rooms.get(`user:${user.id}`);
    user.is_online = !!(room && room.size > 0);
    
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/me', requireAuth, async (req, res) => {
  const { bio } = req.body || {};
  try {
    const r = await pool.query(
      'UPDATE users SET bio = $1 WHERE id = $2 RETURNING id, username, avatar_url, bio',
      [bio, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const avatarUrl = `/uploads/${req.file.filename}`;
  
  try {
    const old = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
    if (old.rows[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '..', old.rows[0].avatar_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const r = await pool.query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, username, avatar_url, bio',
      [avatarUrl, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:id/block', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Нельзя заблокировать себя' });
  try {
    await pool.query(
      'INSERT INTO user_bans (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, targetId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/block', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  try {
    await pool.query(
      'DELETE FROM user_bans WHERE blocker_id = $1 AND blocked_id = $2',
      [req.user.id, targetId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/block-status', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  try {
    const r = await pool.query(
      'SELECT 1 FROM user_bans WHERE blocker_id = $1 AND blocked_id = $2',
      [req.user.id, targetId]
    );
    res.json({ isBlocked: r.rowCount > 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;