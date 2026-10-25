const BASE = 'http://localhost:3000';

export type User = { id: number; username: string };
export type Channel = {
  id: number;
  name: string;
  created_at?: string;
  joined: boolean;
  is_private: boolean;
  is_system: boolean;
};
export type Message = {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  text: string;
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
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  channels: () => request<Channel[]>('/channels'),
  searchChannels: (q: string) =>
    request<Channel[]>(`/channels/search?q=${encodeURIComponent(q)}`),
  createChannel: (name: string, isPrivate = false, password = '') =>
    request<Channel>('/channels', {
      method: 'POST',
      body: JSON.stringify({ name, isPrivate, password }),
    }),
  joinChannel: (id: number, password = '') =>
    request<{ ok: true }>(`/channels/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  leaveChannel: (id: number) =>
    request<{ ok: true }>(`/channels/${id}/leave`, { method: 'DELETE' }),
  messages: (channelId: number) =>
    request<Message[]>(`/channels/${channelId}/messages`),
};