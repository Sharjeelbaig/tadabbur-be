import express from 'express';
import { generateExplanation } from '../architecture/module/functions/ai';

const router = express.Router();

router.post('/generate-explanation', express.json(), async (req, res, next) => {
    try {
        const { tafseerText } = req.body;
        if (!tafseerText) {
            return res.status(400).json({ error: 'tafseerText is required' });
        }
        const explanation = await generateExplanation(tafseerText);
        res.json(explanation);
    } catch (err) {
        next(err);
    }
});

export default router;
