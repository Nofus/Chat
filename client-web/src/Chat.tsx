import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Channel, Message } from './api';
import { connectSocket, disconnectSocket } from './socket';
import type { Session } from './App';
import type { Socket } from 'socket.io-client';
import ProfileModal from './ProfileModal';
import ChannelInfoModal from './ChannelInfoModal';
import type { User } from './App';

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

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

  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  
  const [maxReadByOthers, setMaxReadByOthers] = useState(0);

  const [dmMenuOpen, setDmMenuOpen] = useState(false);
  const [isTargetBlocked, setIsTargetBlocked] = useState(false);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const isAtBottomRef = useRef(true);

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshChannels = () => api.channels().then(setChannels).catch(console.error);

  const activeChannel = channels.find(c => c.id === activeId);
  const isDirectActive = activeChannel?.is_direct;
  const activeChannelName = activeChannel?.is_system && activeChannel.name === 'general' 
    ? 'Публичный' 
    : (activeChannel?.display_name || activeChannel?.name);

  useEffect(() => {
    socketRef.current = connectSocket(session.token);
    return () => disconnectSocket();
  }, [session.token]);

  useEffect(() => { refreshChannels(); }, []);

  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;
    
    const onNewGlobal = () => refreshChannels();
    const onDmNew = ({ channelId }: { channelId: number }) => {
      refreshChannels();
      s.emit('channel:join', { channelId });
    };
    const onBanned = ({ channelId }: { channelId: number }) => {
      if (activeId === channelId) {
        alert("Вы были заблокированы в этом канале.");
        setActiveId(null);
        setMessages([]);
      }
      refreshChannels();
    };

    s.on('message:new', onNewGlobal);
    s.on('dm:new', onDmNew);
    s.on('channel:banned', onBanned);
    
    return () => { 
      s.off('message:new', onNewGlobal); 
      s.off('dm:new', onDmNew);
      s.off('channel:banned', onBanned);
    };
  }, [activeId]);

  useEffect(() => {
    if (activeId && activeChannel?.is_direct && activeChannel.target_user_id) {
      api.getBlockStatus(activeChannel.target_user_id)
        .then(res => setIsTargetBlocked(res.isBlocked))
        .catch(console.error);
    } else {
      setIsTargetBlocked(false);
    }
    setDmMenuOpen(false);
  }, [activeId, activeChannel?.target_user_id]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    if (isAtBottomRef.current !== isBottom) {
      isAtBottomRef.current = isBottom;
      setIsAtBottom(isBottom);
    }
    if (isBottom) setNewMessagesCount(0);
  };

  const scrollToBottom = (smooth = true) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewMessagesCount(0);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  };

  useEffect(() => {
    const s = socketRef.current;
    if (!activeId || !s) return;

    setMessages([]);
    setNewMessagesCount(0);
    setMaxReadByOthers(0);
    setShowChannelInfo(false);

    api.messages(activeId).then((data) => {
      setMessages(data.messages);
      setMaxReadByOthers(data.maxReadByOthers);
      api.markAsRead(activeId).then(refreshChannels);
      setTimeout(() => scrollToBottom(false), 50);
    }).catch(console.error);

    s.emit('channel:join', { channelId: activeId });

    const onNew = (m: Message) => {
      if (m.channel_id === activeId) {
        setMessages((prev) => [...prev, m]);
        if (m.user_id !== session.user.id) {
          api.markAsRead(activeId).then(refreshChannels);
          if (!isAtBottomRef.current) setNewMessagesCount(prev => prev + 1);
          else setTimeout(() => scrollToBottom(true), 50);
        } else {
          setTimeout(() => scrollToBottom(true), 50);
        }
      }
    };

    // Слушаем событие, когда кто-то прочитал сообщения
    const onRead = ({ userId, lastReadMessageId }: any) => {
      if (userId !== session.user.id) {
        setMaxReadByOthers(prev => Math.max(prev, lastReadMessageId));
      }
    };

    s.on('message:new', onNew);
    s.on('channel:read', onRead);
    
    return () => { 
      s.off('message:new', onNew); 
      s.off('channel:read', onRead);
    };
  }, [activeId]);

  useEffect(() => {
    if (!search.trim()) { setSearchChannels([]); setSearchUsers([]); return; }
    const t = setTimeout(async () => {
      try {
        const [chs, usrs] = await Promise.all([api.searchChannels(search), api.searchUsers(search)]);
        setSearchChannels(chs); setSearchUsers(usrs);
      } catch (e) { console.error(e); }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const s = socketRef.current;
    if (!text.trim() || !activeId || !s) return;
    
    s.emit('message:send', { channelId: activeId, text }, (res: any) => {
      if (res?.error) {
        alert(res.error);
      } else {
        setText('');
        setTimeout(() => scrollToBottom(true), 50);
      }
    });
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const s = socketRef.current;
    if (!file || !activeId || !s) return;

    e.target.value = ''; 

    try {
      const { image_url } = await api.uploadMessageImage(activeId, file);
      s.emit('message:send', { channelId: activeId, text: '', image_url }, (res: any) => {
        if (res?.error) alert(res.error);
      });
    } catch (err: any) {
      alert(err.message);
    }
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
          <div className="my-profile-link" onClick={() => setProfileUser(session.user)}>
            {session.user.avatar_url ? (
              <img src={`/api${session.user.avatar_url}`} alt="me" className="my-avatar" />
            ) : (
              <div className="my-avatar placeholder">{session.user.username[0].toUpperCase()}</div>
            )}
            <span>{session.user.username}</span>
          </div>
          <button onClick={onLogout} className="logout-btn" title="Выйти">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>

        <div className="search-box">
          <input className="search" placeholder="Найти канал или юзера..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {(searchChannels.length > 0 || searchUsers.length > 0) && (
            <ul className="search-results">
              {searchUsers.map((u) => (
                <li key={`u_${u.id}`} onClick={() => openDirect(u.id)}>
                  {u.username}
                </li>
              ))}
              {searchChannels.map((c) => (
                <li key={`c_${c.id}`} onClick={() => joinAndOpen(c)}>
                  {c.is_private ? '[Приватный] ' : ''}{c.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="create-btn" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Отмена' : 'Создать канал'}
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
            const hasAvatar = c.avatar_url || (c.is_system && c.name === 'general');

            return (
              <li key={c.id} className={`channel-item ${c.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(c.id)}>
                <div className="channel-info">
                  <div className="sidebar-avatar-wrapper">
                    <div 
                      className="sidebar-avatar" 
                      style={!isDirect && !c.avatar_url && c.is_system ? { background: '#3b82f6' } : {}}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isDirect && c.target_user_id) {
                          setProfileUser({ id: c.target_user_id, username: c.display_name || '', avatar_url: c.target_avatar_url || null });
                        }
                      }}
                    >
                      {isDirect ? (
                        c.target_avatar_url ? <img src={`/api${c.target_avatar_url}`} alt="" /> : <div className="placeholder">{label.charAt(0).toUpperCase()}</div>
                      ) : c.avatar_url ? (
                        <img src={`/api${c.avatar_url}`} alt="" />
                      ) : c.is_system ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                      ) : (
                        <div className="placeholder">#</div>
                      )}
                    </div>
                    {isDirect && <span className={`status-dot ${c.target_is_online ? 'online' : 'offline'}`} />}
                  </div>
                  
                  <span>{label}</span>
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
        {activeId && activeChannel ? (
          <>
            <header className="chat-header">
              {isDirectActive ? (
                <div className="header-avatar-wrapper">
                  {activeChannel.target_avatar_url ? (
                    <img src={`/api${activeChannel.target_avatar_url}`} alt="avatar" className="header-avatar" />
                  ) : (
                    <div className="header-avatar placeholder">{activeChannelName?.[0].toUpperCase()}</div>
                  )}
                </div>
              ) : (
                <div className="header-avatar-wrapper">
                  {activeChannel.avatar_url ? (
                    <img src={`/api${activeChannel.avatar_url}`} alt="channel" className="header-avatar" />
                  ) : (
                    <div className="header-avatar placeholder" style={{ background: activeChannel.is_system ? '#3b82f6' : '#4a3051' }}>
                      {activeChannel.is_system ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="2" y1="12" x2="22" y2="12"></line>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                      ) : (
                        activeChannel.name[0].toUpperCase()
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="header-info">
                <div className="header-title">{activeChannelName}</div>
                {isDirectActive && (
                  <div className={`header-status ${activeChannel.target_is_online ? 'online' : ''}`}>
                    {activeChannel.target_is_online ? 'в сети' : 'не в сети'}
                  </div>
                )}
              </div>

              {}
              <div style={{ position: 'relative' }}>
                <button 
                  className="header-menu-btn" 
                  onClick={() => isDirectActive ? setDmMenuOpen(!dmMenuOpen) : setShowChannelInfo(true)}
                >
                  ⋮
                </button>
                
                {}
                {isDirectActive && dmMenuOpen && (
                  <div className="dm-menu">
                    <button onClick={async () => {
                      if (!activeChannel?.target_user_id) return;
                      try {
                        if (isTargetBlocked) {
                          await api.unblockUser(activeChannel.target_user_id);
                          setIsTargetBlocked(false);
                        } else {
                          if (!confirm(`Заблокировать ${activeChannelName}? Он не сможет вам писать.`)) return;
                          await api.blockUser(activeChannel.target_user_id);
                          setIsTargetBlocked(true);
                        }
                        setDmMenuOpen(false);
                      } catch (e: any) { alert(e.message); }
                    }}>
                      {isTargetBlocked ? 'Разблокировать' : 'Заблокировать'}
                    </button>
                  </div>
                )}
              </div>
            </header>

            <div className="messages" ref={messagesContainerRef} onScroll={handleScroll}>
              {messages.map((m, index) => {
                const isOwn = m.user_id === session.user.id;
                const prevMsg = messages[index - 1];
                const nextMsg = messages[index + 1];

                const showDate = !prevMsg || new Date(m.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();
                const isGrouped = prevMsg && prevMsg.user_id === m.user_id && !showDate && m.type === 'user' && 
                                  (new Date(m.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60000);
                const isLastInGroup = !nextMsg || nextMsg.user_id !== m.user_id || nextMsg.type === 'system' || 
                                      new Date(nextMsg.created_at).toDateString() !== new Date(m.created_at).toDateString();

                if (m.type === 'system') {
                  return (
                    <div key={m.id}>
                      {showDate && <div className="date-divider">{formatDate(m.created_at)}</div>}
                      <div className="msg-system"><b>{m.username}</b> {m.text}</div>
                    </div>
                  );
                }

                return (
                  <div key={m.id}>
                    {showDate && <div className="date-divider">{formatDate(m.created_at)}</div>}
                    <div className={`msg-wrapper ${isOwn ? 'own' : 'other'} ${isGrouped ? 'grouped' : ''}`}>
                      {!isOwn && !isGrouped && (
                        <div className="msg-avatar-wrapper">
                          {m.avatar_url ? <img src={`/api${m.avatar_url}`} alt="" className="msg-avatar" /> : <div className="msg-avatar placeholder">{m.username[0].toUpperCase()}</div>}
                        </div>
                      )}
                      {!isOwn && isGrouped && <div className="msg-avatar-spacer"></div>}

                      <div className="msg-content-wrapper">
                        {!isOwn && !isGrouped && <div className="msg-author">{m.username}</div>}
                        <div className={`msg-bubble ${isLastInGroup ? 'last' : ''} ${m.image_url ? 'has-image' : ''}`}>
                          {m.image_url && (
                            <img 
                              src={`/api${m.image_url}`} 
                              alt="attachment" 
                              className="msg-image" 
                              onClick={() => window.open(`/api${m.image_url}`, '_blank')}
                            />
                          )}
                          {m.text && <span className="msg-text">{m.text}</span>}
                          
                          <span className="msg-time">
                            {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            
                            {}
                            {isOwn && (
                              <span className="msg-status">
                                {m.id <= maxReadByOthers ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                  </svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                  </svg>
                                )}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {!isAtBottom && (
              <button className="scroll-bottom-btn" onClick={() => scrollToBottom(true)}>
                ↓
                {newMessagesCount > 0 && <span className="scroll-badge">{newMessagesCount}</span>}
              </button>
            )}

            <form onSubmit={send} className="composer">
              <button 
                type="button" 
                className="attach-btn" 
                title="Прикрепить файл"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              </button>
              <input 
                type="file" 
                accept="image/*" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                style={{ display: 'none' }} 
              />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Написать сообщение..." />
              <button type="submit" className="send-btn" title="Отправить">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat-state">
            <p className="placeholder-text">Выбери канал или юзера слева</p>
          </div>
        )}
      </main>

      {profileUser && (
        <ProfileModal 
          user={profileUser} 
          isMe={profileUser.id === session.user.id}
          onClose={() => setProfileUser(null)}
          onUpdate={(u) => {
            if (u.id === session.user.id) {
              const newSession = { ...session, user: { ...session.user, ...u } };
              localStorage.setItem('session', JSON.stringify(newSession));
              window.location.reload(); 
            }
          }}
        />
      )}

      {showChannelInfo && activeChannel && (
        <ChannelInfoModal 
          channel={activeChannel} 
          currentUserId={session.user.id} 
          onClose={() => setShowChannelInfo(false)} 
          onUpdate={refreshChannels} 
        />
      )}
    </div>
  );
}