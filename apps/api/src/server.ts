import { buildApp, buildContext } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(buildContext(config), { logger: true });
await app.listen({ port: config.port, host: config.host });
