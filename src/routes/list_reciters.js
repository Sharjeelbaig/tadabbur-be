import express from 'express';
import { listReciters } from '../architecture/module/functions/data_listing';

const router = express.Router();

router.get('/list-reciters', async (req, res, next) => {
    try {
        const reciters = await listReciters();
        res.json(reciters);
    } catch (err) {
        next(err);
    }
});

export default router;
