import express from 'express';
import { correctTafsir } from '../architecture/module/functions/ai.js';
import { saveTafsirFlag } from '../architecture/module/clients/dbClient.js';

const router = express.Router();
router.use(express.json());

router.post('/report-wrong', async (req, res) => {
    try {
        const { verse, tafseerAuthor, originalExplanation, userComplaint, sourceText } = req.body;

        if (!verse || !originalExplanation || !userComplaint || !sourceText) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // 1. Ask AI to evaluate complaint and potentially generate correction
        console.log(`[Report-Wrong] Attempting correction for ${verse} by ${tafsirAuthor}`);
        const correctionResult = await correctTafsir(
            originalExplanation, 
            userComplaint, 
            sourceText, 
            verse, 
            tafsirAuthor || 'Unknown'
        );

        // 2. Save flag to DB with correction results
        const savedFlag = await saveTafsirFlag(
            verse, 
            tafsirAuthor, 
            originalExplanation, 
            userComplaint, 
            correctionResult
        );

        res.status(200).json({
            success: true,
            status: savedFlag.status,
            isCorrected: savedFlag.status === 'auto_corrected',
            explanation: savedFlag.correctedTafsir || originalExplanation,
            correctionReasoning: correctionResult?.correctionReasoning,
            flagId: savedFlag.id
        });
    } catch (error) {
        console.error('Error handling report-wrong:', error);
        res.status(500).json({ error: 'Internal server error while processing the report' });
    }
});

export default router;
