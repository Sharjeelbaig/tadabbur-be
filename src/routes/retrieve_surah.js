import express from 'express';
import { retrieveSurah } from "../architecture/module/functions/data_retrieve";

const router = express.Router();

router.post('/retrieve-surah', express.json(), async (req, res, next) => {
    try {
        const { surahNumber, translationId } = req.body;
        if (!surahNumber) {
            return res.status(400).json({ error: 'surahNumber is required' });
        }
        const surah = await retrieveSurah(surahNumber, translationId);
        res.json(surah);
    } catch (err) {
        next(err);
    }
});

export default router;