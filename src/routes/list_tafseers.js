import express from 'express';
import { listTafseers } from '../architecture/module/functions/data_listing';

const router = express.Router();

router.get('/list-tafseers', async (req, res, next) => {
    try {
        const tafseers = await listTafseers();
        res.json(tafseers);
    } catch (err) {
        next(err);
    }
});

export default router;