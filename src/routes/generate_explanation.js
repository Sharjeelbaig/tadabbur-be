import express from 'express';
import { generateExplanation } from '../architecture/module/functions/ai';

const router = express.Router();
const suggestedPrompt = 'What does this verse say?';

const buildVerseChatFallback = (details) => ({
    explanation: [
        '# Explainer unavailable right now',
        '-> The structured tafsir explainer is temporarily unavailable.',
        `-> You can still ask grounded verse chat: "${suggestedPrompt}"`,
        '-> Verse chat can still answer from the current ayah and selected tafsir.',
        '# Summary',
        '-> Use verse chat as the fallback explanation path for this ayah.',
    ].join('\n'),
    keyTerms: [],
    cached: false,
    fallbackMode: 'verse_chat',
    suggestedPrompt,
    details,
});

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
            ...buildVerseChatFallback('The tafseer caching system is currently unavailable.'),
            error: 'Database connection failed',
        });
    }
    res.status(500).json({ 
        error: err.message, 
        details: 'An unexpected error occurred while processing your request.',
        cached: false
    });
});

export default router;
