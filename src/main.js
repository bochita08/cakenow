import { JellyApp, FLAVORS } from './jelly-app.js';
import { CONFIG, money } from './shop/config.js';
import { PRODUCTS, CATEGORIES, byId, artSvg, EXTRAS, productForDessert } from './shop/catalog.js';
import { dessertById } from './desserts.js';
import { Cart, orderMessage, whatsappLink, lineKey } from './shop/cart.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const cart = new Cart();
const fmt1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

// ---------- toast ----------
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- theme colours for the 3D scene ----------
function cssColor(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = v.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [0.9, 0.9, 0.9];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function sceneTheme() {
  const bg = cssColor('--bg');
  const dark = bg[0] + bg[1] + bg[2] < 1.2 ? 1 : 0;
  return { bgTop: cssColor('--stage-top'), bgBottom: cssColor('--stage-bottom'), table: cssColor('--table'), plate: cssColor('--plate'), dark };
}

// ---------- accent follows the flavour on the plate ----------
const ACCENT_DARK = { frutilla: '#ff4d7d', limon: '#c9e23a', naranja: '#ff9d45', leche: '#e8c79c' };
// accent for the other desserts: [light theme, dark theme]
const DESSERT_ACCENT = {
  flan: ['#b86e00', '#f2b74a'], rogel: ['#9a5a1c', '#e7b06e'], tiramisu: ['#7a4a26', '#d9a47a'],
  chocotorta: ['#6b3a22', '#d39a74'], cheesecake: ['#c4163f', '#ff5a7e'], lemonpie: ['#8a6d00', '#ffd93a'],
  budin: ['#9a5a1c', '#e7a35a'], marquise: ['#5a2d18', '#d39a74'], brownie: ['#6b3a22', '#e0a77a'],
};
function isDark() {
  return sceneTheme().dark === 1;
}
function applyAccent(key, dessert = 'gelatina') {
  const root = document.documentElement;
  const pair = DESSERT_ACCENT[dessert];
  root.style.setProperty('--accent', pair ? pair[isDark() ? 1 : 0] : isDark() ? ACCENT_DARK[key] : FLAVORS[key].accent);
  root.style.setProperty('--accent-ink', isDark() ? '#1a0d14' : '#ffffff');
}

// ---------- the product on the plate ----------
function renderPlateCard(dessertId, flavor, toppings) {
  const p = productForDessert(dessertId, flavor);
  const extras = toppings.filter((t) => EXTRAS[t]);
  const price = p.price + extras.reduce((sum, t) => sum + EXTRAS[t].price, 0);
  $('#fcName').textContent = p.name;
  $('#fcMeta').textContent = dessertId === 'gelatina' ? `Molde clásico · ${p.meta}` : p.meta;
  const ex = $('#fcExtras');
  ex.hidden = !extras.length;
  ex.textContent = extras.length ? `Con ${extras.map((t) => EXTRAS[t].name).join(' y ')}` : '';
  $('#fcPrice').textContent = money(price);
  $('#fcAdd').dataset.key = lineKey(p.id, extras);
  $('#fcAdd').dataset.label = extras.length ? `${p.name} con ${extras.map((t) => EXTRAS[t].name).join(' y ')}` : p.name;
}

// ---------- menu ----------
let filter = 'todo';
function cardControls(p) {
  const q = cart.qty(p.id);
  if (!q) return `<button class="add" type="button" data-add="${p.id}" aria-label="Agregar ${p.name}">Agregar</button>`;
  return `<span class="stepper" role="group" aria-label="Cantidad de ${p.name}">
      <button type="button" data-dec="${p.id}" aria-label="Quitar uno">−</button>
      <output aria-live="polite">${q}</output>
      <button type="button" data-inc="${p.id}" aria-label="Sumar uno">+</button>
    </span>`;
}
function renderGrid() {
  const list = PRODUCTS.filter((p) => filter === 'todo' || p.cat === filter);
  $('#grid').innerHTML = list
    .map(
      (p) => `<article class="card" data-id="${p.id}">
        <div class="art">${artSvg(p)}</div>
        <div class="body">
          <span class="tag">${CATEGORIES[p.cat]} · ${p.meta}</span>
          <h3>${p.name}</h3>
          <p>${p.desc}</p>
          <div class="foot"><span class="price">${money(p.price)}</span><span class="ctl">${cardControls(p)}</span></div>
        </div>
      </article>`,
    )
    .join('');
}
function refreshCardControls() {
  for (const card of $$('#grid .card')) {
    const p = byId(card.dataset.id);
    const ctl = card.querySelector('.ctl');
    if (!ctl) continue;
    const focusedInside = ctl.contains(document.activeElement);
    const which = document.activeElement?.dataset?.inc ? 'inc' : document.activeElement?.dataset?.dec ? 'dec' : 'add';
    ctl.innerHTML = cardControls(p);
    if (focusedInside) (ctl.querySelector(`[data-${which}]`) || ctl.querySelector('button'))?.focus();
  }
}
function setFilter(f) {
  filter = f;
  for (const c of $$('.chip')) c.setAttribute('aria-pressed', String(c.dataset.filter === f));
  renderGrid();
}

// ---------- cart drawer ----------
function openCart() {
  const d = $('#cart');
  d.classList.add('open');
  d.removeAttribute('inert');
  d.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('open');
  $('#cartBtn').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#cartClose').focus(), 50);
}
function closeCart() {
  const d = $('#cart');
  d.classList.remove('open');
  d.setAttribute('inert', '');
  d.setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('open');
  $('#cartBtn').setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  $('#cartBtn').focus();
}
function formState() {
  return {
    delivery: $('input[name="delivery"]:checked').value,
    name: $('#ck-name').value.trim(),
    address: $('#ck-address').value.trim(),
    time: $('#ck-time').value,
    pay: $('#ck-pay').value,
    notes: $('#ck-notes').value.trim(),
  };
}
function renderCart() {
  $('#cartCount').textContent = String(cart.count);
  const lines = cart.lines;
  const form = formState();
  $('#addressField').hidden = form.delivery !== 'envio';
  if (!lines.length) {
    $('#cartLines').innerHTML = `<div class="empty"><strong>Todavía no elegiste nada</strong>Sumá algo del menú y armamos el pedido acá.</div>`;
    $('#checkout').hidden = true;
    $('#sendWa').setAttribute('aria-disabled', 'true');
    $('#ckError').textContent = '';
    return;
  }
  $('#checkout').hidden = false;
  $('#cartLines').innerHTML = lines
    .map(
      (l) => `<div class="line">
        <div class="thumb">${artSvg(l.product)}</div>
        <div class="name">${l.label}<div class="unit">${money(l.unit)} · ${l.product.meta}</div></div>
        <div class="right">
          <span class="mono">${money(l.total)}</span>
          <span class="stepper" role="group" aria-label="Cantidad de ${l.label}">
            <button type="button" data-dec="${l.key}" aria-label="Quitar uno">−</button>
            <output>${l.qty}</output>
            <button type="button" data-inc="${l.key}" aria-label="Sumar uno">+</button>
          </span>
        </div>
      </div>`,
    )
    .join('');
  const fee = cart.deliveryFee(form.delivery);
  const missing = CONFIG.freeDeliveryFrom - cart.subtotal;
  $('#totals').innerHTML = `
    <div><dt>Subtotal</dt><dd>${money(cart.subtotal)}</dd></div>
    ${form.delivery === 'envio' ? `<div><dt>Envío</dt><dd>${fee === 0 ? 'Sin cargo' : money(fee)}</dd></div>` : ''}
    <div class="grand"><dt>Total</dt><dd>${money(cart.subtotal + fee)}</dd></div>
    ${form.delivery === 'envio' && missing > 0 ? `<p class="free-note">Te faltan ${money(missing)} para el envío sin cargo.</p>` : ''}`;
  updateMessage();
}
function updateMessage() {
  if (!cart.count) return;
  const msg = orderMessage(cart, formState());
  $('#msgPreview').textContent = msg;
  $('#sendWa').href = whatsappLink(msg);
  $('#sendWa').removeAttribute('aria-disabled');
}
function validate() {
  const f = formState();
  if (!cart.count) return 'Sumá al menos un producto.';
  if (!f.name) return 'Escribí tu nombre para que sepamos de quién es el pedido.';
  if (f.delivery === 'envio' && !f.address) return 'Falta la dirección de entrega.';
  return '';
}

function bindShop() {
  renderGrid();
  renderCart();
  cart.onChange(() => {
    renderCart();
    refreshCardControls();
    const b = $('#cartBtn');
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-filter],[data-filter-link]');
    if (!t) return;
    if (t.dataset.add) {
      cart.add(t.dataset.add);
      toast(`${byId(t.dataset.add).name}: agregado al pedido`);
    } else if (t.dataset.inc) cart.add(t.dataset.inc);
    else if (t.dataset.dec) cart.add(t.dataset.dec, -1);
    else if (t.dataset.filter) setFilter(t.dataset.filter);
    else if (t.dataset.filterLink) setFilter(t.dataset.filterLink);
  });

  $('#cartBtn').addEventListener('click', openCart);
  $('#heroCart').addEventListener('click', openCart);
  $('#cartClose').addEventListener('click', closeCart);
  $('#scrim').addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#cart').classList.contains('open')) closeCart();
  });

  $('#ck-time').innerHTML = CONFIG.timeSlots.map((s) => `<option>${s}</option>`).join('');
  $('#checkout').addEventListener('input', () => {
    $('#ckError').textContent = '';
    renderCart();
  });
  $('#checkout').addEventListener('submit', (e) => e.preventDefault());
  $('#sendWa').addEventListener('click', (e) => {
    const err = validate();
    if (err) {
      e.preventDefault();
      $('#ckError').textContent = err;
      return;
    }
    updateMessage();
  });
  $('#copyMsg').addEventListener('click', async () => {
    const text = $('#msgPreview').textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast('Mensaje copiado');
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('#msgPreview'));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      toast('Mensaje seleccionado: copialo con Ctrl+C');
    }
  });
  const num = CONFIG.whatsapp.replace(/^549(\d{2})(\d{4})(\d{4})$/, '+54 9 $1 $2-$3');
  $('#waNumber').textContent = CONFIG.whatsappIsExample ? `${num} (número de prueba)` : num;

  $('#info').innerHTML = `
    <div><dt>Horario</dt><dd>${CONFIG.hours}<span>${CONFIG.hoursNote}</span></dd></div>
    <div><dt>Envíos</dt><dd>${CONFIG.zone}<span>${CONFIG.zoneNote} Envío ${money(CONFIG.deliveryFee)}, sin cargo desde ${money(CONFIG.freeDeliveryFrom)}.</span></dd></div>
    <div><dt>Retiro</dt><dd>${CONFIG.pickup}<span>${CONFIG.pickupNote}</span></dd></div>`;
  $('#footerText').textContent = `${CONFIG.hours} · ${CONFIG.instagram} · Precios y datos de ejemplo`;
}

