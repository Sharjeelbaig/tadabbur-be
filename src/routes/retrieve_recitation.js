import express from 'express';
import { retrieveRecitation } from '../architecture/module/functions/data_retrieve';

const router = express.Router();

router.post('/retrieve-recitation', express.json(), async (req, res, next) => {
    try {
        const { surahNumber, recitationId } = req.body;
        if (!surahNumber) {
            return res.status(400).json({ error: 'surahNumber is required' });
        }
        const recitation = await retrieveRecitation(surahNumber, recitationId);
        res.json(recitation);
    } catch (err) {
        next(err);
    }
});

export default router;