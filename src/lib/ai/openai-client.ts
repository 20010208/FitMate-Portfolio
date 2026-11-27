import 'server-only'
import OpenAI from 'openai'

let client: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (client) return client

  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('OpenAI API key is missing. Set OPENAI_API_KEY.')
  }

  client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 30_000,
  })

  return client
}
