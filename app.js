const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('#f6f3ed');
  tg.setBackgroundColor?.('#f6f3ed');
}

const state = {
  i: 0,
  who: '',
  goal: '',
  cal: '',
  meal: '',
  duration: '',
  table: '',
  location: null,
  savedLocation: null,
  pay: 'card',
  profile: null
};

const screens = [...document.querySelectorAll('.screen')];
const title = document.querySelector('#title');
const subtitle = document.querySelector('#subtitle');
const stepLabel = document.querySelector('#stepLabel');
const stepCount = document.querySelector('#stepCount');
const progressBar = document.querySelector('#progressBar');
const next = document.querySelector('#next');
const nextText = next.querySelector('span');
const back = document.querySelector('#back');
const flow = document.querySelector('#flow');
const locBot = document.querySelector('#locBot');
const locCurrent = document.querySelector('#locCurrent');
const locStatus = document.querySelector('#locStatus');
const apiBase = () => (window.LIFE_FOOD_API || '').replace(/\/$/, '');

const steps = [
  ['Kim uchun buyurtma?', 'Siz uchun yoki yaqin insoningiz uchun sog‘lom menyuni tanlang.'],
  ['Maqsadingiz nima?', 'Ratsionni maqsadingizga mos tanlang.'],
  ['Kunlik energiya', 'Kunlik kaloriya miqdorini belgilang.'],
  ['Qanday menyu kerak?', 'Tayyor menyu yoki sizga moslashtirilgan variantni tanlang.'],
  ['Necha kunlik reja?', 'Buyurtma muddatini belgilang.'],
  ['Yetkazib berish', 'Stol raqami va yetkazib berish lokatsiyasini tanlang.'],
  ['Buyurtmani tekshiring', 'Tanlovlaringizni tekshirib, to‘lov usulini belgilang.']
];

const goalText = { loss: 'Vazn tashlash', form: 'Formani saqlash', gain: 'Vazn yig‘ish' };

function setProfileChip() {
  const unsafeUser = tg?.initDataUnsafe?.user;
  if (!unsafeUser) return;
  const displayName = [unsafeUser.first_name, unsafeUser.last_name].filter(Boolean).join(' ') || 'Mijoz';
  const initials = ([unsafeUser.first_name?.[0], unsafeUser.last_name?.[0]].filter(Boolean).join('') || 'LF').toUpperCase();
  document.querySelector('#profileName').textContent = displayName;
  document.querySelector('#avatar').textContent = initials;
}

function render() {
  screens.forEach((screen, index) => screen.classList.toggle('active', index === state.i));
  const [heading, copy] = steps[state.i];
  title.textContent = heading;
  subtitle.textContent = copy;
  stepLabel.textContent = (state.i + 1) + '-bosqich';
  stepCount.textContent = (state.i + 1) + ' / ' + steps.length;
  progressBar.style.width = (((state.i + 1) / steps.length) * 100) + '%';
  back.classList.toggle('hidden', state.i === 0);
  nextText.textContent = state.i === steps.length - 1 ? 'Buyurtmani tasdiqlash' : 'Davom etish';
  if (state.i === 6) summary();
}

function select(selector, key, value) {
  document.querySelectorAll(selector).forEach(el => el.classList.toggle('selected', el.dataset[key] === value));
}

document.querySelectorAll('[data-who]').forEach(el => el.addEventListener('click', () => {
  state.who = el.dataset.who;
  select('[data-who]', 'who', state.who);
  document.querySelector('#recipient').classList.toggle('hidden', state.who !== 'other');
}));

document.querySelectorAll('[data-goal]').forEach(el => el.addEventListener('click', () => {
  state.goal = el.dataset.goal;
  select('[data-goal]', 'goal', state.goal);
}));

document.querySelectorAll('[data-cal]').forEach(el => el.addEventListener('click', () => {
  state.cal = el.dataset.cal;
  select('[data-cal]', 'cal', state.cal);
}));

document.querySelectorAll('[data-meal]').forEach(el => el.addEventListener('click', () => {
  state.meal = el.dataset.meal;
  select('[data-meal]', 'meal', state.meal);
}));

document.querySelectorAll('[data-duration]').forEach(el => el.addEventListener('click', () => {
  state.duration = el.dataset.duration;
  select('[data-duration]', 'duration', state.duration);
}));

document.querySelectorAll('[data-pay]').forEach(el => el.addEventListener('click', () => {
  state.pay = el.dataset.pay;
  select('[data-pay]', 'pay', state.pay);
}));

function setLocation(location, statusText) {
  if (!location) return;
  state.location = {
    lat: Number(location.lat),
    lon: Number(location.lon)
  };
  locStatus.textContent = statusText;
}

