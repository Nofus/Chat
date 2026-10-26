import { useState, useEffect } from 'react';
import { api } from './api';
import type { Channel } from './api';

export default function ChannelInfoModal({ channel, currentUserId, onClose, onUpdate }: { channel: Channel; currentUserId: number; onClose: () => void; onUpdate: () => void }) {
  const [members, setMembers] = useState<any[]>([]);
  const [bans, setBans] = useState<any[]>([]);
  const [tab, setTab] = useState<'members' | 'bans'>('members');
  const [uploading, setUploading] = useState(false);

  const isAdmin = channel.role === 'owner' || channel.role === 'admin';
  const isSystem = channel.is_system;

  const loadData = () => {
    api.getChannelMembers(channel.id).then(setMembers).catch(console.error);
    if (isAdmin) {
      api.getChannelBans(channel.id).then(setBans).catch(console.error);
    }
  };

  useEffect(() => {
    loadData();
  }, [channel.id]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadChannelAvatar(channel.id, file);
      onUpdate();
      onClose();
    } catch (err) { alert('Ошибка загрузки'); }
    setUploading(false);
  }

  async function handleKick(userId: number, username: string) {
    if (!confirm(`Вы уверены, что хотите заблокировать ${username}?`)) return;
    try {
      await api.kickMember(channel.id, userId);
      loadData();
    } catch (err: any) { alert(err.message); }
  }

  async function handleUnban(userId: number) {
    try {
      await api.unbanMember(channel.id, userId);
      loadData();
    } catch (err: any) { alert(err.message); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        
        <div className="profile-header">
          <div className="avatar-container" style={{ width: '100px', height: '100px' }}>
            {channel.avatar_url ? (
              <img src={`/api${channel.avatar_url}`} alt="avatar" className="profile-avatar" />
            ) : (
              <div className="profile-avatar placeholder" style={{ background: isSystem ? '#3b82f6' : '#4a3051' }}>
                {isSystem ? (
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                ) : (
                  channel.name[0].toUpperCase()
                )}
              </div>
            )}
          </div>
          <h2>{isSystem ? 'Публичный' : channel.name}</h2>
          <div className="status">{isSystem ? 'Официальный канал' : (channel.is_private ? 'Приватный канал' : 'Публичный канал')}</div>
        </div>

        {isAdmin && !isSystem && (
          <div className="modal-tabs">
            <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Участники</button>
            <button className={tab === 'bans' ? 'active' : ''} onClick={() => setTab('bans')}>Черный список</button>
          </div>
        )}

        {tab === 'members' && (
          <div className="profile-bio">
            <h3>Участники ({members.length})</h3>
            <ul className="member-list">
              {members.map((m) => (
                <li key={m.id} className="member-item">
                  <div className="member-avatar-wrapper">
                    {m.avatar_url ? (
                      <img src={`/api${m.avatar_url}`} className="member-avatar" alt="" />
                    ) : (
                      <div className="member-avatar placeholder">{m.username[0].toUpperCase()}</div>
                    )}
                    <span className={`status-dot ${m.is_online ? 'online' : 'offline'}`} />
                  </div>
                  
                  <span className="member-name">
                    {m.username} {m.role === 'owner' && <span style={{fontSize: '12px', color: '#6b7280'}}>(Админ)</span>}
                  </span>
                  
                  {isAdmin && !isSystem && m.id !== currentUserId && m.role !== 'owner' && (
                    <button className="kick-btn" onClick={() => handleKick(m.id, m.username)} title="Заблокировать">✕</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'bans' && (
          <div className="profile-bio">
            <h3>Забаненные ({bans.length})</h3>
            {bans.length === 0 ? <p style={{color: '#9ca3af'}}>Список пуст</p> : (
              <ul className="member-list">
                {bans.map((b) => (
                  <li key={b.id} className="member-item">
                    {b.avatar_url ? (
                      <img src={`/api${b.avatar_url}`} className="member-avatar" alt="" />
                    ) : (
                      <div className="member-avatar placeholder">{b.username[0].toUpperCase()}</div>
                    )}
                    <span className="member-name">{b.username}</span>
                    <button className="unban-btn" onClick={() => handleUnban(b.id)}>Разбанить</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
    </div>
  );
}