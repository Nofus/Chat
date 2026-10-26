const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const pool = require('./db');
const { router: authRouter, requireAuth } = require('./auth');
const channelsRouter = require('./channels');
const messagesRouter = require('./messages');
const usersRouter = require('./users');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/auth', authRouter);
app.use('/channels', channelsRouter);
app.use('/channels/:channelId/messages', messagesRouter);
app.use('/users', usersRouter);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/db-check', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, dbTime: r.rows[0].now });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('no token'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { next(new Error('invalid token')); }
});

io.on('connection', async (socket) => {
  console.log('socket connected:', socket.id, 'user:', socket.user.username);

  socket.join(`user:${socket.user.id}`);

  try {
    const channels = await pool.query(
      'SELECT channel_id FROM channel_members WHERE user_id = $1',
      [socket.user.id]
    );
    channels.rows.forEach(row => socket.join(`channel:${row.channel_id}`));
  } catch (e) {
    console.error('Error joining channels:', e);
  }

  socket.on('disconnect', async () => {
    try {
      const room = io.sockets.adapter.rooms.get(`user:${socket.user.id}`);
      if (!room || room.size === 0) {
        await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [socket.user.id]);
      }
    } catch (e) {
      console.error('Error on disconnect:', e);
    }
  });

  socket.on('channel:join', async ({ channelId }) => {
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, socket.user.id]
    );
    if (member.rowCount === 0) return;
    socket.join(`channel:${channelId}`);
  });

  socket.on('message:send', async ({ channelId, text, image_url }, ack) => {
    if ((!text || !text.trim()) && !image_url) return ack?.({ error: 'text or image required' });
    
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, socket.user.id]
    );
    if (member.rowCount === 0) return ack?.({ error: 'not a member' });

    const ch = await pool.query('SELECT is_direct FROM channels WHERE id = $1', [channelId]);
    if (ch.rows[0]?.is_direct) {
      const other = await pool.query(
        'SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id != $2 LIMIT 1',
        [channelId, socket.user.id]
      );
      if (other.rowCount > 0) {
        const targetId = other.rows[0].user_id;
        
        const iBlocked = await pool.query(
          'SELECT 1 FROM user_bans WHERE blocker_id = $1 AND blocked_id = $2',
          [socket.user.id, targetId]
        );
        if (iBlocked.rowCount > 0) {
          return ack?.({ error: 'Вы заблокировали этого пользователя. Разблокируйте, чтобы написать.' });
        }

        const theyBlocked = await pool.query(
          'SELECT 1 FROM user_bans WHERE blocker_id = $1 AND blocked_id = $2',
          [targetId, socket.user.id]
        );
        if (theyBlocked.rowCount > 0) {
          return ack?.({ error: 'Вы заблокированы этим пользователем' });
        }
      }
    }

    const userRes = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [socket.user.id]);
    const avatar_url = userRes.rows[0]?.avatar_url || null;

    const r = await pool.query(
      `INSERT INTO messages (channel_id, user_id, text, type, image_url) 
       VALUES ($1, $2, $3, 'user', $4)
       RETURNING id, text, type, created_at, user_id, image_url`,
      [channelId, socket.user.id, text ? text.trim() : '', image_url || null]
    );

    await pool.query(
      'UPDATE channel_members SET is_hidden = false WHERE channel_id = $1 AND user_id != $2',
      [channelId, socket.user.id]
    );

    const msg = { ...r.rows[0], username: socket.user.username, avatar_url, channel_id: channelId };
    io.to(`channel:${channelId}`).emit('message:new', msg);
    ack?.({ ok: true, message: msg });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
