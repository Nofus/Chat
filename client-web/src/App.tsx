import { useState } from 'react';
import Login from './Login';
import Chat from './Chat';
import './App.css';

export type User = { 
  id: number; 
  username: string; 
  avatar_url?: string | null; 
  bio?: string | null; 
  last_seen_at?: string | null;
};

export type Session = { token: string; user: User };

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem('session');
    return raw ? JSON.parse(raw) : null;
  });

  function onLogin(s: Session) {
    localStorage.setItem('token', s.token);
    localStorage.setItem('session', JSON.stringify(s));
    setSession(s);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('session');
    setSession(null);
  }

  return session ? (
    <Chat session={session} onLogout={logout} />
  ) : (
    <Login onLogin={onLogin} />
  );
}

