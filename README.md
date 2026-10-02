# LIFE FOOD — Telegram Mini App

## Product flow

The Mini App is now **order-only**. Registration is handled by the Telegram bot.

### Bot registration
/start → name → surname → contact → location → "🍱 Buyurtma berish"

### Mini App order
1. Kim uchun
2. Maqsad
3. Kaloriya
4. Menyu
5. Necha kun
6. Yetkazib berish
7. Tekshirish + to‘lov

The Mini App does not ask the customer to repeat name, surname, or phone.

## Location change

From the delivery step:
- current browser GPS can be used;
- **Lokatsiyani o‘zgartirish** opens the bot;
- the bot requests a native Telegram Location;
- the location is linked to a short-lived request;
- the Mini App polls the request and updates the order location.

## Demo mode

Set DEMO_MODE=true and leave DATABASE_URL empty. Orders and bot profiles are then kept in server memory.

## Server environment

```env
BOT_TOKEN=YOUR_BOT_TOKEN
MINI_APP_URL=https://abrorzip.github.io/Life-Food/
BOT_POLLING=true
DEMO_MODE=true
```

The frontend must point `config.js` to the deployed API:
```js
window.LIFE_FOOD_API = 'https://your-api.example.com';
```

Never place BOT_TOKEN or database credentials in the frontend.

## Production

Move profiles/orders from memory to PostgreSQL, then add Click/card payment credentials and the admin panel.
