const { io } = require("socket.io-client");

const BASE_URL = "http://localhost:3000";
const NUM_USERS = 500; // Сколько пользователей
const MSGS_PER_USER = 50; // Сколько сообщений отправит каждый

async function runLoadTest() {
  console.log(`Старт теста: ${NUM_USERS} пользователей по ${MSGS_PER_USER} сообщений...`);
  
  const tokens = [];
  
  console.log("Создание пользователей...");
  for (let i = 0; i < NUM_USERS; i++) {
    const username = `stress_${Date.now()}_${i}`;
    try {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: "password123" })
      });
      const data = await res.json();
      if (data.token) tokens.push(data.token);
    } catch (e) {
      console.error("Ошибка регистрации:", e.message);
    }
  }
  console.log(`Успешно создано и залогинено: ${tokens.length} пользователей.`);

  console.log("Начинаем спам сообщениями...");
  let totalSent = 0;
  const startTime = Date.now();

  const promises = tokens.map((token) => {
    return new Promise((resolve) => {
      const socket = io(BASE_URL, { 
        auth: { token },
        transports: ['websocket']
      });
      
      socket.on('connect', () => {
        socket.emit('channel:join', { channelId: 1 });
        
        let sent = 0;
        const interval = setInterval(() => {
          if (sent >= MSGS_PER_USER) {
            clearInterval(interval);
            socket.disconnect();
            return resolve();
          }
          
          socket.emit('message:send', { 
            channelId: 1, 
            text: `Стресс-тест: сообщение ${sent} от юзера ${(socket.id || 'disconnected').slice(0, 4)}`
          });
          
          sent++;
          totalSent++;
        }, 100); 
      });

      socket.on('connect_error', (err) => {
        console.error('Socket ошибка:', err.message);
        resolve();
      });
    });
  });

  await Promise.all(promises);
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\nТест завершен!`);
  console.log(`Всего отправлено сообщений: ${totalSent}`);
  console.log(`Время выполнения: ${duration.toFixed(2)} сек.`);
  console.log(`Скорость: ${(totalSent / duration).toFixed(2)} сообщений/сек.`);
}

runLoadTest();