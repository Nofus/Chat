const BASE = '/api';

export type User = { 
  id: number; 
  username: string; 
  avatar_url?: string | null; 
  bio?: string | null; 
  last_seen_at?: string | null;
};

export type Channel = {
  id: number;
  name: string;
  display_name?: string;
  target_user_id?: number | null;
  target_avatar_url?: string | null;
  target_is_online?: boolean; 
  created_at?: string;
  joined: boolean;
  is_private: boolean;
  is_system: boolean;
  is_direct: boolean;
  avatar_url?: string | null;
  role?: 'owner' | 'admin' | 'member';
  unread_count?: number;
  last_msg_time?: string;
};

export type Message = {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  avatar_url?: string | null;
  text: string;
  image_url?: string | null; 
  type: 'user' | 'system';
  created_at: string;
};

function token() {
  return localStorage.getItem('token') || '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || res.statusText);
  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<{ token: string; user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  channels: () => request<Channel[]>('/channels'),
  searchChannels: (q: string) => request<Channel[]>(`/channels/search?q=${encodeURIComponent(q)}`),
  createChannel: (name: string, isPrivate = false, password = '') =>
    request<Channel>('/channels', { method: 'POST', body: JSON.stringify({ name, isPrivate, password }) }),
  joinChannel: (id: number, password = '') =>
    request<{ ok: true }>(`/channels/${id}/join`, { method: 'POST', body: JSON.stringify({ password }) }),
  leaveChannel: (id: number) => request<{ ok: true }>(`/channels/${id}/leave`, { method: 'DELETE' }),
  messages: (channelId: number) => 
    request<{ messages: Message[], maxReadByOthers: number }>(`/channels/${channelId}/messages`),
  searchUsers: (q: string) => request<{ id: number; username: string }[]>(`/channels/users/search?q=${encodeURIComponent(q)}`),
  markAsRead: (id: number) => request<{ ok: true }>(`/channels/${id}/read`, { method: 'POST' }),
  startDirectChat: (targetUserId: number) => request<{ id: number }>('/channels/direct', { method: 'POST', body: JSON.stringify({ targetUserId }) }),

  getProfile: (id: number) => request<User>(`/users/${id}`),
  updateBio: (bio: string) => request<User>('/users/me', { method: 'PUT', body: JSON.stringify({ bio }) }),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return fetch(`${BASE}/users/me/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
      body: formData,
    }).then(async (r) => {
      if (!r.ok) throw new Error('Ошибка загрузки аватарки');
      return r.json() as Promise<User>;
    });
  },
  getChannelMembers: (channelId: number) => request<any[]>(`/channels/${channelId}/members`),
  kickMember: (channelId: number, userId: number) => request<{ ok: true }>(`/channels/${channelId}/members/${userId}`, { method: 'DELETE' }),
  uploadChannelAvatar: (channelId: number, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return fetch(`${BASE}/channels/${channelId}/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
      body: formData,
    }).then(async (r) => {
      if (!r.ok) throw new Error('Ошибка загрузки аватарки канала');
      return r.json() as Promise<Channel>;
    });
  },

  getChannelBans: (channelId: number) => 
    request<any[]>(`/channels/${channelId}/bans`),
    
  unbanMember: (channelId: number, userId: number) => 
    request<{ ok: true }>(`/channels/${channelId}/bans/${userId}`, { method: 'DELETE' }),
  blockUser: (id: number) => request<{ ok: true }>(`/users/${id}/block`, { method: 'POST' }),
  unblockUser: (id: number) => request<{ ok: true }>(`/users/${id}/block`, { method: 'DELETE' }),
  getBlockStatus: (id: number) => request<{ isBlocked: boolean }>(`/users/${id}/block-status`),

   uploadMessageImage: (channelId: number, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return fetch(`${BASE}/channels/${channelId}/messages/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
      body: formData,
    }).then(async (r) => {
      if (!r.ok) throw new Error('Ошибка загрузки картинки');
      return r.json() as Promise<{ image_url: string }>;
    });
  },

};