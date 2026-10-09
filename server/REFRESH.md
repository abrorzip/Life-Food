# Bot menyusini yangilash

`/start` dagi ikki Mini App tugmasi saqlanadi. `🔄 Yangilash` callback tugmasi PIN so‘raydi. Hozirgi vaqtinchalik PIN: `1234` (`BOT_REFRESH_CODE` muhit o‘zgaruvchisi bilan almashtirish mumkin).

Kod to‘g‘ri bo‘lsa, Firestore `profiles` ro‘yxatidagi avval /start bosgan foydalanuvchilarga `Bot yangilandi` xabari, ikkala app havolasi va Yangilash tugmasi yuboriladi. Bu amaliyot kodni deploy qilmaydi; har tasdiqlangan yangilashda menyu qayta yuboriladi. Ro‘yxatdan o‘tishi tugamagan profil ham oluvchilar ro‘yxatiga kiradi. Bloklangan/o‘chirilgan chatdagi xato boshqa oluvchilarni to‘xtatmaydi.

PIN holati profil registratsiyasi holatidan alohida saqlanadi. 5 daqiqada kiritish kerak; 3 noto‘g‘ri urinish 5 daqiqalik blok beradi. `/cancel` bekor qiladi. Bir vaqtning o‘zida bitta broadcast ishlaydi. Oluvchilar 100 tadan sahifalanadi.

Webhook yangi /start xabarida callback_query qabul qilishga moslashtiriladi; mavjud URL va sozlangan webhook siri saqlanadi. Setup endpoint va polling ham callback_query turini qabul qiladi.

## Xavfsizlik

`1234` kuchli yoki admin darajasidagi himoya emas. Uni bilgan har qanday bot foydalanuvchisi ushbu umumiy xabar yuborishni ishga tushira oladi. PIN va foydalanuvchi/admin ruxsatlari production uchun keyin kuchaytirilishi kerak.

## Test

`node server/tests/refresh.test.mjs`

Testlar Telegram va Firestore ni mock qiladi. Haqiqiy xabar yoki ma’lumotlar bazasiga yozuv yubormaydi.
