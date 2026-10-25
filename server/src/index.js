const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const pool = require('./db');
const { router: authRouter, requireAuth } = require('./auth');
const channelsRouter = require('./channels');
const messagesRouter = require('./messages');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/auth', authRouter);
app.use('/channels', channelsRouter);
app.use('/channels/:channelId/messages', messagesRouter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io); // чтобы роутеры могли emit-ить

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

io.on('connection', (socket) => {
  console.log('socket connected:', socket.id, 'user:', socket.user.username);

  socket.on('channel:join', async ({ channelId }) => {
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, socket.user.id]
    );
    if (member.rowCount === 0) return;
    socket.join(`channel:${channelId}`);
  });

  socket.on('message:send', async ({ channelId, text }, ack) => {
    if (!text || !text.trim()) return ack?.({ error: 'text required' });
    const member = await pool.query(
      'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
      [channelId, socket.user.id]
    );
    if (member.rowCount === 0) return ack?.({ error: 'not a member' });

    const r = await pool.query(
      `INSERT INTO messages (channel_id, user_id, text) VALUES ($1, $2, $3)
       RETURNING id, text, created_at, user_id`,
      [channelId, socket.user.id, text.trim()]
    );
    const msg = { ...r.rows[0], username: socket.user.username, channel_id: channelId };
    io.to(`channel:${channelId}`).emit('message:new', msg);
    ack?.({ ok: true, message: msg });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));