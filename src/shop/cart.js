// Cart state (kept in this browser only) and the WhatsApp order message.

import { CONFIG, money } from './config.js';
import { byId, EXTRAS } from './catalog.js';

// Cart keys: a product id, optionally with toppings: "flan|crema,ddl".
export const lineKey = (id, extras = []) => (extras.length ? `${id}|${[...extras].sort().join(',')}` : id);
const parseKey = (key) => {
  const [id, ex] = key.split('|');
  return { id, extras: ex ? ex.split(',').filter((e) => EXTRAS[e]) : [] };
};

const KEY = 'cakenow.cart.v1';

export class Cart {
  constructor() {
    this.items = new Map(); // id → qty
    this.listeners = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      for (const [key, q] of saved) if (byId(parseKey(key).id) && q > 0) this.items.set(key, Math.min(99, q | 0));
    } catch {
      /* storage blocked or empty: start with an empty order */
    }
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.items]));
    } catch {
      /* not persisted, still works for this visit */
    }
    for (const fn of this.listeners) fn(this);
  }

  qty(id) {
    return this.items.get(id) || 0;
  }

  set(id, q) {
    q = Math.max(0, Math.min(99, q | 0));
    if (q === 0) this.items.delete(id);
    else this.items.set(id, q);
    this.save();
  }

  add(id, n = 1) {
    this.set(id, this.qty(id) + n);
  }

  get count() {
    let c = 0;
    for (const q of this.items.values()) c += q;
    return c;
  }

  get lines() {
    return [...this.items].map(([key, q]) => {
      const { id, extras } = parseKey(key);
      const product = byId(id);
      const unit = product.price + extras.reduce((s, e) => s + EXTRAS[e].price, 0);
      const label = extras.length ? `${product.name} con ${extras.map((e) => EXTRAS[e].name).join(' y ')}` : product.name;
      return { key, product, extras, label, unit, qty: q, total: unit * q };
    });
  }

  get subtotal() {
    return this.lines.reduce((s, l) => s + l.total, 0);
  }

  deliveryFee(mode) {
    if (mode !== 'envio' || this.subtotal === 0) return 0;
    return this.subtotal >= CONFIG.freeDeliveryFrom ? 0 : CONFIG.deliveryFee;
  }
}

export function orderMessage(cart, form) {
  const lines = cart.lines.map((l) => `• ${l.qty} × ${l.label} (${l.product.meta}) — ${money(l.total)}`);
  const fee = cart.deliveryFee(form.delivery);
  const out = [
    `Hola ${CONFIG.name}, quiero hacer un pedido:`,
    '',
    ...lines,
    '',
    `Subtotal: ${money(cart.subtotal)}`,
  ];
  if (form.delivery === 'envio') out.push(`Envío: ${fee === 0 ? 'sin cargo' : money(fee)}`);
  out.push(`Total: ${money(cart.subtotal + fee)}`, '');
  out.push(`Nombre: ${form.name || '—'}`);
  out.push(form.delivery === 'envio' ? `Entrega: envío a ${form.address || '—'}` : `Entrega: retiro en el local`);
  out.push(`Horario: ${form.time}`);
  out.push(`Pago: ${form.pay}`);
  if (form.notes) out.push(`Comentarios: ${form.notes}`);
  return out.join('\n');
}

export function whatsappLink(message) {
  return `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(message)}`;
}
