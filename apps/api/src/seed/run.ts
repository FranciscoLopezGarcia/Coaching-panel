import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { seedDemoData } from './load.js';

const config = loadConfig();
await seedDemoData(await buildContext(config), console.log);
console.log(`Listo (${config.dbPath}).`);
