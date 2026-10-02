const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#1f7a4d');
  tg.setBackgroundColor?.('#fbfaf7');
}

const state = {
  i: 0,
  who: '',
  goal: '',
  cal: '',
  meal: '',
  table: '',
  location: null,
  pay: 'card'
};

const screens = [...document.querySelectorAll('.screen')];
const title = document.querySelector('#title');
const sub = document.querySelector('#subtitle');
const step = document.querySelector('#step');
const next = document.querySelector('#next');
const back = document.querySelector('#back');
const flow = document.querySelector('#flow');
const locBot = document.querySelector('#locBot');
const locStatus = document.querySelector('#locStatus');

const titles = [
  'Xush kelibsiz!',
  'Kim uchun?',
  'Maqsadingiz nima?',
  'Kunlik kaloriya',
  'Ovqatlanish turi',
  'Yetkazib berish',
  'Buyurtmangiz'
];

const subs = [
  'Siz uchun qulay va foydali ovqatlanish rejasini tanlang.',
  'Buyurtma kim uchun ekanini belgilang.',
  'Maqsadingizga mos variantni tanlang.',
  'Kunlik kaloriya miqdorini tanlang.',
  'Ovqatlanish turini tanlang.',
  'Stol raqami va joylashuvni kiriting.',
  'Buyurtma ma’lumotlarini tekshiring.'
];

function render() {
  screens.forEach((screen, index) => {
    screen.classList.toggle('active', index === state.i);
  });

  title.textContent = titles[state.i] || 'Buyurtma';
  sub.textContent = subs[state.i] || '';
  step.textContent = (state.i + 1) + ' / 7';

  back.classList.toggle('hidden', state.i === 0);
  next.textContent = state.i === 6 ? 'Buyurtma berish' : 'Davom etish';

  if (state.i === 6) summary();
}

function select(selector, key, value) {
  document.querySelectorAll(selector).forEach(el => {
    el.classList.toggle('selected', el.dataset[key] === value);
  });
}

document.querySelectorAll('[data-who]').forEach(el => {
  el.addEventListener('click', () => {
    state.who = el.dataset.who;
    select('[data-who]', 'who', state.who);
    document.querySelector('#recipient').classList.toggle('hidden', state.who !== 'other');
  });
});

document.querySelectorAll('[data-goal]').forEach(el => {
  el.addEventListener('click', () => {
    state.goal = el.dataset.goal;
    select('[data-goal]', 'goal', state.goal);
  });
});

document.querySelectorAll('[data-cal]').forEach(el => {
  el.addEventListener('click', () => {
    state.cal = el.dataset.cal;
    select('[data-cal]', 'cal', state.cal);
  });
});

document.querySelectorAll('[data-meal]').forEach(el => {
  el.addEventListener('click', () => {
    state.meal = el.dataset.meal;
    select('[data-meal]', 'meal', state.meal);
  });
});

document.querySelectorAll('[data-pay]').forEach(el => {
  el.addEventListener('click', () => {
    state.pay = el.dataset.pay;
    select('[data-pay]', 'pay', state.pay);
  });
});

