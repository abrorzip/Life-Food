import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb, isFirestoreConfigured } from './firebase.js';
import { getProfileByTelegramId, registerLocationRoutes, startLocationBot, handleUpdate } from './locationBot.js';

const app = express();

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Telegram-Init-Data, X-Telegram-Bot-Api-Secret-Token'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const demoMode = process.env.DEMO_MODE === 'true';
const botToken = process.env.BOT_TOKEN || '';
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

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

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return new Date(value).toISOString();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'life-food-api',
    database: isFirestoreConfigured(),
    databaseType: 'firestore',
    demoMode,
    botConfigured: Boolean(botToken),
    webhookMode: Boolean(process.env.VERCEL)
  });
});

app.get('/api/profile', async (req, res) => {
  try {
    const tgUser = validateTelegramInitData(req.get('X-Telegram-Init-Data'));
    if (!tgUser) return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });

    const profile = await getProfileByTelegramId(tgUser.id);

    return res.json({
      ok: true,
      profile: profile ? {
        telegramUserId: Number(profile.telegramUserId || tgUser.id),
        name: profile.name || tgUser.first_name || '',
        surname: profile.surname || tgUser.last_name || '',
        phone: profile.phone || null,
        location: profile.location || null,
        state: profile.state || null,
        complete: Boolean(profile.complete)
      } : {
        telegramUserId: Number(tgUser.id),
        name: tgUser.first_name || '',
        surname: tgUser.last_name || '',
        phone: null,
        location: null,
        state: null,
        complete: false
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'PROFILE_ERROR' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const tgUser = validateTelegramInitData(req.get('X-Telegram-Init-Data'));
    if (!tgUser) return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });

    const snapshot = await getDb()
      .collection('orders')
      .where('telegramUserId', '==', Number(tgUser.id))
      .limit(50)
      .get();

    const orders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() || 0;
        const bMs = b.createdAt?.toMillis?.() || 0;
        return bMs - aMs;
      })
      .map(order => ({
        ...order,
        createdAt: serializeTimestamp(order.createdAt)
      }));

    return res.json({ ok: true, orders });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'ORDERS_ERROR' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    const tgUser = validateTelegramInitData(body.telegramInitData);

    if (botToken && !tgUser) {
      return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });
    }

    if (!body.forWho || !body.goal || !body.calories || !body.meal || !body.durationDays || !body.table) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    if (!isFirestoreConfigured() && !demoMode) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }

    const profile = tgUser ? await getProfileByTelegramId(tgUser.id) : null;
    const createdAt = new Date().toISOString();

    const values = {
      telegramUserId: tgUser ? Number(tgUser.id) : null,
      name: profile?.name || tgUser?.first_name || '',
      surname: profile?.surname || tgUser?.last_name || '',
      phone: profile?.phone || null,
      recipientPhone: body.recipientPhone || null,
      forWho: body.forWho,
      goal: body.goal,
      calories: String(body.calories),
      meal: body.meal,
      durationDays: Number(body.durationDays),
      table: String(body.table),
      latitude: body.location?.lat ?? null,
      longitude: body.location?.lon ?? null,
      payment: body.payment || 'card',
      status: 'new'
    };

    if (!isFirestoreConfigured()) {
      const id = crypto.randomUUID();
      console.log('DEMO ORDER', { id, ...values, createdAt });
      return res.status(201).json({
        ok: true,
        order: { id, status: 'new', created_at: createdAt }
      });
    }

    const id = crypto.randomUUID();
    await getDb().collection('orders').doc(id).set({
      ...values,
      createdAt: FieldValue.serverTimestamp()
    });

    return res.status(201).json({
      ok: true,
      order: {
        id,
        status: 'new',
        created_at: createdAt
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.get('/api/telegram/webhook/setup', async (req, res) => {
  const setupSecret = process.env.TELEGRAM_WEBHOOK_SETUP_SECRET || '';
  if (!setupSecret || req.query.secret !== setupSecret) {
    return res.status(401).json({ error: 'INVALID_WEBHOOK_SETUP_SECRET' });
  }

  if (!botToken) {
    return res.status(503).json({ error: 'BOT_TOKEN_MISSING' });
  }

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL ||
    'https://life-food-phi.vercel.app/api/telegram/webhook';
  const secretToken = webhookSecret || setupSecret;

  try {
    const response = await fetch('https://api.telegram.org/bot' + botToken + '/setWebhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false
      })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      return res.status(502).json({
        error: 'TELEGRAM_SET_WEBHOOK_FAILED',
        telegram: data
      });
    }

    return res.json({
      ok: true,
      webhookUrl,
      description: data.result
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'WEBHOOK_SETUP_ERROR' });
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  const incomingSecret = req.get('X-Telegram-Bot-Api-Secret-Token') || '';

  if (webhookSecret && incomingSecret !== webhookSecret) {
    return res.status(401).json({ error: 'INVALID_WEBHOOK_SECRET' });
  }

  try {
    await handleUpdate(req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return res.status(500).json({ error: 'TELEGRAM_WEBHOOK_ERROR' });
  }
});

registerLocationRoutes(app);

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log('Life Food API listening on ' + port);
    if (!isFirestoreConfigured() && demoMode) console.log('Demo mode: Firestore is OFF.');
    startLocationBot();
  });
}

export default app;
