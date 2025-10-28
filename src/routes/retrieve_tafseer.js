import express from 'express';
import { retrieveTafseer } from '../architecture/module/functions/data_retrieve';

const router = express.Router();

router.post('/retrieve-tafseer', express.json(), async (req, res, next) => {
    try {
        const { surahNumber, tafseerId } = req.body;
        if (!surahNumber) {
            return res.status(400).json({ error: 'surahNumber is required' });
        }
        const tafseer = await retrieveTafseer(surahNumber, tafseerId);
        res.json(tafseer);
    } catch (err) {
        next(err);
    }
});

export default router;