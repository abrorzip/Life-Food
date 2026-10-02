import crypto from 'node:crypto';

const botToken = process.env.BOT_TOKEN || '';
const miniAppUrl = process.env.MINI_APP_URL || '';
const configuredBotUsername = process.env.BOT_USERNAME || '';
const pollingEnabled = process.env.BOT_POLLING !== 'false';

let botUsername = configuredBotUsername;
let identityPromise = null;
let pollingStarted = false;

const profiles = new Map();
const requests = new Map();
const pendingFlowByUser = new Map();
const pendingLocationByUser = new Map();

function validateTelegramInitData(initData) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculated.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try { return JSON.parse(params.get('user') || ''); } catch { return null; }
}

async function telegramRequest(method, payload = {}) {
  if (!botToken) throw new Error('BOT_TOKEN_MISSING');
  const response = await fetch(
    'https://api.telegram.org/bot' + botToken + '/' + method,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error('TELEGRAM_' + method + '_FAILED');
  return data.result;
}

async function ensureBotIdentity() {
  if (botUsername) return botUsername;
  if (!identityPromise) {
    identityPromise = telegramRequest('getMe')
      .then(me => { botUsername = me.username; return botUsername; })
      .catch(error => { identityPromise = null; throw error; });
  }
  return identityPromise;
}

async function sendMessage(chatId, text, replyMarkup) {
  return telegramRequest('sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
}

function miniAppReturnUrl(requestId) {
  return miniAppUrl + (miniAppUrl.includes('?') ? '&' : '?') + 'location_request=' + encodeURIComponent(requestId);
}

function locationKeyboard() {
  return {
    keyboard: [[{ text: '📍 Lokatsiyani yuborish', request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: '📱 Telefon raqamimni yuborish', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

function miniAppKeyboard() {
  return {
    inline_keyboard: [[{ text: '🍱 Buyurtma berish', web_app: { url: miniAppUrl } }]]
  };
}

function cleanup() {
  const now = Date.now();
  for (const [id, request] of requests) {
    if (now - request.createdAt > 10 * 60 * 1000) requests.delete(id);
  }
  for (const [userId, profile] of profiles) {
    if (profile.createdAt && now - profile.createdAt > 24 * 60 * 60 * 1000) {
      profiles.delete(userId);
    }
  }
}
setInterval(cleanup, 60 * 1000).unref();

async function startRegistration(chatId, userId, from) {
  const existing = profiles.get(String(userId));
  if (existing?.complete) {
    await sendMessage(chatId, 'Profilingiz tayyor. LIFE FOOD buyurtmasini Mini App orqali bering.', miniAppKeyboard());
    return;
  }

  profiles.set(String(userId), {
    telegramUserId: userId,
    name: '',
    surname: '',
    phone: null,
    location: null,
    state: 'name',
    createdAt: Date.now(),
    telegramName: from?.first_name || ''
  });

  await sendMessage(chatId, 'Assalomu alaykum! 👋\n\nLIFE FOOD uchun profil ochamiz.\nIsmingizni yozing.');
}

async function handleUpdate(update) {
  const message = update?.message;
  if (!message?.chat || !message.from) return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const key = String(userId);
  const text = String(message.text || '').trim();

  if (text.startsWith('/start')) {
    const startParam = text.split(/\s+/)[1] || '';

    if (startParam.startsWith('loc_')) {
      const requestId = startParam.slice(4);
      const request = requests.get(requestId);
      if (!request || request.userId !== userId || request.status !== 'pending') {
        await sendMessage(chatId, 'Bu lokatsiya so‘rovi topilmadi yoki muddati tugagan.');
        return;
      }
      pendingLocationByUser.set(key, requestId);
      await sendMessage(chatId, '📍 Yangi yetkazib berish lokatsiyangizni yuboring.', locationKeyboard());
      return;
    }

    await startRegistration(chatId, userId, message.from);
    return;
  }

  const profile = profiles.get(key);

  if (message.contact) {
    if (!profile || profile.state !== 'phone') {
      await sendMessage(chatId, 'Avval /start orqali registratsiyani boshlang.');
      return;
    }
    if (message.contact.user_id && Number(message.contact.user_id) !== userId) {
      await sendMessage(chatId, 'Iltimos, aynan o‘zingizning Telegram raqamingizni yuboring.');
      return;
    }
    profile.phone = message.contact.phone_number;
    profile.state = 'location';
    await sendMessage(chatId, 'Rahmat. Endi 📍 manzilingizni yuboring.', locationKeyboard());
    return;
  }

  if (message.location) {
    const pendingRequestId = pendingLocationByUser.get(key);
    if (pendingRequestId) {
      const request = requests.get(pendingRequestId);
      if (!request || request.userId !== userId || request.status !== 'pending') {
        await sendMessage(chatId, 'Bu lokatsiya so‘rovi topilmadi yoki muddati tugagan.');
        return;
      }
      request.location = { lat: Number(message.location.latitude), lon: Number(message.location.longitude) };
      request.status = 'ready';
      request.updatedAt = Date.now();
      pendingLocationByUser.delete(key);
      await sendMessage(chatId, '✅ Lokatsiya qabul qilindi. Mini Appga qaytib, buyurtmani davom ettiring.', {
        inline_keyboard: [[{ text: '🍱 Mini Appga qaytish', web_app: { url: miniAppReturnUrl(pendingRequestId) } }]]
      });
      return;
    }

    if (!profile || profile.state !== 'location') {
      await sendMessage(chatId, 'Avval /start orqali registratsiyani boshlang.');
      return;
    }
    profile.location = { lat: Number(message.location.latitude), lon: Number(message.location.longitude) };
    profile.state = 'complete';
    profile.complete = true;
    await sendMessage(chatId, '✅ Profilingiz tayyor!\n\nEndi LIFE FOOD buyurtmasini Mini App orqali bering.', {
      remove_keyboard: true
    });
    await sendMessage(chatId, '🍱 Buyurtmani boshlash', miniAppKeyboard());
    return;
  }

  if (!profile) {
    await sendMessage(chatId, 'Avval /start ni bosing.');
    return;
  }

  if (profile.state === 'name') {
    profile.name = text;
    profile.state = 'surname';
    await sendMessage(chatId, 'Familiyangizni yozing.');
    return;
  }

  if (profile.state === 'surname') {
    profile.surname = text;
    profile.state = 'phone';
    await sendMessage(chatId, 'Telefon raqamingizni yuboring.', contactKeyboard());
    return;
  }

  if (profile.state === 'phone') {
    await sendMessage(chatId, 'Telefon uchun pastdagi “📱 Telefon raqamimni yuborish” tugmasini bosing.', contactKeyboard());
    return;
  }

  if (profile.state === 'location') {
    await sendMessage(chatId, 'Lokatsiya uchun pastdagi “📍 Lokatsiyani yuborish” tugmasini bosing.', locationKeyboard());
    return;
  }

  if (pendingLocationByUser.has(key)) {
    await sendMessage(chatId, 'Iltimos, Telegram Location yuboring.');
  }
}

export { handleUpdate };

export function registerLocationRoutes(app) {
  app.post('/api/location/request', async (req, res) => {
    try {
      if (!botToken || !miniAppUrl) return res.status(503).json({ error: 'BOT_LOCATION_FLOW_NOT_CONFIGURED' });
      const tgUser = validateTelegramInitData(req.body?.telegramInitData);
      if (!tgUser) return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });
      const username = await ensureBotIdentity();

      const old = pendingLocationByUser.get(String(tgUser.id));
      if (old) requests.delete(old);

      const requestId = crypto.randomUUID();
      requests.set(requestId, {
        requestId,
        userId: tgUser.id,
        status: 'pending',
        location: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      pendingLocationByUser.set(String(tgUser.id), requestId);

      return res.json({
        ok: true,
        requestId,
        botUrl: 'https://t.me/' + username + '?start=loc_' + encodeURIComponent(requestId)
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'LOCATION_REQUEST_ERROR' });
    }
  });

  app.get('/api/location/status', (req, res) => {
    const tgUser = validateTelegramInitData(req.get('X-Telegram-Init-Data'));
    if (!tgUser) return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });

    const requestId = String(req.query.requestId || '');
    const request = requests.get(requestId);
    if (!request || request.userId !== tgUser.id) return res.status(404).json({ error: 'LOCATION_REQUEST_NOT_FOUND' });

    return res.json({ ok: true, status: request.status, location: request.location });
  });

  app.get('/api/profile/demo', (_req, res) => {
    res.json({ ok: true, profiles: profiles.size });
  });
}

export function getProfileByTelegramId(userId) {
  return profiles.get(String(userId)) || null;
}

export async function startLocationBot() {
  if (pollingStarted || !botToken || !miniAppUrl || !pollingEnabled || process.env.VERCEL) return;
  pollingStarted = true;

  try {
    await ensureBotIdentity();
    console.log('Life Food bot polling enabled for @' + botUsername);
  } catch {
    pollingStarted = false;
    console.error('Telegram bot unavailable. Check BOT_TOKEN.');
    return;
  }

  let offset = 0;
  while (true) {
    try {
      const updates = await telegramRequest('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message']
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        try { await handleUpdate(update); }
        catch (error) { console.error('Telegram update error:', error.message); }
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
