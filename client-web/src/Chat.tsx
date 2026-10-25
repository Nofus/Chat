import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Channel, Message } from './api';
import { connectSocket, disconnectSocket } from './socket';
import type { Session } from './App';
import type { Socket } from 'socket.io-client';

export default function Chat({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [newChannel, setNewChannel] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

 // 1) один сокет на весь Chat
  useEffect(() => {
    socketRef.current = connectSocket(session.token);
    return () => disconnectSocket();
  }, [session.token]);

  // 2) список каналов — один раз
  useEffect(() => {
    api.channels().then(setChannels).catch(console.error);
  }, []);

  // 3) при смене канала: join в комнату + слушатель message:new
  useEffect(() => {
    const s = socketRef.current;
    if (!activeId || !s) return;

    const channel = channels.find((c) => c.id === activeId);
    if (!channel) return;

    setMessages([]);

    (async () => {
      try {
        if (!channel.joined) {
          await api.joinChannel(activeId);
          setChannels((prev) =>
            prev.map((c) => (c.id === activeId ? { ...c, joined: true } : c))
          );
        }
        const history = await api.messages(activeId);
        setMessages(history);
      } catch (e) {
        console.error(e);
      }
    })();

    s.emit('channel:join', { channelId: activeId });

    const onNew = (m: Message) => {
      if (m.channel_id === activeId) setMessages((prev) => [...prev, m]);
    };
    s.on('message:new', onNew);

    return () => {
      s.off('message:new', onNew);   // отписались от события, НЕ disconnect
    };
  }, [activeId, channels.length]);

  // скролл вниз
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // отправка через тот же сокет
  function send(e: React.FormEvent) {
    e.preventDefault();
    const s = socketRef.current;
    if (!text.trim() || !activeId || !s) return;
    s.emit('message:send', { channelId: activeId, text });
    setText('');
  }

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newChannel.trim()) return;
    try {
      const c = await api.createChannel(newChannel.trim());
      setNewChannel('');
      setChannels((prev) => [...prev, { ...c, joined: true }]);
      setActiveId(c.id);
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="user">
          <span>{session.user.username}</span>
          <button onClick={onLogout}>выйти</button>
        </div>
        <form onSubmit={createChannel} className="new-channel">
          <input value={newChannel} onChange={(e) => setNewChannel(e.target.value)} placeholder="новый канал" />
          <button>+</button>
        </form>
        <ul>
          {channels.map((c) => (
            <li
              key={c.id}
              className={c.id === activeId ? 'active' : ''}
              onClick={() => setActiveId(c.id)}
            >
              # {c.name}
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat">
        {activeId ? (
          <>
            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className="msg">
                  <b>{m.username}</b>
                  <span className="time">{new Date(m.created_at).toLocaleTimeString()}</span>
                  <div>{m.text}</div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="composer">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="сообщение..."
                autoFocus
              />
              <button>→</button>
            </form>
          </>
        ) : (
          <p className="placeholder">Выбери канал слева</p>
        )}
      </main>
    </div>
  );
}