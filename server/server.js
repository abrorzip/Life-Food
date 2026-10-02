import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { registerLocationRoutes, startLocationBot } from './locationBot.js';
const {Pool}=pg;
const app=express();app.use(express.json());

const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:false}:undefined}):null;
function validateTelegramInitData(initData){if(!initData||!process.env.BOT_TOKEN)return null;const params=new URLSearchParams(initData);const hash=params.get('hash');if(!hash)return null;params.delete('hash');const data=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();const calc=crypto.createHmac('sha256',secret).update(data).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash)))return null;const authDate=Number(params.get('auth_date'));if(!authDate||Date.now()/1000-authDate>86400)return null;const user=params.get('user');return user?JSON.parse(user):null}
app.get('/api/health',(_,res)=>res.json({ok:true,service:'life-food-api'}));
app.post('/api/orders',async(req,res)=>{try{const b=req.body||{};const tgUser=validateTelegramInitData(b.telegramInitData);if(process.env.BOT_TOKEN&&!tgUser)return res.status(401).json({error:'INVALID_TELEGRAM_DATA'});if(!b.name||!b.phone||!b.forWho||!b.goal||!b.calories||!b.meal||!b.table)return res.status(400).json({error:'MISSING_FIELDS'});if(!pool && !demoMode)return res.status(503).json({error:'DATABASE_NOT_CONFIGURED'});if (!pool) {
    const id = crypto.randomUUID();
    const order = {
      id,
      ...v.reduce((obj, value, index) => obj, {})
    };
    demoOrders.set(id, { payload: b, telegramUser: tgUser, created_at: new Date().toISOString() });
    return res.status(201).json({ ok: true, order: { id, status: 'new', created_at: new Date().toISOString() } });
  }

  const q=`INSERT INTO orders (telegram_user_id,name,surname,phone,recipient_phone,for_who,goal,calories,meal,table_number,latitude,longitude,payment,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'new') RETURNING id,status,created_at`;const v=[tgUser?.id||null,b.name,b.surname||'',b.phone,b.recipientPhone||null,b.forWho,b.goal,b.calories,b.meal,b.table,b.location?.lat||null,b.location?.lon||null,b.payment||'card'];const {rows}=await pool.query(q,v);res.json({ok:true,order:rows[0]})}catch(e){console.error(e);res.status(500).json({error:'SERVER_ERROR'})}});
registerLocationRoutes(app);

const port=process.env.PORT||3000;app.listen(port,()=>{ console.log('Life Food API listening on '+port); startLocationBot(); });