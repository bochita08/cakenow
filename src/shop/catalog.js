// Productos de ejemplo. Precios en pesos argentinos; editá libremente.
// `art` elige el dibujo de la tarjeta (se puede reemplazar por una foto: ver `image`).

export const CATEGORIES = { postres: 'Postres', comida: 'Comida', bebidas: 'Bebidas' };

export const PRODUCTS = [
  { id: 'gel-frutilla', cat: 'postres', name: 'Gelatina de frutilla', desc: 'Molde clásico de tres pisos, bien temblona.', meta: '6 porciones', price: 9800, art: ['jelly', '#e3123d', '#a80d33'], flavor: 'frutilla', dessert: 'gelatina' },
  { id: 'gel-limon', cat: 'postres', name: 'Gelatina de limón', desc: 'Ácida y fresca, con ralladura de limón.', meta: '6 porciones', price: 9800, art: ['jelly', '#c9dd2e', '#8ea300'], flavor: 'limon', dessert: 'gelatina' },
  { id: 'gel-naranja', cat: 'postres', name: 'Gelatina de naranja', desc: 'Con jugo de naranja exprimido en el día.', meta: '6 porciones', price: 9800, art: ['jelly', '#ff8a1c', '#c85f00'], flavor: 'naranja', dessert: 'gelatina' },
  { id: 'gel-leche', cat: 'postres', name: 'Gelatina de leche y vainilla', desc: 'Cremosa, con chaucha de vainilla.', meta: '6 porciones', price: 11500, art: ['jelly', '#f3ece0', '#d7c9b0'], flavor: 'leche', dessert: 'gelatina' },
  { id: 'flan', cat: 'postres', name: 'Flan casero', desc: 'Con caramelo. Sumale dulce de leche y crema.', meta: 'Entero · 6 porciones', price: 8900, art: ['flan'], dessert: 'flan' },
  { id: 'rogel', cat: 'postres', name: 'Rogel', desc: 'Capas finitas y crocantes con dulce de leche y merengue italiano.', meta: 'Entero · 10 porciones', price: 21500, art: ['rogel'], dessert: 'rogel' },
  { id: 'tiramisu', cat: 'postres', name: 'Tiramisú', desc: 'Vainillas con café, mascarpone y cacao amargo.', meta: 'Fuente · 8 porciones', price: 18900, art: ['tiramisu'], dessert: 'tiramisu' },
  { id: 'chocotorta', cat: 'postres', name: 'Chocotorta', desc: 'Chocolinas, dulce de leche y queso crema.', meta: 'Entera · 10 porciones', price: 17800, art: ['layers', '#4a2a1e', '#e9d7b8'], dessert: 'chocotorta' },
  { id: 'cheesecake', cat: 'postres', name: 'Cheesecake de frutos rojos', desc: 'Base crocante y coulis de frambuesa.', meta: 'Entero · 10 porciones', price: 22400, art: ['cheesecake'], dessert: 'cheesecake' },
  { id: 'lemon-pie', cat: 'postres', name: 'Lemon pie', desc: 'Masa sablée, crema de limón y merengue tostado.', meta: 'Entero · 8 porciones', price: 19500, art: ['lemonpie'], dessert: 'lemonpie' },
  { id: 'budin', cat: 'postres', name: 'Budín de pan', desc: 'Con pasas y caramelo, de los de antes.', meta: 'Entero · 8 porciones', price: 12600, art: ['budin'], dessert: 'budin' },
  { id: 'marquise', cat: 'postres', name: 'Marquise de chocolate', desc: 'Chocolate semiamargo, denso y húmedo.', meta: 'Barra · 8 porciones', price: 19800, art: ['marquise'], dessert: 'marquise' },
  { id: 'brownie-helado', cat: 'postres', name: 'Brownie con helado', desc: 'Brownie tibio con una bocha de helado de vainilla.', meta: 'Individual', price: 6400, art: ['brownieHelado'], dessert: 'brownie' },
  { id: 'alfajores', cat: 'postres', name: 'Alfajores de maicena', desc: 'Con dulce de leche y coco rallado.', meta: 'Caja de 6', price: 6900, art: ['alfajor'] },
  { id: 'brownie', cat: 'postres', name: 'Brownie con nueces', desc: 'Húmedo por dentro, costrita arriba.', meta: 'Unidad', price: 3800, art: ['brownie'] },
  { id: 'empanadas', cat: 'comida', name: 'Empanadas de carne', desc: 'Cortada a cuchillo, al horno de barro.', meta: 'Media docena', price: 10800, art: ['empanada'] },
  { id: 'tarta', cat: 'comida', name: 'Tarta de jamón y queso', desc: 'Masa casera y huevo de campo.', meta: 'Entera · 8 porciones', price: 14500, art: ['tarta'] },
  { id: 'miga', cat: 'comida', name: 'Sándwiches de miga', desc: 'Jamón y queso, y lechuga y tomate.', meta: 'Docena', price: 13200, art: ['miga'] },
  { id: 'tostado', cat: 'comida', name: 'Tostado de jamón y queso', desc: 'En pan árabe, bien crocante.', meta: 'Unidad', price: 5200, art: ['tostado'] },
  { id: 'bowl', cat: 'comida', name: 'Bowl de quinoa', desc: 'Quinoa, palta, garbanzos y vegetales asados.', meta: 'Individual', price: 8900, art: ['bowl'] },
  { id: 'limonada', cat: 'bebidas', name: 'Limonada con menta', desc: 'Con jengibre, apenas dulce.', meta: '1 litro', price: 4800, art: ['glass', '#f2f0a8', '#7cc46a'] },
  { id: 'cafe', cat: 'bebidas', name: 'Café con leche y medialuna', desc: 'Para la merienda, recién horneada.', meta: 'Combo', price: 3900, art: ['cafe'] },
  { id: 'licuado', cat: 'bebidas', name: 'Licuado de banana', desc: 'Con leche o agua, sin azúcar agregada.', meta: '500 ml', price: 3500, art: ['glass', '#f5e7a6', '#f5e7a6'] },
];

