import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { getProfileByTelegramId, registerLocationRoutes, startLocationBot, handleUpdate } from './locationBot.js';

const { Pool } = pg;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data, X-Telegram-Bot-Api-Secret-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const demoMode = process.env.DEMO_MODE === 'true';
const botToken = process.env.BOT_TOKEN || '';
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    })
  : null;

const demoOrders = new Map();

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'life-food-api',
    database: Boolean(pool),
    demoMode,
    botConfigured: Boolean(botToken),
    webhookMode: Boolean(process.env.VERCEL)
  });
});

app.get('/api/profile', async (req, res) => {
  const tgUser = validateTelegramInitData(req.get('X-Telegram-Init-Data'));
  if (!tgUser) return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });

  if (!pool) {
    const profile = getProfileByTelegramId(tgUser.id);
    return res.json({
      ok: true,
      profile: profile ? {
        telegramUserId: profile.telegramUserId,
        name: profile.name || tgUser.first_name || '',
        surname: profile.surname || tgUser.last_name || '',
        phone: profile.phone || null,
        location: profile.location || null
      } : {
        telegramUserId: tgUser.id,
        name: tgUser.first_name || '',
        surname: tgUser.last_name || '',
        phone: null,
        location: null
      }
    });
  }

  try {
    const { rows } = await pool.query(
      'SELECT telegram_user_id, name, surname, phone, latitude, longitude FROM profiles WHERE telegram_user_id = $1 LIMIT 1',
      [tgUser.id]
    );

    const profile = rows[0];
    return res.json({
      ok: true,
      profile: profile ? {
        telegramUserId: profile.telegram_user_id,
        name: profile.name,
        surname: profile.surname,
        phone: profile.phone,
        location: profile.latitude != null && profile.longitude != null
          ? { lat: Number(profile.latitude), lon: Number(profile.longitude) }
          : null
      } : null
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'PROFILE_ERROR' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    const tgUser = validateTelegramInitData(body.telegramInitData);
    if (botToken && !tgUser) return res.status(401).json({ error: 'INVALID_TELEGRAM_DATA' });

    if (!body.forWho || !body.goal || !body.calories || !body.meal || !body.durationDays || !body.table) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    if (!pool && !demoMode) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }

    let profile = tgUser ? getProfileByTelegramId(tgUser.id) : null;
    if (pool && tgUser) {
      const { rows } = await pool.query(
        'SELECT name, surname, phone FROM profiles WHERE telegram_user_id = $1 LIMIT 1',
        [tgUser.id]
      );
      profile = rows[0] || profile;
    }

    const createdAt = new Date().toISOString();
    const values = {
      telegramUserId: tgUser?.id || null,
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

    if (!pool) {
      const id = crypto.randomUUID();
      demoOrders.set(id, { id, ...values, createdAt });
      console.log('DEMO ORDER', { id, ...values, createdAt });
      return res.status(201).json({ ok: true, order: { id, status: 'new', created_at: createdAt } });
    }

    const q = `
      INSERT INTO orders (
        telegram_user_id,name,surname,phone,recipient_phone,for_who,goal,
        calories,meal,duration_days,table_number,latitude,longitude,payment,status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id,status,created_at
    `;

    const params = [
      values.telegramUserId, values.name, values.surname, values.phone, values.recipientPhone,
      values.forWho, values.goal, values.calories, values.meal, values.durationDays,
      values.table, values.latitude, values.longitude, values.payment, values.status
    ];

    const { rows } = await pool.query(q, params);
    return res.status(201).json({ ok: true, order: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'SERVER_ERROR' });
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
    if (!pool && demoMode) console.log('Demo mode: database is OFF.');
    startLocationBot();
  });
}

export default app;
