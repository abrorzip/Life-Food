import crypto from 'node:crypto';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getDb } from './firebase.js';

const botToken = process.env.BOT_TOKEN || '';
const miniAppUrl = process.env.MINI_APP_URL || '';
const newMiniAppUrl = process.env.MINI_APP_NEW_URL || 'https://life-food-phi.vercel.app/miniapp/';
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
    inline_keyboard: [
      [{ text: '🍱 Appni ochish — asosiy', web_app: { url: miniAppUrl } }],
      [{ text: '✨ Appni ochish — yangi (demo)', web_app: { url: newMiniAppUrl } }],
      [{ text: '🔄 Yangilash', callback_data: 'refresh_apps' }]
    ]
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

  await sendMessage(chatId, 'Assalomu alaykum! 👋\n\nQuyidagi tugmalar orqali asosiy yoki yangi appni ochishingiz mumkin.\nYangi app hozircha demo.\n\nAsosiy app uchun profil ochamiz. Ismingizni yozing.', miniAppKeyboard());
}

function refreshSessionRef(userId) {
  return getDb().collection('botRefreshSessions').doc(String(userId));
}

function timestampMillis(value) {
  const parsed = Date.parse(serializeTimestamp(value) || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function broadcastAppMenu(requesterId) {
  const db = getDb();
  const controlRef = db.collection('botControls').doc('appMenuBroadcast');
  const acquired = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(controlRef);
    if (snapshot.exists && timestampMillis(snapshot.data().activeUntil) > Date.now()) return false;
    transaction.set(controlRef, { activeUntil: new Date(Date.now() + 10 * 60 * 1000) }, { merge: true });
    return true;
  });
  if (!acquired) return false;

  let delivered = 0;
  let failed = 0;
  let lastDoc = null;
  let requesterIncluded = false;
  try {
    while (true) {
      let query = db.collection('profiles').orderBy(FieldPath.documentId()).limit(100);
      if (lastDoc) query = query.startAfter(lastDoc);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      for (const doc of snapshot.docs) {
        const userId = Number(doc.data().telegramUserId || doc.id);
        if (!Number.isSafeInteger(userId) || userId <= 0) continue;
        if (userId === Number(requesterId)) requesterIncluded = true;
        try {
          await sendMessage(userId, 'Bot yangilandi', miniAppKeyboard());
          delivered += 1;
        } catch {
          failed += 1;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      lastDoc = snapshot.docs.at(-1);
      if (snapshot.size < 100) break;
    }
    if (!requesterIncluded) await sendMessage(requesterId, 'Bot yangilandi', miniAppKeyboard());
    return true;
  } finally {
    await controlRef.set({ activeUntil: new Date(0), delivered, failed, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

async function handleRefreshMessage(chatId, userId, text) {
  const sessionRef = refreshSessionRef(userId);
  const snapshot = await sessionRef.get();
  const session = snapshot.exists ? snapshot.data() : {};
  const blocked = timestampMillis(session.blockedUntil) > Date.now();
  if (text === '🔄 Yangilash' || text === '/yangilash') {
    if (blocked) {
      await sendMessage(chatId, 'Ko‘p noto‘g‘ri urinish. 5 daqiqadan keyin qayta urinib ko‘ring.');
      return true;
    }
    const attempts = timestampMillis(session.expiresAt) > Date.now() ? Number(session.attempts || 0) : 0;
    await sessionRef.set({ awaitingCode: true, expiresAt: new Date(Date.now() + 5 * 60 * 1000), attempts }, { merge: true });
    await sendMessage(chatId, 'Yangilash kodini kiriting. Bekor qilish: /cancel');
    return true;
  }
  if (!session.awaitingCode) return false;
  if (text === '/cancel' || text.startsWith('/start')) {
    await sessionRef.set({ awaitingCode: false }, { merge: true });
    if (text === '/cancel') {
      await sendMessage(chatId, 'Bekor qilindi.', miniAppKeyboard());
      return true;
    }
    return false;
  }
  if (blocked || timestampMillis(session.expiresAt) <= Date.now()) {
    await sessionRef.set({ awaitingCode: false, attempts: 0 }, { merge: true });
    await sendMessage(chatId, 'Kod kiritish muddati tugadi. “🔄 Yangilash”ni qayta bosing.');
    return true;
  }
  const expected = Buffer.from(process.env.BOT_REFRESH_CODE || '1234');
  const supplied = Buffer.from(text);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    const attempts = Number(session.attempts || 0) + 1;
    await sessionRef.set({ attempts, awaitingCode: attempts < 3, blockedUntil: attempts >= 3 ? new Date(Date.now() + 5 * 60 * 1000) : new Date(0) }, { merge: true });
    await sendMessage(chatId, attempts >= 3 ? 'Ko‘p noto‘g‘ri urinish. 5 daqiqadan keyin qayta urinib ko‘ring.' : 'Kod noto‘g‘ri. Qayta kiriting yoki /cancel bosing.');
    return true;
  }
  await sessionRef.set({ awaitingCode: false, attempts: 0, blockedUntil: new Date(0) }, { merge: true });
  if (!await broadcastAppMenu(userId)) {
    await sendMessage(chatId, 'Yangilash hozir bajarilmoqda. Birozdan keyin qayta urinib ko‘ring.');
  }
  return true;
}

let refreshWebhookPromise = null;
async function ensureRefreshCallbacks() {
  if (!refreshWebhookPromise) {
    refreshWebhookPromise = (async () => {
      const info = await telegramRequest('getWebhookInfo');
      if (!info.url || info.allowed_updates?.includes('callback_query')) return;
      const payload = { url: info.url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false };
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SETUP_SECRET || '';
      if (secret) payload.secret_token = secret;
      if (info.max_connections) payload.max_connections = info.max_connections;
      await telegramRequest('setWebhook', payload);
    })().catch(error => { refreshWebhookPromise = null; throw error; });
  }
  return refreshWebhookPromise;
}

async function handleUpdate(update) {
  const callback = update?.callback_query;
  if (callback?.data === 'refresh_apps') {
    if (callback.message?.chat?.type !== 'private' || !callback.from) return;
    await telegramRequest('answerCallbackQuery', { callback_query_id: callback.id });
    await handleRefreshMessage(callback.message.chat.id, callback.from.id, '🔄 Yangilash');
    return;
  }
  const message = update?.message;
  if (!message?.chat || !message.from) return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = String(message.text || '').trim();

  if (message.chat.type && message.chat.type !== 'private') return;
  if (text.startsWith('/start')) await ensureRefreshCallbacks();
  if (await handleRefreshMessage(chatId, userId, text)) return;

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
        allowed_updates: ['message', 'callback_query']
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
