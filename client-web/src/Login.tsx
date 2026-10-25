import { useState } from 'react';
import { api } from './api';
import type { Session } from './App';

export default function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login(username, password)
        : await api.register(username, password);
      onLogin(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>{mode === 'login' ? 'Вход' : 'Регистрация'}</h1>
      <form onSubmit={submit}>
        <input
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button disabled={busy}>{busy ? '...' : mode === 'login' ? 'Войти' : 'Создать'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
      </button>
    </div>
  );
}