// ---------- jelly ----------
async function startJelly() {
  const canvas = $('#jellyCanvas');
  const stage = $('#stage');
  let flavor = 'frutilla';
  let dessert = 'gelatina';
  let toppings = [];
  applyAccent(flavor, dessert);
  renderPlateCard(dessert, flavor, toppings);
  $('#fcAdd').addEventListener('click', (e) => {
    cart.add(e.currentTarget.dataset.key);
    toast(`${e.currentTarget.dataset.label}: agregado al pedido`);
  });

  const app = new JellyApp({
    canvas,
    stage,
    onStats: (s) => {
      // the sides on the plate are not portions of the dessert
      $('#rPieces').textContent = String(Math.max(1, s.pieces - toppings.length));
      $('#rVolume').textContent = fmt1.format(Math.min(100, s.volume));
      $('#rEnergy').textContent = s.energy < 10 ? fmt2.format(s.energy) : fmt0.format(s.energy);
      $('#rMass').textContent = fmt0.format(s.mass);
    },
    onEvent: (ev) => {
      if (ev.type === 'fatal') showFallback(ev.reason);
      if (ev.type === 'hint') {
        $('#hint').textContent = ev.text;
        $('#hint').hidden = !ev.text;
      }
      if (ev.type === 'cut' && ev.pieces >= 6 && !startJelly.cutNote) {
        startJelly.cutNote = true;
        toast(`${ev.pieces} porciones. La de verdad viene entera.`);
      }
    },
  });

  // Without WebGPU (or if the GPU gives up) the stage shows the illustration; the shop keeps working.
  const showFallback = (err) => {
    console.warn('3D dessert disabled:', err);
    app.dead = true;
    canvas.hidden = true;
    $('#fallback').hidden = false;
    $('#dock').hidden = true;
    $$('.readout').forEach((r) => (r.hidden = true));
  };
  try {
    await app.start();
  } catch (err) {
    showFallback(err);
    return;
  }

  app.setTheme(sceneTheme());
  const retheme = () => {
    app.setTheme(sceneTheme());
    applyAccent(flavor, dessert);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  for (const b of $$('.tool')) {
    b.addEventListener('click', () => {
      for (const o of $$('.tool')) o.setAttribute('aria-checked', String(o === b));
      app.setTool(b.dataset.tool);
    });
  }
  for (const b of $$('.flavor')) {
    b.addEventListener('click', () => {
      for (const o of $$('.flavor')) o.setAttribute('aria-checked', String(o === b));
      flavor = b.dataset.flavor;
      app.setFlavor(flavor);
      applyAccent(flavor, dessert);
      renderPlateCard(dessert, flavor, toppings);
    });
  }
  const setSliders = (feel) => {
    for (const [id, v] of [['firmness', feel.firmness], ['damping', feel.damping]]) {
      $(`#${id}`).value = String(v);
      $(`#${id}Out`).textContent = fmt2.format(v);
      app.setParam(id, v);
    }
  };
  for (const b of $$('.dessert')) {
    b.addEventListener('click', () => {
      if (b.dataset.dessert === dessert) return;
      for (const o of $$('.dessert')) o.setAttribute('aria-checked', String(o === b));
      dessert = b.dataset.dessert;
      $('#flavorGroup').hidden = dessert !== 'gelatina';
      setSliders(dessertById(dessert).feel);
      app.setDessert(dessert, toppings);
      applyAccent(flavor, dessert);
      renderPlateCard(dessert, flavor, toppings);
    });
  }
  for (const b of $$('.topping')) {
    b.addEventListener('click', () => {
      const t = b.dataset.topping;
      const on = !toppings.includes(t);
      toppings = on ? [...toppings, t] : toppings.filter((x) => x !== t);
      b.setAttribute('aria-pressed', String(on));
      app.setDessert(dessert, toppings);
      renderPlateCard(dessert, flavor, toppings);
    });
  }
  // arrow keys inside each radio group
  for (const group of $$('[role="radiogroup"]')) {
    group.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const items = $$('[role="radio"]', group);
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      next.focus();
      next.click();
    });
  }

  // ---- minimised menu: gets out of the way while you play with the dessert ----
  const stageEl = $('#stage');
  const dockEl = $('#dock');
  const setMin = (min) => {
    stageEl.classList.toggle('is-min', min);
    const t = $('#dockToggle');
    t.setAttribute('aria-expanded', String(!min));
    const label = min ? 'Abrir el menú' : 'Minimizar el menú';
    t.title = label;
    $('#dockToggleLabel').textContent = label;
    if (min) {
      $('#settings').hidden = true;
      $('#settingsBtn').setAttribute('aria-expanded', 'false');
    }
  };
  let idleTimer;
  const scheduleMin = (ms) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!dockEl.matches(':hover') && !dockEl.contains(document.activeElement)) setMin(true);
    }, ms);
  };
  $('#dockToggle').addEventListener('click', () => {
    const min = !stageEl.classList.contains('is-min');
    setMin(min);
    if (!min) scheduleMin(8000);
    else clearTimeout(idleTimer);
  });
  // touching the dessert (any tool) folds the menu away
  canvas.addEventListener('pointerdown', () => {
    clearTimeout(idleTimer);
    setMin(true);
  });
  dockEl.addEventListener('pointerenter', () => clearTimeout(idleTimer));
  dockEl.addEventListener('pointerleave', () => { if (!stageEl.classList.contains('is-min')) scheduleMin(4000); });
  dockEl.addEventListener('focusin', () => clearTimeout(idleTimer));
  // the page opens with the menu folded: the dessert and the plate come first

  const settingsBtn = $('#settingsBtn');
  settingsBtn.addEventListener('click', () => {
    const open = settingsBtn.getAttribute('aria-expanded') !== 'true';
    settingsBtn.setAttribute('aria-expanded', String(open));
    $('#settings').hidden = !open;
  });
  const slider = (id, key) => {
    const el = $(`#${id}`);
    const out = $(`#${id}Out`);
    el.addEventListener('input', () => {
      app.setParam(key, parseFloat(el.value));
      out.textContent = fmt2.format(parseFloat(el.value));
    });
  };
  slider('firmness', 'firmness');
  slider('damping', 'damping');
  $('#slow').addEventListener('change', (e) => app.setParam('timeScale', e.target.checked ? 0.25 : 1));
  $('#showMesh').addEventListener('change', (e) => app.setShowMesh(e.target.checked));
  $('#shakeBtn').addEventListener('click', () => app.shake());
  $('#resetBtn').addEventListener('click', () => app.reset());
}

bindShop();
startJelly();
