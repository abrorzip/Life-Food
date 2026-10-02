import crypto from 'node:crypto';

const botToken = process.env.BOT_TOKEN || '';
const miniAppUrl = process.env.MINI_APP_URL || '';
const configuredBotUsername = process.env.BOT_USERNAME || '';
const pollingEnabled = process.env.BOT_POLLING !== 'false';

let botUsername = configuredBotUsername;
let identityPromise = null;
let pollingStarted = false;

const requests = new Map();
const pendingByUser = new Map();

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

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculated = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (
    calculated.length !== hash.length ||
    !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))
  ) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get('user') || '');
  } catch {
    return null;
  }
}

function cleanup() {
  const now = Date.now();
  for (const [requestId, request] of requests) {
    if (now - request.createdAt > 10 * 60 * 1000) {
      requests.delete(requestId);
      if (pendingByUser.get(String(request.userId)) === requestId) {
        pendingByUser.delete(String(request.userId));
      }
    }
  }
}
setInterval(cleanup, 60 * 1000).unref();

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
  if (!response.ok || !data.ok) {
    throw new Error('TELEGRAM_' + method + '_FAILED');
  }
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

function returnUrl(requestId) {
  return miniAppUrl + (miniAppUrl.includes('?') ? '&' : '?') +
    'location_request=' + encodeURIComponent(requestId);
}

async function sendMessage(chatId, text, reply_markup) {
  return telegramRequest('sendMessage', { chat_id: chatId, text, reply_markup });
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
      const request = requests.get(requestId);

      if (!request || request.userId !== userId || request.status !== 'pending') {
        await sendMessage(chatId, 'Bu lokatsiya so‘rovi topilmadi yoki muddati tugagan.');
        return;
      }

      pendingByUser.set(String(userId), requestId);

      await sendMessage(
        chatId,
        '📍 Yangi yetkazib berish lokatsiyangizni yuboring.',
        {
          keyboard: [[{ text: '📍 Lokatsiyani yuborish', request_location: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      );
      return;
    }

    await sendMessage(
      chatId,
      'Assalomu alaykum! LIFE FOOD buyurtmasini Mini App orqali bering.',
      miniAppUrl
        ? { inline_keyboard: [[{ text: '🍱 Buyurtma berish', web_app: { url: miniAppUrl } }]] }
        : undefined
    );
    return;
  }

  if (message.location) {
    const requestId = pendingByUser.get(String(userId));
    const request = requestId ? requests.get(requestId) : null;

    if (!request || request.userId !== userId || request.status !== 'pending') {
      await sendMessage(chatId, 'Avval Mini App ichidan “Lokatsiyani o‘zgartirish”ni bosing.');
      return;
    }

    request.location = {
      lat: Number(message.location.latitude),
      lon: Number(message.location.longitude)
    };
    request.status = 'ready';
    request.updatedAt = Date.now();
    pendingByUser.delete(String(userId));

    await sendMessage(
      chatId,
      '✅ Lokatsiya qabul qilindi. Mini Appga qaytib, buyurtmani davom ettiring.',
      {
        inline_keyboard: [[
          {
            text: '🍱 Mini Appga qaytish',
            web_app: { url: returnUrl(requestId) }
          }
        ]]
      }
    );
    return;
  }

  if (pendingByUser.has(String(userId))) {
    await sendMessage(
      chatId,
      '📍 Iltimos, “Lokatsiyani yuborish” tugmasini bosing va Telegram orqali lokatsiyani yuboring.'
    );
  }
}

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

      const username = await ensureBotIdentity();
      const oldRequestId = pendingByUser.get(String(tgUser.id));
      if (oldRequestId) requests.delete(oldRequestId);

      const requestId = crypto.randomUUID();
      requests.set(requestId, {
        requestId,
        userId: tgUser.id,
        status: 'pending',
        location: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      pendingByUser.set(String(tgUser.id), requestId);

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
    if (!tgUser) {
      return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });
    }

    const requestId = String(req.query.requestId || '');
    const request = requests.get(requestId);

    if (!request || request.userId !== tgUser.id) {
      return res.status(404).json({ error: 'LOCATION_REQUEST_NOT_FOUND' });
    }

    return res.json({
      ok: true,
      status: request.status,
      location: request.location
    });
  });
}

export async function startLocationBot() {
  if (pollingStarted || !botToken || !miniAppUrl || !pollingEnabled) return;

  pollingStarted = true;

  try {
    await ensureBotIdentity();
    console.log('Life Food location bot polling enabled for @' + botUsername);
  } catch {
    pollingStarted = false;
    console.error('Telegram bot location flow unavailable. Check BOT_TOKEN.');
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
