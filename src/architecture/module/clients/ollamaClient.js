import {ChatOllama} from '@langchain/ollama'
import {env} from 'process'
import {JsonOutputParser} from '@langchain/core/output_parsers'

// import dotenv from 'dotenv'
// dotenv.config()

const ollamaClient = new ChatOllama({
    baseUrl: 'https://ollama.com',
    // model: 'gpt-oss:120b-cloud',
    model: 'gpt-oss:20b-cloud',
    headers: {
        'Authorization': `Bearer ${env.OLLAMA_API_KEY}`,
    },
    think: false,
    // speed up response:
    numCtx: 1024,
    temperature: 0.7,
})

const jsonParser = new JsonOutputParser()

export default ollamaClient
export {jsonParser}
