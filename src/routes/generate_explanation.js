import express from 'express';
import { generateExplanation } from '../architecture/module/functions/ai';

const router = express.Router();

router.post('/generate-explanation', express.json(), async (req, res, next) => {
    try {
        const { tafseerText, verse, tafseerAuthor } = req.body;
        if (!tafseerText) {
            return res.status(400).json({ error: 'tafseerText is required' });
        }
        
        const result = await generateExplanation(tafseerText, verse, tafseerAuthor);
        res.json({
            ...result,
            cached: result.cached || false,
        });
    } catch (err) {
        console.error('Error generating explanation:', err);
        next(err);
    }
});

// Error handler for this router
router.use((err, req, res, next) => {
    if (err.message.includes('DATABASE_URL') || err.message.includes('connection')) {
        return res.status(503).json({ 
            error: 'Database connection failed', 
            details: 'The tafseer caching system is currently unavailable. Please try again later.',
            cached: false
        });
    }
    res.status(500).json({ 
        error: err.message, 
        details: 'An unexpected error occurred while processing your request.',
        cached: false
    });
});

export default router;
