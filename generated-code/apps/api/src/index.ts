import express, { Request, Response } from 'express';
import { NonExistentHelper } from './helpers/nonExistent.js';

const app = express();

app.get('/api/health', (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    service: NonExistentHelper.getServiceName()
  });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on port ${port}`);
});
