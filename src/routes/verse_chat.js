import express from 'express';
import { streamVerseChatTurn } from '../architecture/module/functions/verse_chat.js';

const router = express.Router();

router.post('/verse-chat', express.json({ limit: '1mb' }), async (req, res) => {
  let isClosed = false;
  req.on('close', () => {
    isClosed = true;
  });

  const writeFrame = (frame) => {
    if (isClosed) {
      return;
    }

    res.write(`${JSON.stringify(frame)}\n`);
  };

  try {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    await streamVerseChatTurn(req.body || {}, {
      onStatus: (status) => writeFrame({ status }),
      onDelta: (delta) => writeFrame({ delta }),
      onSources: (sources) => writeFrame({ sources }),
      onDone: ({ summary }) => writeFrame({ done: true, summary }),
    });

    if (!isClosed) {
      res.end();
    }
  } catch (error) {
    console.error('Error handling /verse-chat:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Verse chat failed.',
      });
    }

    writeFrame({
      error: error instanceof Error ? error.message : 'Verse chat failed.',
    });

    if (!isClosed) {
      res.end();
    }
  }
});

export default router;