export const byId = (id) => PRODUCTS.find((p) => p.id === id);

// Toppings you can add to any dessert (price per unit ordered).
export const EXTRAS = {
  ddl: { name: 'dulce de leche', price: 1500 },
  crema: { name: 'crema', price: 1200 },
};

export function productForDessert(dessertId, flavor) {
  if (dessertId === 'gelatina') return PRODUCTS.find((p) => p.flavor === flavor);
  return PRODUCTS.find((p) => p.dessert === dessertId);
}

const shadow = '<ellipse cx="60" cy="80" rx="44" ry="6" fill="#000" opacity=".1"/>';
const plate = '<ellipse cx="60" cy="74" rx="48" ry="10" fill="#fbfaf8" stroke="#000" stroke-opacity=".08"/>';

const ART = {
  jelly: (c, d) => `${shadow}${plate}
    <path d="M22 72c-1-12 1-20 5-24h66c4 4 6 12 5 24z" fill="${c}"/>
    <path d="M32 48c0-9 3-14 6-16h44c3 2 6 7 6 16z" fill="${d}"/>
    <path d="M42 32c0-12 8-20 18-20s18 8 18 20z" fill="${c}"/>
    <path d="M34 52v18M47 50v21M60 50v21M73 50v21M86 52v18" stroke="${d}" stroke-width="3" opacity=".45" stroke-linecap="round"/>
    <ellipse cx="52" cy="21" rx="6" ry="3.4" fill="#fff" opacity=".6"/>`,
  flan: () => `${shadow}${plate}
    <path d="M30 70 36 34h48l6 36z" fill="#f4c35b"/>
    <path d="M36 34h48c0 6-6 9-10 9-3 4-6 5-9 2-3 4-8 4-10 0-5 3-11 1-12-2-5 0-7-4-7-9z" fill="#8a3d10"/>
    <path d="M30 70c4 3 56 3 60 0" stroke="#8a3d10" stroke-width="3" fill="none" opacity=".5"/>
    <circle cx="74" cy="28" r="7" fill="#fff8ec"/><circle cx="68" cy="26" r="5" fill="#fff8ec"/>`,
  layers: (c, d) => `${shadow}${plate}
    <path d="M20 70V40l70-14 10 4v40z" fill="${c}"/>
    <path d="M20 40l70-14 10 4-70 14z" fill="#2c1810"/>
    <path d="M20 47l80-10M20 55l80-10M20 63l80-10" stroke="${d}" stroke-width="4"/>
    <circle cx="44" cy="35" r="2" fill="${d}"/><circle cx="62" cy="31" r="2" fill="${d}"/><circle cx="78" cy="29" r="2" fill="${d}"/>`,
  cheesecake: () => `${shadow}${plate}
    <path d="M18 70V44l72-16 12 6v36z" fill="#f6ead2"/>
    <path d="M18 64h84v6H18z" fill="#c98b4a"/>
    <path d="M18 44l72-16 12 6-72 16z" fill="#c4163f"/>
    <path d="M30 50c2 6-2 10 0 14M56 44c2 6-2 9 0 12" stroke="#c4163f" stroke-width="4" stroke-linecap="round" fill="none"/>
    <circle cx="58" cy="33" r="4" fill="#7a0a26"/><circle cx="72" cy="31" r="4" fill="#4b1d5e"/>`,
  lemonpie: () => `${shadow}${plate}
    <path d="M18 70V50l76-14 8 4v30z" fill="#ffe34d"/>
    <path d="M18 64h84v6H18z" fill="#d79a52"/>
    <path d="M16 50c6-14 12-4 18-12 6-9 12 2 18-8 6-8 12 3 18-6 6-8 12 2 18-4 4 2 8 4 14 10L18 52z" fill="#fff6e6"/>
    <path d="M36 38c4-4 8-2 10-6M70 30c4-2 7 0 9-3" stroke="#d79a52" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  alfajor: () => `${shadow}
    <ellipse cx="60" cy="60" rx="34" ry="12" fill="#f0d9a5"/>
    <rect x="26" y="50" width="68" height="10" fill="#a55d1d"/>
    <ellipse cx="60" cy="50" rx="34" ry="12" fill="#f5e3b9"/>
    <rect x="26" y="40" width="68" height="10" fill="#f5e3b9"/>
    <ellipse cx="60" cy="40" rx="34" ry="12" fill="#fbf0d6"/>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${30 + ((i * 37) % 60)}" cy="${51 + ((i * 3) % 7) - 1}" r="1.6" fill="#fff"/>`).join('')}`,
  brownie: () => `${shadow}${plate}
    <path d="M26 70V42l14-10h56v30L82 70z" fill="#3b2015"/>
    <path d="M26 42l14-10h56L82 42z" fill="#5a3322"/>
    <path d="M82 42v28M82 42l14-10" stroke="#2a150d" stroke-width="2"/>
    <ellipse cx="50" cy="37" rx="5" ry="3" fill="#c9a26b"/><ellipse cx="68" cy="36" rx="4" ry="2.6" fill="#c9a26b"/>`,
  empanada: () => `${shadow}${plate}
    <path d="M18 66c0-24 20-38 42-38s42 14 42 38z" fill="#e3a94f"/>
    <path d="M18 66h84" stroke="#b97522" stroke-width="5" stroke-linecap="round"/>
    ${Array.from({ length: 10 }, (_, i) => `<path d="M${22 + i * 8.4} 66l4-5" stroke="#b97522" stroke-width="3" stroke-linecap="round"/>`).join('')}
    <ellipse cx="50" cy="42" rx="10" ry="4" fill="#fff" opacity=".35"/>`,
  tarta: () => `${shadow}
    <ellipse cx="60" cy="58" rx="48" ry="20" fill="#d79a52"/>
    <ellipse cx="60" cy="54" rx="44" ry="17" fill="#f6d36b"/>
    <path d="M24 50c10 4 20-6 30 0s20-4 30 0 14-2 18 2" stroke="#f9a8b8" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M30 60c8-4 16 4 24 0s16 4 24 0 12 2 16 0" stroke="#fff3c4" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  miga: () => `${shadow}${plate}
    <path d="M22 70 46 30l24 40z" fill="#fbf2df"/><path d="M22 70h48" stroke="#f7c6c6" stroke-width="5"/>
    <path d="M50 70 74 34l24 36z" fill="#fff7e8"/><path d="M50 70h48" stroke="#8ccf6a" stroke-width="5"/>
    <path d="M24 64h44M52 64h44" stroke="#f3e7c9" stroke-width="2"/>`,
  tostado: () => `${shadow}${plate}
    <path d="M24 66c0-16 16-30 36-30s36 14 36 30z" fill="#d6a15d"/>
    <path d="M24 66h72" stroke="#ffd257" stroke-width="5" stroke-linecap="round"/>
    <path d="M36 48l8-6M52 44l8-6M68 46l8-6" stroke="#8a5523" stroke-width="3" stroke-linecap="round"/>`,
  bowl: () => `${shadow}
    <path d="M18 48h84c-2 18-18 30-42 30S20 66 18 48z" fill="#efe7da"/>
    <ellipse cx="60" cy="48" rx="42" ry="10" fill="#e8d9b5"/>
    <circle cx="44" cy="45" r="7" fill="#7fb24a"/><circle cx="64" cy="44" r="6" fill="#e8743b"/>
    <circle cx="78" cy="47" r="5" fill="#f3d36b"/><path d="M50 48c4-6 12-6 16 0" fill="#5f8f33"/>
    <circle cx="56" cy="50" r="2.4" fill="#d9b56b"/><circle cx="70" cy="51" r="2.4" fill="#d9b56b"/>`,
  rogel: () => `${shadow}${plate}
    <path d="M24 70V40h72v30z" fill="#e3b56a"/>
    ${Array.from({ length: 6 }, (_, i) => `<path d="M24 ${44 + i * 4.4}h72" stroke="#8b4a1c" stroke-width="2"/>`).join('')}
    <path d="M22 41c4-9 9-3 13-9s9 3 13-6 10 4 14-4 9 2 13-5 9 5 13 2 4 9 4 9z" fill="#fbf4e8"/>
    <path d="M44 27c3-3 6-1 8-4M70 25c3-2 5 0 7-3" stroke="#d9a464" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  tiramisu: () => `${shadow}${plate}
    <path d="M22 70V36h76v34z" fill="#b07a45"/>
    <path d="M22 46h76v8H22zM22 62h76v4H22z" fill="#f6ecd6"/>
    <path d="M22 36h76v4H22z" fill="#5a3220"/>
    ${Array.from({ length: 10 }, (_, i) => `<circle cx="${27 + i * 7.4}" cy="${37.5 + (i % 2)}" r="1" fill="#2c180e"/>`).join('')}`,
  budin: () => `${shadow}${plate}
    <path d="M20 70V46c0-6 4-10 10-11 20-4 40-4 60 0 6 1 10 5 10 11v24z" fill="#b8783a"/>
    <path d="M20 46c0-6 4-10 10-11 20-4 40-4 60 0 6 1 10 5 10 11v3H20z" fill="#8a3a0c"/>
    <circle cx="38" cy="58" r="2.2" fill="#5b2c12"/><circle cx="62" cy="62" r="2" fill="#5b2c12"/><circle cx="78" cy="55" r="2.2" fill="#5b2c12"/>`,
  marquise: () => `${shadow}${plate}
    <path d="M22 70V44l12-8h66v26l-12 8z" fill="#2e170e"/>
    <path d="M22 44l12-8h66l-12 8z" fill="#4a2618"/>
    <path d="M88 44v26M88 44l12-8" stroke="#1c0d07" stroke-width="2"/>
    <path d="M40 40l26-0.5" stroke="#6b3a22" stroke-width="2" stroke-linecap="round"/>`,
  brownieHelado: () => `${shadow}${plate}
    <path d="M28 70V50l10-7h48v20l-10 7z" fill="#3b2015"/>
    <path d="M28 50l10-7h48l-10 7z" fill="#5a3322"/>
    <circle cx="58" cy="36" r="15" fill="#fbf1d8"/>
    <path d="M44 42c4 4 8 2 12 5s10 0 16-4" stroke="#efe0bd" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M52 27c3-2 6-2 8 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`,
  glass: (c, g) => `${shadow}
    <path d="M40 18h40l-6 60H46z" fill="${c}" opacity=".95"/>
    <path d="M40 18h40l-1 8H41z" fill="#fff" opacity=".55"/>
    <path d="M70 10 62 40" stroke="#e85a7a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="52" cy="30" r="4" fill="${g}"/><circle cx="66" cy="44" r="3" fill="#fff" opacity=".5"/>`,
  cafe: () => `${shadow}
    <ellipse cx="42" cy="72" rx="26" ry="6" fill="#fbfaf8" stroke="#000" stroke-opacity=".08"/>
    <path d="M24 40h36l-4 30H28z" fill="#fbfaf8" stroke="#000" stroke-opacity=".1"/>
    <path d="M60 46c8 0 8 12 0 12" stroke="#e7e2dc" stroke-width="4" fill="none"/>
    <ellipse cx="42" cy="40" rx="18" ry="4" fill="#b98557"/>
    <path d="M74 66c0-10 8-18 18-18s16 8 16 16c-4-4-8-4-10 0-3-5-9-5-12 0-4-3-8-2-12 2z" fill="#e7a24a"/>
    <path d="M80 56c4-2 8-2 12 0" stroke="#c47b24" stroke-width="2" fill="none"/>`,
};

export function artSvg(product) {
  const [kind, a, b] = product.art;
  return `<svg viewBox="0 0 120 90" aria-hidden="true">${ART[kind](a, b)}</svg>`;
}