locCurrent?.addEventListener('click', () => {
  if (!navigator.geolocation) {
    locStatus.textContent = 'Geolokatsiya mavjud emas.';
    return;
  }
  locStatus.textContent = 'Joriy lokatsiya aniqlanmoqda...';
  navigator.geolocation.getCurrentPosition(
    pos => setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }, '✓ Joriy lokatsiya aniqlandi.'),
    () => { locStatus.textContent = 'Lokatsiyaga ruxsat berilmadi.'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

async function requestLocationChange() {
  const api = apiBase();
  if (!api || !tg?.initData) {
    showError('Lokatsiyani o‘zgartirish uchun backend hali ulanmagan.');
    return;
  }
  locBot.disabled = true;
  locStatus.textContent = 'Botga yo‘naltirilmoqda...';
  try {
    const response = await fetch(api + '/api/location/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramInitData: tg.initData })
    });
    const data = await response.json();
    if (!response.ok || !data.botUrl || !data.requestId) throw new Error('LOCATION_REQUEST_FAILED');
    locStatus.textContent = 'Botda yangi Telegram Location yuboring.';
    startLocationPolling(data.requestId);
    if (tg.openTelegramLink) tg.openTelegramLink(data.botUrl);
    else window.location.href = data.botUrl;
  } catch {
    showError('Lokatsiyani o‘zgartirish uchun botni ochib bo‘lmadi.');
  } finally {
    locBot.disabled = false;
  }
}

locBot?.addEventListener('click', requestLocationChange);

function startLocationPolling(requestId) {
  if (!requestId || !tg?.initData) return;
  if (window.__lifeFoodLocationPoll) clearInterval(window.__lifeFoodLocationPoll);

  const deadline = Date.now() + 5 * 60 * 1000;
  const check = async () => {
    if (Date.now() > deadline) {
      clearInterval(window.__lifeFoodLocationPoll);
      window.__lifeFoodLocationPoll = null;
      return;
    }
    try {
      const api = apiBase();
      if (!api) return;
      const response = await fetch(api + '/api/location/status?requestId=' + encodeURIComponent(requestId), {
        headers: { 'X-Telegram-Init-Data': tg.initData }
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === 'ready' && data.location) {
        setLocation(data.location, '✓ Yangi Telegram lokatsiya qabul qilindi.');
        clearInterval(window.__lifeFoodLocationPoll);
        window.__lifeFoodLocationPoll = null;
        const url = new URL(window.location.href);
        url.searchParams.delete('location_request');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    } catch {}
  };
  check();
  window.__lifeFoodLocationPoll = setInterval(check, 2000);
}

function handleLocationRequestFromUrl() {
  const requestId = new URLSearchParams(window.location.search).get('location_request');
  if (!requestId || !tg?.initData) return;
  locStatus.textContent = 'Yangi lokatsiya qabul qilinmoqda...';
  startLocationPolling(requestId);
}

async function loadProfile() {
  const api = apiBase();
  if (!api || !tg?.initData) return;
  try {
    const response = await fetch(api + '/api/profile', {
      headers: { 'X-Telegram-Init-Data': tg.initData }
    });
    if (!response.ok) return;
    const data = await response.json();
    state.profile = data.profile || null;
    if (state.profile?.location) {
      state.savedLocation = state.profile.location;
      state.location = state.profile.location;
      locStatus.textContent = '✓ Botda saqlangan lokatsiya tayyor.';
    }
  } catch {}
}

function validate() {
  if (state.i === 0) {
    if (!state.who) return 'Kim uchun buyurtma ekanini tanlang.';
    if (state.who === 'other' && !document.querySelector('#recipientPhone')?.value.trim()) {
      return 'Qabul qiluvchining telefon raqamini kiriting.';
    }
  }
  if (state.i === 1 && !state.goal) return 'Maqsadni tanlang.';
  if (state.i === 2 && !state.cal) return 'Kaloriyani tanlang.';
  if (state.i === 3 && !state.meal) return 'Menyu turini tanlang.';
  if (state.i === 4 && !state.duration) return 'Buyurtma necha kunlik ekanini tanlang.';
  if (state.i === 5) {
    state.table = document.querySelector('#table')?.value.trim();
    if (!state.table) return 'Stol raqamini kiriting.';
  }
  if (state.i === 6 && !state.payment) return '';
  return '';
}

function showError(message) {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

function summary() {
  const locationLabel = state.location ? 'Lokatsiya tayyor' : 'Botdan tanlanadi';
  const rows = [
    ['Kim uchun', state.who === 'other' ? 'Boshqaga' : 'O‘zimga'],
    ['Maqsad', goalText[state.goal] || '—'],
    ['Kaloriya', state.cal === 'individual' ? 'Individual' : (state.cal ? state.cal + ' kcal' : '—')],
    ['Menyu', state.meal === 'individual' ? 'Individual' : 'Standart'],
    ['Muddat', state.duration ? state.duration + ' kun' : '—'],
    ['Stol', state.table || '—'],
    ['Lokatsiya', locationLabel]
  ];
  document.querySelector('#summary').innerHTML = rows
    .map(([key, value]) => '<div class="sum"><span>' + key + '</span><b>' + value + '</b></div>')
    .join('');
}

async function submitOrder() {
  const payload = {
    recipientPhone: document.querySelector('#recipientPhone')?.value.trim() || null,
    forWho: state.who,
    goal: state.goal,
    calories: state.cal,
    meal: state.meal,
    durationDays: Number(state.duration),
    table: state.table,
    location: state.location || state.savedLocation || null,
    payment: state.pay,
    telegramInitData: tg?.initData || null
  };

  const api = apiBase();
  if (!api) return;

  const response = await fetch(api + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('ORDER_FAILED');
}

async function continueFlow(event) {
  event?.preventDefault();

  if (state.i === 5) {
    state.table = document.querySelector('#table')?.value.trim();
  }

  const error = validate();
  if (error) {
    showError(error);
    return;
  }

  if (state.i < 6) {
    state.i += 1;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  next.disabled = true;
  try {
    await submitOrder();
    flow.classList.add('hidden');
    document.querySelector('.intro')?.classList.add('hidden');
    document.querySelector('#success')?.classList.remove('hidden');
    tg?.HapticFeedback?.notificationOccurred?.('success');
  } catch {
    showError('Buyurtmani yuborishda xatolik yuz berdi.');
  } finally {
    next.disabled = false;
  }
}

next.addEventListener('click', continueFlow);
flow.addEventListener('submit', continueFlow);

back.addEventListener('click', event => {
  event.preventDefault();
  if (state.i > 0) {
    state.i -= 1;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

setProfileChip();
render();
handleLocationRequestFromUrl();
loadProfile();
