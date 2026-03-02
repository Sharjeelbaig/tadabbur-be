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
        res.json(result);
    } catch (err) {
        next(err);
    }
});

export default router;
