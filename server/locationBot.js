import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from './firebase.js';

const botToken = process.env.BOT_TOKEN || '';
const miniAppUrl = process.env.MINI_APP_URL || '';
const configuredBotUsername = process.env.BOT_USERNAME || '';
const pollingEnabled = process.env.BOT_POLLING !== 'false';

let botUsername = configuredBotUsername;
let identityPromise = null;
let pollingStarted = false;

function userRef(userId) {
  return getDb().collection('profiles').doc(String(userId));
}

function requestRef(requestId) {
  return getDb().collection('locationRequests').doc(String(requestId));
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

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

  if (calculated.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get('user') || '');
  } catch {
    return null;
  }
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
      .then(me => {
        botUsername = me.username;
        return botUsername;
      })
      .catch(error => {
        identityPromise = null;
        throw error;
      });
  }

  return identityPromise;
}

async function sendMessage(chatId, text, replyMarkup) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup
  });
}

function miniAppReturnUrl(requestId) {
  return miniAppUrl +
    (miniAppUrl.includes('?') ? '&' : '?') +
    'location_request=' + encodeURIComponent(requestId);
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
    inline_keyboard: [[{
      text: '🍱 Buyurtma berish',
      web_app: { url: miniAppUrl }
    }]]
  };
}

async function getProfile(userId) {
  const snapshot = await userRef(userId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function saveProfile(userId, data) {
  await userRef(userId).set({
    telegramUserId: Number(userId),
    ...data,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

async function startRegistration(chatId, userId, from) {
  const existing = await getProfile(userId);

  if (existing?.complete) {
    await sendMessage(
      chatId,
      'Profilingiz tayyor. LIFE FOOD buyurtmasini Mini App orqali bering.',
      miniAppKeyboard()
    );
    return;
  }

  await saveProfile(userId, {
    name: '',
    surname: '',
    phone: null,
    location: null,
    state: 'name',
    complete: false,
    pendingLocationRequestId: null,
    telegramName: from?.first_name || '',
    createdAt: existing?.createdAt || FieldValue.serverTimestamp()
  });

  await sendMessage(chatId, 'Assalomu alaykum! 👋\n\nLIFE FOOD uchun profil ochamiz.\nIsmingizni yozing.');
}

async function handleUpdate(update) {
  const message = update?.message;
  if (!message?.chat || !message.from) return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = String(message.text || '').trim();

  if (text.startsWith('/start')) {
    const startParam = text.split(/\s+/)[1] || '';

    if (startParam.startsWith('loc_')) {
      const requestId = startParam.slice(4);
      const requestSnapshot = await requestRef(requestId).get();
      const request = requestSnapshot.exists ? requestSnapshot.data() : null;

      if (!request ||
          Number(request.userId) !== Number(userId) ||
          request.status !== 'pending' ||
          (request.expiresAt?.toMillis && request.expiresAt.toMillis() < Date.now())) {
        await sendMessage(chatId, 'Bu lokatsiya so‘rovi topilmadi yoki muddati tugagan.');
        return;
      }

      await saveProfile(userId, { pendingLocationRequestId: requestId });

      await sendMessage(
        chatId,
        '📍 Yangi yetkazib berish lokatsiyangizni yuboring.',
        locationKeyboard()
      );
      return;
    }

    await startRegistration(chatId, userId, message.from);
    return;
  }

  const profile = await getProfile(userId);

  if (message.contact) {
    if (!profile || profile.state !== 'phone') {
      await sendMessage(chatId, 'Avval /start orqali registratsiyani boshlang.');
      return;
    }

    if (message.contact.user_id && Number(message.contact.user_id) !== Number(userId)) {
      await sendMessage(chatId, 'Iltimos, aynan o‘zingizning Telegram raqamingizni yuboring.');
      return;
    }

    await saveProfile(userId, {
      phone: message.contact.phone_number,
      state: 'location'
    });

    await sendMessage(chatId, 'Rahmat. Endi 📍 manzilingizni yuboring.', locationKeyboard());
    return;
  }

  if (message.location) {
    const pendingRequestId = profile?.pendingLocationRequestId;

    if (pendingRequestId) {
      const requestSnapshot = await requestRef(pendingRequestId).get();
      const request = requestSnapshot.exists ? requestSnapshot.data() : null;

      if (!request ||
          Number(request.userId) !== Number(userId) ||
          request.status !== 'pending') {
        await sendMessage(chatId, 'Bu lokatsiya so‘rovi topilmadi yoki muddati tugagan.');
        return;
      }

      const location = {
        lat: Number(message.location.latitude),
        lon: Number(message.location.longitude)
      };

      await requestRef(pendingRequestId).set({
        status: 'ready',
        location,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      await saveProfile(userId, { pendingLocationRequestId: null });

      await sendMessage(
        chatId,
        '✅ Lokatsiya qabul qilindi. Mini Appga qaytib, buyurtmani davom ettiring.',
        {
          inline_keyboard: [[{
            text: '🍱 Mini Appga qaytish',
            web_app: { url: miniAppReturnUrl(pendingRequestId) }
          }]]
        }
      );
      return;
    }

    if (!profile || profile.state !== 'location') {
      await sendMessage(chatId, 'Avval /start orqali registratsiyani boshlang.');
      return;
    }

    const location = {
      lat: Number(message.location.latitude),
      lon: Number(message.location.longitude)
    };

    await saveProfile(userId, {
      location,
      state: 'complete',
      complete: true
    });

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
    await saveProfile(userId, {
      name: text,
      state: 'surname'
    });
    await sendMessage(chatId, 'Familiyangizni yozing.');
    return;
  }

  if (profile.state === 'surname') {
    await saveProfile(userId, {
      surname: text,
      state: 'phone'
    });
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

  if (profile.pendingLocationRequestId) {
    await sendMessage(chatId, 'Iltimos, Telegram Location yuboring.');
  }
}

export { handleUpdate };

export function registerLocationRoutes(app) {
  app.post('/api/location/request', async (req, res) => {
    try {
      if (!botToken || !miniAppUrl) {
        return res.status(503).json({ error: 'BOT_LOCATION_FLOW_NOT_CONFIGURED' });
      }

      const tgUser = validateTelegramInitData(req.body?.telegramInitData);
      if (!tgUser) {
        return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });
      }

      const db = getDb();
      const username = await ensureBotIdentity();
      const profileRef = userRef(tgUser.id);
      const profileSnapshot = await profileRef.get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      const oldRequestId = profile?.pendingLocationRequestId || '';

      if (oldRequestId) {
        await requestRef(oldRequestId).set({
          status: 'superseded',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }

      const requestId = crypto.randomUUID();

      await db.collection('locationRequests').doc(requestId).set({
        requestId,
        userId: Number(tgUser.id),
        status: 'pending',
        location: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      });

      await saveProfile(tgUser.id, {
        pendingLocationRequestId: requestId
      });

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

  app.get('/api/location/status', async (req, res) => {
    try {
      const tgUser = validateTelegramInitData(req.get('X-Telegram-Init-Data'));
      if (!tgUser) {
        return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });
      }

      const requestId = String(req.query.requestId || '');
      const snapshot = await requestRef(requestId).get();
      const request = snapshot.exists ? snapshot.data() : null;

      if (!request || Number(request.userId) !== Number(tgUser.id)) {
        return res.status(404).json({ error: 'LOCATION_REQUEST_NOT_FOUND' });
      }

      if (request.status === 'pending' && request.expiresAt?.toMillis?.() < Date.now()) {
        await requestRef(requestId).set({
          status: 'expired',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return res.json({ ok: true, status: 'expired', location: null });
      }

      return res.json({
        ok: true,
        status: request.status,
        location: request.location || null
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'LOCATION_STATUS_ERROR' });
    }
  });

  app.get('/api/profile/demo', async (_req, res) => {
    try {
      const snapshot = await getDb().collection('profiles').limit(100).get();
      return res.json({ ok: true, profiles: snapshot.size });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'PROFILE_COUNT_ERROR' });
    }
  });
}

export async function getProfileByTelegramId(userId) {
  return getProfile(userId);
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
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error('Telegram update error:', error.message);
        }
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
