import { useState, useEffect } from 'react';
import { api } from './api';
import type { User } from './App';

export default function ProfileModal({ user, isMe, onClose, onUpdate }: { user: User; isMe: boolean; onClose: () => void; onUpdate: (u: User) => void }) {
  const [profile, setProfile] = useState<any>(user);
  const [bio, setBio] = useState(user.bio || '');
  const [isEditing, setIsEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.getProfile(user.id).then((data) => {
      setProfile(data);
      setBio(data.bio || '');
    }).catch(console.error);
  }, [user.id]);

  const isOnline = profile.is_online;

  const getOnlineStatus = () => {
    if (isOnline) return 'в сети';
    if (!profile.last_seen_at) return 'не в сети';

    const diff = Date.now() - new Date(profile.last_seen_at).getTime();
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return 'был(а) только что';
    if (mins < 60) return `был(а) ${mins} мин. назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `был(а) ${hours} ч. назад`;
    return `был(а) ${Math.floor(hours / 24)} дн. назад`;
  };

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const updated = await api.uploadAvatar(file);
      setProfile((prev: any) => ({ ...prev, ...updated }));
      onUpdate(updated);
    } catch (err) { alert('Ошибка загрузки'); }
    setUploading(false);
  }

  async function saveBio() {
    try {
      const updated = await api.updateBio(bio);
      setProfile((prev: any) => ({ ...prev, ...updated }));
      onUpdate(updated);
      setIsEditing(false);
    } catch (err) { alert('Ошибка сохранения'); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        
        <div className="profile-header">
          <div className="avatar-container">
            {profile.avatar_url ? (
              <img src={`/api${profile.avatar_url}`} alt="avatar" className="profile-avatar" />
            ) : (
              <div className="profile-avatar placeholder">{profile.username[0].toUpperCase()}</div>
            )}
            {isMe && (
              <label className="avatar-upload-btn">
                {uploading ? (
                  <span style={{ fontSize: '14px', fontWeight: 'bold' }}>...</span>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                )}
                <input type="file" accept="image/*" onChange={handleAvatarChange} hidden />
              </label>
            )}
          </div>
          <h2>{profile.username}</h2>
          <div className={`status ${isOnline ? 'online' : ''}`}>
            {getOnlineStatus()}
          </div>
        </div>

        <div className="profile-bio">
          <h3>
            О себе 
            {isMe && !isEditing && (
              <button className="add-bio-btn" onClick={() => setIsEditing(true)}>Ред.</button>
            )}
          </h3>
          {isEditing ? (
            <div className="bio-edit">
              <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Расскажите о себе..." maxLength={200} />
              <button onClick={saveBio}>Сохранить</button>
            </div>
          ) : (
            <p>
              {profile.bio 
                ? profile.bio 
                : (isMe ? 'добавьте описание' : 'Пользователь ничего не рассказал о себе')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}