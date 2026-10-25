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

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Channel[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrivate, setNewPrivate] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    socketRef.current = connectSocket(session.token);
    return () => disconnectSocket();
  }, [session.token]);

  const refreshChannels = () =>
    api.channels().then(setChannels).catch(console.error);

  useEffect(() => { refreshChannels(); }, []);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      api.searchChannels(search).then(setSearchResults).catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const s = socketRef.current;
    if (!activeId || !s) return;
    setMessages([]);
    api.messages(activeId).then(setMessages).catch(console.error);
    s.emit('channel:join', { channelId: activeId });
    const onNew = (m: Message) => {
      if (m.channel_id === activeId) setMessages((prev) => [...prev, m]);
    };
    s.on('message:new', onNew);
    return () => { s.off('message:new', onNew); };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const s = socketRef.current;
    if (!text.trim() || !activeId || !s) return;
    s.emit('message:send', { channelId: activeId, text });
    setText('');
  }

  async function joinAndOpen(c: Channel) {
    try {
      if (c.is_private) {
        const pw = prompt(`Пароль для канала «${c.name}»:`);
        if (!pw) return;
        await api.joinChannel(c.id, pw);
      } else {
        await api.joinChannel(c.id);
      }
      await refreshChannels();
      setActiveId(c.id);
      setSearch('');
      setSearchResults([]);
    } catch (e: any) { alert(e.message); }
  }

  async function leaveChannel(c: Channel) {
    if (!confirm(`Выйти из канала «${c.name}»?`)) return;
    try {
      await api.leaveChannel(c.id);
      if (activeId === c.id) {
        setActiveId(null);
        setMessages([]);
      }
      await refreshChannels();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const c = await api.createChannel(newName.trim(), newPrivate, newPassword);
      setNewName(''); setNewPrivate(false); setNewPassword(''); setShowCreate(false);
      await refreshChannels();
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

        <div className="search-box">
          <input
            className="search"
            placeholder="Найти канал..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searchResults.length > 0 && (
            <ul className="search-results">
              {searchResults.map((c) => (
                <li key={c.id} onClick={() => joinAndOpen(c)}>
                  {c.is_private ? '🔒' : '#'} {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="create-btn" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '× отмена' : '+ Создать канал'}
        </button>

        {showCreate && (
          <form className="create-form" onSubmit={createChannel}>
            <input
              placeholder="Имя канала"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <label>
              <input
                type="checkbox"
                checked={newPrivate}
                onChange={(e) => setNewPrivate(e.target.checked)}
              />
              Приватный
            </label>
            {newPrivate && (
              <input
                type="password"
                placeholder="Пароль (мин 4 символа)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            )}
            <button type="submit">Создать</button>
          </form>
        )}

        <ul className="channel-list">
          {channels.map((c) => (
            <li
              key={c.id}
              className={`channel-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <span>
                {c.name === 'general' ? 'Публичный' : c.name}
              </span>
              <button
                className="leave-btn"
                onClick={(e) => { e.stopPropagation(); leaveChannel(c); }}
                title="Выйти из канала"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="chat">
        {activeId ? (
          <>
            <div className="messages">
              {messages.map((m) =>
                m.type === 'system' ? (
                  <div key={m.id} className="msg-system">
                    <b>{m.username}</b> {m.text}
                  </div>
                ) : (
                  <div key={m.id} className="msg">
                    <b>{m.username}</b>
                    <span className="time">
                      {new Date(m.created_at).toLocaleTimeString()}
                    </span>
                    <div>{m.text}</div>
                  </div>
                )
              )}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="composer">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Сообщение..."
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