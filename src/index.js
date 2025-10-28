import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import listSurahRouter from './routes/list_surahs';
import listTafseerRouter from './routes/list_tafseers';
import listTranslationRouter from './routes/list_translations';
import listReciterRouter from './routes/list_reciters';
import generateExplanationRouter from './routes/generate_explanation';
import retrieveSurahRouter from './routes/retrieve_surah';
import retrieveTafseerRouter from './routes/retrieve_tafseer';
import retrieveRecitationRouter from './routes/retrieve_recitation';

const app = express();

app.use('/', listSurahRouter);
app.use('/', listTafseerRouter);
app.use('/', listTranslationRouter);
app.use('/', listReciterRouter);
app.use('/', generateExplanationRouter);
app.use('/', retrieveSurahRouter);
app.use('/', retrieveTafseerRouter);
app.use('/', retrieveRecitationRouter);

app.use((req, res) => res.status(404).send('Not Found'));

app.listen(8080);

export default httpServerHandler({ port: 8080 });