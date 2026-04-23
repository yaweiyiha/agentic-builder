import "dotenv/config";
import { createApp } from './app';
import { PORT } from './config/env';
import { initDb } from './db';
import { syncModels } from './models';

const app = createApp();

async function start(): Promise<void> {
  await initDb();
  await syncModels();

  app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
  });
}

void start();
