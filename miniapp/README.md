# Lifefood — yangi interfeys

O‘zbekcha, mobilga mos interaktiv frontend prototipi.

## Ko‘rish

Repozitoriy ildizida `python3 -m http.server 8080` buyrug‘ini bajaring. Brauzerda `http://localhost:8080/miniapp/` manzilini oching. Build yoki npm paketlari talab qilinmaydi.

Vercel konfiguratsiyasiga `/miniapp/` uchun statik fayllar qo‘shilgan. Mavjud API, admin yo‘llari va eski frontend saqlangan. GitHub Pages orqali ham `miniapp/` papkasi ochiladi. Ushbu branch productionga avtomatik birlashtirilmaydi.

## Fayllar

- `index.html`: sahifa va navigatsiya
- `styles.css`: responsive yorug‘ dizayn
- `app.js`: qidiruv, kategoriyalar, 450 kkalgacha filtr, sevimlilar, taom tafsiloti, savat va demo checkout
- `assets/`: AI yordamida yaratilgan taom rasmlarining siqilgan WebP nusxalari

## Muhim cheklovlar

Bu ishlaydigan frontend demo. Buyurtma yuborilmaydi, haqiqiy to‘lov olinmaydi. Telegram autentifikatsiyasi, mavjud bot/API, profil bazasi va to‘lov tizimi yangi interfeysga ulanmagan. Savat, manzil va sevimlilar sahifa yopilganda yo‘qoladi. Narxlar va oziqaviy qiymatlar namunaviy.

Mavjud backend boshqa buyurtma shakliga mo‘ljallangan, shu sababli demo checkout unga so‘rov yubormaydi. Jonli savat uchun API shartnomasi, serverda narxlarni tekshirish va Telegram initData autentifikatsiyasi alohida ulanishi kerak. Botning production Mini App URL manzili bu PR bilan o‘zgartirilmaydi.

## Tekshiruv

390 px mobil va desktop ko‘rinish tekshirilgan. Qidiruv, filtr, sevimlilar, taom tafsiloti, savat, checkout, manzil va Escape tugmasi prototipda sinovdan o‘tgan. Vercel production deploy hali bajarilmagan.
