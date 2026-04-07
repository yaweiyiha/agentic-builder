import cors from 'cors';
import express from 'express';
const app = express();
const port = Number(process.env.PORT ?? 4000);
let settings = {
    workDuration: 25,
    breakDuration: 5,
    soundEnabled: true
};
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});
app.get('/api/user/settings', (_req, res) => {
    res.json(settings);
});
app.post('/api/user/settings', (req, res) => {
    const { workDuration, breakDuration, soundEnabled } = req.body;
    if (typeof workDuration !== 'number' || workDuration < 1) {
        return res.status(400).json({ error: 'workDuration must be a number >= 1' });
    }
    if (typeof breakDuration !== 'number' || breakDuration < 1) {
        return res.status(400).json({ error: 'breakDuration must be a number >= 1' });
    }
    if (typeof soundEnabled !== 'boolean') {
        return res.status(400).json({ error: 'soundEnabled must be a boolean' });
    }
    settings = { workDuration, breakDuration, soundEnabled };
    return res.json(settings);
});
app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
});
