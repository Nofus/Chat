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
  const [searchChannels, setSearchChannels] = useState<Channel[]>([]);
  const [searchUsers, setSearchUsers] = useState<{ id: number; username: string }[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrivate, setNewPrivate] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshChannels = () => api.channels().then(setChannels).catch(console.error);

  useEffect(() => {
    socketRef.current = connectSocket(session.token);
    return () => disconnectSocket();
  }, [session.token]);

  useEffect(() => { refreshChannels(); }, []);

  // Глобальная подписка на новые сообщения (для обновления сайдбара: бейджи и сортировка)
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    const onNewGlobal = () => refreshChannels();
    s.on('message:new', onNewGlobal);
    return () => { s.off('message:new', onNewGlobal); };
  }, []);

  // Подписка для активного канала (для добавления сообщений в ленту)
  useEffect(() => {
    const s = socketRef.current;
    if (!activeId || !s) return;

    setMessages([]);
    api.messages(activeId).then((msgs) => {
      setMessages(msgs);
      api.markAsRead(activeId).then(refreshChannels);
    }).catch(console.error);

    s.emit('channel:join', { channelId: activeId });

    const onNew = (m: Message) => {
      if (m.channel_id === activeId) {
        setMessages((prev) => [...prev, m]);
        if (m.user_id !== session.user.id) {
          api.markAsRead(activeId).then(refreshChannels);
        }
      }
    };

    s.on('message:new', onNew);
    return () => { s.off('message:new', onNew); };
  }, [activeId]);

  useEffect(() => {
    if (!search.trim()) {
      setSearchChannels([]);
      setSearchUsers([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const [chs, usrs] = await Promise.all([
          api.searchChannels(search),
          api.searchUsers(search)
        ]);
        setSearchChannels(chs);
        setSearchUsers(usrs);
      } catch (e) { console.error(e); }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

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
      if (c.is_private && !c.is_system && !c.is_direct) {
        const pw = prompt(`Пароль для канала «${c.name}»:`);
        if (!pw) return;
        await api.joinChannel(c.id, pw);
      } else {
        await api.joinChannel(c.id);
      }
      await refreshChannels();
      setActiveId(c.id);
      setSearch('');
    } catch (e: any) { alert(e.message); }
  }

  async function openDirect(userId: number) {
    try {
      const res = await api.startDirectChat(userId);
      await refreshChannels();
      setActiveId(res.id);
      setSearch('');
    } catch (e: any) { alert(e.message); }
  }

  async function leaveChannel(c: Channel) {
    const action = c.is_direct ? 'Скрыть диалог' : 'Выйти из канала';
    const targetName = c.is_direct ? c.display_name : (c.display_name || c.name);

    if (!confirm(`${action} «${targetName}»?`)) return;
    try {
      await api.leaveChannel(c.id);
      if (activeId === c.id) { setActiveId(null); setMessages([]); }
      await refreshChannels();
    } catch (e: any) { alert(e.message); }
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
            placeholder="Найти канал или юзера..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(searchChannels.length > 0 || searchUsers.length > 0) && (
            <ul className="search-results">
              {searchUsers.map((u) => (
                <li key={`u_${u.id}`} onClick={() => openDirect(u.id)}>
                  👤 {u.username}
                </li>
              ))}
              {searchChannels.map((c) => (
                <li key={`c_${c.id}`} onClick={() => joinAndOpen(c)}>
                  {c.is_system && c.name === 'general' ? '📢 Публичный' : c.is_private ? '🔒' : '#'} {c.is_system && c.name === 'general' ? '' : c.name}
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
            <input placeholder="Имя канала" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <label>
              <input type="checkbox" checked={newPrivate} onChange={(e) => setNewPrivate(e.target.checked)} />
              Приватный
            </label>
            {newPrivate && (
              <input type="password" placeholder="Пароль (мин 4 символа)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            )}
            <button type="submit">Создать</button>
          </form>
        )}

        <ul className="channel-list">
          {channels.map((c) => {
            const isDirect = c.is_direct;
            const label = c.is_system && c.name === 'general' ? 'Публичный' : (c.display_name || c.name);
            const icon = isDirect ? '👤' : c.is_system ? '📢' : c.is_private ? '🔒' : '#';

            return (
              <li key={c.id} className={`channel-item ${c.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
                <div className="channel-info">
                  <span>{icon} {label}</span>
                  {c.unread_count !== undefined && c.unread_count > 0 && c.id !== activeId && (
                    <span className="unread-badge">{c.unread_count}</span>
                  )}
                </div>
                <button className="leave-btn" onClick={(e) => { e.stopPropagation(); leaveChannel(c); }} title={c.is_direct ? "Скрыть" : "Выйти"}>✕</button>
              </li>
            );
          })}
        </ul>
      </aside>

      <main className="chat">
        {activeId ? (
          <>
            <div className="messages">
              {messages.map((m) =>
                m.type === 'system' ? (
                  <div key={m.id} className="msg-system"><b>{m.username}</b> {m.text}</div>
                ) : (
                  <div key={m.id} className="msg">
                    <b>{m.username}</b>
                    <span className="time">{new Date(m.created_at).toLocaleTimeString()}</span>
                    <div>{m.text}</div>
                  </div>
                )
              )}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="composer">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение..." autoFocus />
              <button>→</button>
            </form>
          </>
        ) : (
          <p className="placeholder">Выбери канал или юзера слева</p>
        )}
      </main>
    </div>
  );
}