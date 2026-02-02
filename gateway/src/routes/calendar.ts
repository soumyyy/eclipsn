import { Router } from 'express';
import { fetchAllCalendarEvents } from '../services/calendarClient';

const router = Router();

router.get('/events', async (req, res) => {
    const userId = (req.session as any).userId || (req as any).userId;
    if (!userId) {
        return res.status(401).send('Unauthorized');
    }

    const { start, end } = req.query;

    // Default to today
    const timeMin = typeof start === 'string' ? start : new Date().toISOString();
    const timeMax = typeof end === 'string' ? end : new Date(Date.now() + 86400000).toISOString();

    try {
        const events = await fetchAllCalendarEvents(userId, timeMin, timeMax);
        res.json({ events });
    } catch (error) {
        console.error('Calendar fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events' });
    }
});

export default router;
