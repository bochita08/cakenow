// node tests/knife.test.mjs — a knife stroke at any angle splits the dessert in two
import { JellySim } from '../src/sim.js';
import { composeDessert } from '../src/desserts.js';

let fails = 0;
const sim = new JellySim();
for (const id of ['gelatina', 'flan', 'rogel', 'tiramisu']) {
  const misses = [];
  for (let deg = 0; deg < 180; deg += 7.5) {
    sim.setDessert(composeDessert(id));
    for (let i = 0; i < 40; i++) sim.step();
    const a = (deg * Math.PI) / 180;
    const off = (deg % 30) / 30 - 0.5; // not always through the middle
    sim.cut([0], [off * Math.sin(a), 3, -off * Math.cos(a)], [Math.sin(a), 0, -Math.cos(a)]);
    if (sim.topo.pieces.length < 2) misses.push(deg);
  }
  if (misses.length) fails++;
  console.log(`${misses.length ? 'FAIL' : 'ok  '} ${id.padEnd(9)} ${misses.length ? 'no corta en ' + misses.join('°, ') + '°' : 'corta en los 24 ángulos'}`);
}
process.exit(fails ? 1 : 0);
