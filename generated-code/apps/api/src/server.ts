import express, { Request, Response } from 'express';
import { someHelperFunction } from './helpers/someHelperFile'; 

const app = express();

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: someHelperFunction(),
  });
});

export default app;
