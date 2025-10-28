import express from 'express';
import { listTranslations } from '../architecture/module/functions/data_listing';

const router = express.Router();

router.get('/list-translations', async (req, res, next) => {
    try {
        const translations = await listTranslations();
        res.json(translations);
    } catch (err) {
        next(err);
    }
});

export default router;
