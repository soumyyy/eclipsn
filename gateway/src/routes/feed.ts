import { Router } from 'express';
import { config } from '../config';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const { userId } = req.session as any;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const response = await fetch(`${config.brainServiceUrl}/api/feed?user_id=${userId}`);
        if (!response.ok) {
            throw new Error(`Brain service error: ${response.statusText}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Feed fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch feed' });
    }
});

router.post('/generate/briefing', async (req, res) => {
    try {
        const { userId } = req.session as any;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const response = await fetch(`${config.brainServiceUrl}/api/feed/generate/briefing?user_id=${userId}`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error(`Brain service error: ${response.statusText}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Trigger briefing error:', error);
        res.status(500).json({ error: 'Failed to generate briefing' });
    }
});

export default router;
