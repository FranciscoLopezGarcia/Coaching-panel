import { buildContext } from '../app.js';
import { loadConfig } from '../config.js';
import { refuseOnRemote } from '../db/guard.js';
import { seedDemoData } from './load.js';

const config = loadConfig();
refuseOnRemote(config.dbPath, 'seed (atletas sintéticos)');
await seedDemoData(await buildContext(config), console.log);
console.log(`Listo (${config.dbPath}).`);
