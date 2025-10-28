import {ChatOllama} from '@langchain/ollama'
import {env} from 'process'
// import dotenv from 'dotenv'
// dotenv.config()
const ollamaClient = new ChatOllama({
    baseUrl: 'https://ollama.com',
    model: 'gpt-oss:120b-cloud',
    headers: {
        'Authorization': `Bearer ${env.OLLAMA_API_KEY}`,
    },
})


export default ollamaClient