# LIFE FOOD backend storage

The backend uses Firebase Firestore through the Firebase Admin SDK.

Collections:
- `profiles/{telegramUserId}` — Telegram user profile, registration state, phone and saved location.
- `orders/{orderId}` — Mini App orders.
- `locationRequests/{requestId}` — temporary Telegram location-change requests.

The Vercel backend reads Firebase credentials only from environment variables. Do not commit a service-account JSON file to GitHub.
