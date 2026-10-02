# Life Food — Telegram Mini App

Frontend + backend skeleton for the Life Food ordering Mini App.

## Frontend
The page now loads the official Telegram Mini App SDK, calls `Telegram.WebApp.ready()` / `expand()`, reads validated server-bound `initData`, and can POST orders to `LIFE_FOOD_API`.

Telegram's documentation says `initDataUnsafe` must not be trusted; the backend should validate `initData` before using user data. See the official docs: https://core.telegram.org/bots/webapps

## Backend
`server/server.js` is an Express API with Telegram initData validation and PostgreSQL order storage.

Setup:
1. Copy `server/.env.example` to `.env`.
2. Set `BOT_TOKEN` from BotFather.
3. Set `DATABASE_URL`.
4. Run `server/schema.sql` in PostgreSQL.
5. Run `npm install` inside `server/`.
6. Start with `npm start`.

The frontend API URL can be configured before loading the app:
`window.LIFE_FOOD_API='https://your-api.example.com'`

## Not yet configured
- Bot token
- PostgreSQL production database
- Click/payment provider credentials
- Hosting/domain/HTTPS
- Admin authentication and admin UI
- Real menu/pricing data

Do not commit real secrets.