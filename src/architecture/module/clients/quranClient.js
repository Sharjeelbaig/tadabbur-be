import {QuranClient} from '@quranjs/api'
import {env} from 'process'
// import dotenv from 'dotenv'
// dotenv.config()
const quranClient = new QuranClient({
    clientId: env.QURAN_API_CLIENT_ID,
    clientSecret: env.QURAN_API_CLIENT_SECRET,
})
export default quranClient