document.querySelector('#loc')?.addEventListener('click', () => {
  const status = document.querySelector('#locStatus');

  if (!navigator.geolocation) {
    status.textContent = 'Geolokatsiya mavjud emas.';
    return;
  }

  status.textContent = 'Aniqlanmoqda...';

  navigator.geolocation.getCurrentPosition(
    pos => {
      state.location = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude
      };
      status.textContent = '✓ Joylashuv aniqlandi';
    },
    () => {
      status.textContent = 'Joylashuvga ruxsat berilmadi.';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});


function getApiBase() {
  return (window.LIFE_FOOD_API || '').replace(/\/$/, '');
}

function startLocationPolling(requestId) {
  if (!requestId || !tg?.initData) return;

  if (window.__lifeFoodLocationPoll) {
    clearInterval(window.__lifeFoodLocationPoll);
  }

  const deadline = Date.now() + 5 * 60 * 1000;

  const check = async () => {
    if (Date.now() > deadline) {
      clearInterval(window.__lifeFoodLocationPoll);
      window.__lifeFoodLocationPoll = null;
      return;
    }

    try {
      const api = getApiBase();
      if (!api) return;

      const response = await fetch(
        api + '/api/location/status?requestId=' + encodeURIComponent(requestId),
        { headers: { 'X-Telegram-Init-Data': tg.initData } }
      );

      if (!response.ok) return;

      const data = await response.json();

      if (data.status === 'ready' && data.location) {
        state.location = {
          lat: Number(data.location.lat),
          lon: Number(data.location.lon)
        };
        if (locStatus) locStatus.textContent = '✓ Yangi joylashuv qabul qilindi';

        clearInterval(window.__lifeFoodLocationPoll);
        window.__lifeFoodLocationPoll = null;

        const url = new URL(window.location.href);
        url.searchParams.delete('location_request');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    } catch {
      // Best-effort polling; user can retry from the button.
    }
  };

  check();
  window.__lifeFoodLocationPoll = setInterval(check, 2000);
}

locBot?.addEventListener('click', async () => {
  const api = getApiBase();

  if (!api || !tg?.initData) {
    showError('Bot orqali lokatsiyani o‘zgartirish uchun Mini App server API bilan ulangan bo‘lishi kerak.');
    return;
  }

  locBot.disabled = true;
  if (locStatus) locStatus.textContent = 'Bot ochilmoqda...';

  try {
    const response = await fetch(api + '/api/location/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramInitData: tg.initData })
    });

    const data = await response.json();

    if (!response.ok || !data.botUrl || !data.requestId) {
      throw new Error('LOCATION_REQUEST_FAILED');
    }

    if (locStatus) locStatus.textContent = 'Botda yangi lokatsiyani yuboring.';
    startLocationPolling(data.requestId);

    if (tg.openTelegramLink) tg.openTelegramLink(data.botUrl);
    else window.location.href = data.botUrl;
  } catch {
    showError('Lokatsiya o‘zgartirish uchun botni ochib bo‘lmadi.');
  } finally {
    locBot.disabled = false;
  }
});

function handleLocationRequestFromUrl() {
  const requestId = new URLSearchParams(window.location.search).get('location_request');
  if (!requestId || !tg?.initData) return;

  if (locStatus) locStatus.textContent = 'Yangi lokatsiya qabul qilinmoqda...';
  startLocationPolling(requestId);
}

function validate() {
  if (state.i === 0) {
    const name = document.querySelector('#name')?.value.trim();
    const surname = document.querySelector('#surname')?.value.trim();
    const phone = document.querySelector('#phone')?.value.trim();

    if (!name || !surname || !phone) {
      return 'Ism, familiya va telefon raqamingizni kiriting.';
    }
  }

  if (state.i === 1 && !state.who) return 'Kim uchun buyurtma ekanini tanlang.';

  if (state.i === 1 && state.who === 'other') {
    const recipient = document.querySelector('#recipientPhone')?.value.trim();
    if (!recipient) return 'Qabul qiluvchining telefon raqamini kiriting.';
  }

  if (state.i === 2 && !state.goal) return 'Maqsadni tanlang.';
  if (state.i === 3 && !state.cal) return 'Kaloriyani tanlang.';
  if (state.i === 4 && !state.meal) return 'Ovqatlanish turini tanlang.';

  if (state.i === 5) {
    state.table = document.querySelector('#table')?.value.trim();
    if (!state.table) return 'Stol raqamini kiriting.';
  }

  return '';
}

function showError(message) {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

function summary() {
  const goalText = {
    loss: 'Vazn tashlash',
    form: 'Formani saqlash',
    gain: 'Vazn yig‘ish'
  };

  const html = [
    ['Mijoz', `${document.querySelector('#name')?.value || ''} ${document.querySelector('#surname')?.value || ''}`],
    ['Telefon', document.querySelector('#phone')?.value || ''],
    ['Kim uchun', state.who === 'other' ? 'Boshqaga' : 'O‘zimga'],
    ['Maqsad', goalText[state.goal] || ''],
    ['Kaloriya', state.cal === 'individual' ? 'Individual' : (state.cal ? state.cal + ' kcal' : '')],
    ['Menyu', state.meal === 'individual' ? 'Individual' : 'Standart'],
    ['Stol', state.table || ''],
    ['Lokatsiya', state.location ? 'Aniqlandi' : 'Tanlanmagan']
  ];

  document.querySelector('#summary').innerHTML = html
    .map(([key, value]) => `<div class="sum"><span>${key}</span><b>${value}</b></div>`)
    .join('');
}

async function submitOrder() {
  const payload = {
    name: document.querySelector('#name')?.value.trim(),
    surname: document.querySelector('#surname')?.value.trim(),
    phone: document.querySelector('#phone')?.value.trim(),
    recipientPhone: document.querySelector('#recipientPhone')?.value.trim() || null,
    forWho: state.who,
    goal: state.goal,
    calories: state.cal,
    meal: state.meal,
    table: state.table,
    location: state.location,
    payment: state.pay,
    telegramInitData: tg?.initData || null
  };

  const api = window.LIFE_FOOD_API || '';

  if (api) {
    const response = await fetch(api.replace(/\/$/, '') + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error('ORDER_FAILED');
  }
}

async function continueFlow(event) {
  if (event) event.preventDefault();

  const error = validate();
  if (error) {
    showError(error);
    return false;
  }

  if (state.i < 6) {
    state.i += 1;
    render();
handleLocationRequestFromUrl();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return false;
  }

  next.disabled = true;

  try {
    await submitOrder();

    flow.classList.add('hidden');
    document.querySelector('.hero')?.classList.add('hidden');
    document.querySelector('#success')?.classList.remove('hidden');

    tg?.HapticFeedback?.notificationOccurred?.('success');
  } catch (error) {
    showError('Buyurtmani yuborishda xatolik yuz berdi.');
  } finally {
    next.disabled = false;
  }

  return false;
}

next.addEventListener('click', continueFlow);
flow.addEventListener('submit', continueFlow);

back.addEventListener('click', event => {
  event.preventDefault();
  if (state.i > 0) {
    state.i -= 1;
    render();
  }
});

render();
