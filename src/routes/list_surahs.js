import express from 'express';
import { listSurahs } from '../architecture/module/functions/data_listing';

const router = express.Router();

router.get('/list-surahs', async (req, res, next) => {
    try {
        const surahs = await listSurahs();
        res.json(surahs);
    } catch (err) {
        next(err);
    }
});

export default router;