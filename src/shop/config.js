// Datos del negocio. Cambiá estos valores para usar la tienda de verdad.
export const CONFIG = {
  name: 'CakeNow!+',
  // Número de WhatsApp en formato internacional, sin "+" ni espacios (ej.: 5491123456789).
  whatsapp: '5491100000000',
  whatsappIsExample: true,
  currency: 'ARS',
  deliveryFee: 2500,
  freeDeliveryFrom: 40000,
  hours: 'Martes a domingo, de 10 a 21 h',
  hoursNote: 'Pedidos para el mismo día hasta las 19 h',
  zone: 'Envíos en el día',
  zoneNote: 'Hasta 5 km del local. Más lejos, consultanos.',
  pickup: 'Retiro en el local',
  pickupNote: 'Av. Siempreviva 742 (dirección de ejemplo)',
  instagram: '@cakenow.plus',
  timeSlots: ['Lo antes posible', '10 a 12 h', '12 a 14 h', '14 a 16 h', '16 a 18 h', '18 a 21 h'],
};

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
export const money = (n) => `$ ${fmt.format(n)}`;
