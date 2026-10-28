export const EMBEDDING_DIM = 256

export function fixtureEmbedding(text: string): number[] {
  const out = new Array<number>(EMBEDDING_DIM).fill(0)
  const source = text.toLowerCase()
  for (let index = 0; index < source.length; index += 1) {
    const slot = (source.charCodeAt(index) * 17 + index * 31) % EMBEDDING_DIM
    out[slot] = (out[slot] ?? 0) + ((source.charCodeAt(index) % 23) - 11) / 11
  }
  const norm = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0)) || 1
  return out.map((value) => Number((value / norm).toFixed(6)))
}

export type LlmMode = 'openai' | 'anthropic' | 'gemini' | 'fixture'

export function resolveMode(): LlmMode {
  const explicit = process.env.LLM_PROVIDER
  if (explicit === 'fixture') return 'fixture'
  if (explicit === 'openai' && process.env.OPENAI_API_KEY) return 'openai'
  if (explicit === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (explicit === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini'
  if (!explicit && process.env.OPENAI_API_KEY) return 'openai'
  if (!explicit && process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (!explicit && process.env.GEMINI_API_KEY) return 'gemini'
  return 'fixture'
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240)
    throw new Error(`The language model returned ${response.status}. ${detail}`)
  }
  return response.json()
}

export async function completeJson(system: string, user: string): Promise<string> {
  const mode = resolveMode()
  if (mode === 'openai') {
    const payload = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    )
    const text = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content
    if (!text) throw new Error('The language model returned an empty tag set.')
    return text
  }
  if (mode === 'gemini') {
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
    const payload = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      },
    )
    const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts ?? []
    const text = parts.map((part) => part.text).filter(Boolean).join('\n')
    if (!text) throw new Error('The language model returned an empty tag set.')
    return text
  }
  const payload = await postJson(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    {
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 1600,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }],
    },
  )
  const blocks = (payload as { content?: Array<{ type?: string; text?: string }> }).content ?? []
  const text = blocks
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
  if (!text) throw new Error('The language model returned an empty tag set.')
  return text
}

export async function embedText(text: string): Promise<{ vector: number[]; model: string }> {
  const mode = resolveMode()
  if (mode === 'fixture' || mode === 'gemini' || (mode === 'anthropic' && !process.env.OPENAI_API_KEY)) {
    return { vector: fixtureEmbedding(text), model: 'fixture-hash' }
  }
  const payload = await postJson(
    'https://api.openai.com/v1/embeddings',
    { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}` },
    { model: 'text-embedding-3-small', input: text.slice(0, 8000), dimensions: EMBEDDING_DIM },
  )
  const vector = (payload as { data?: Array<{ embedding?: number[] }> }).data?.[0]?.embedding
  if (!vector || vector.length !== EMBEDDING_DIM) throw new Error('The embedding model returned an unexpected vector.')
  return { vector, model: 'text-embedding-3-small' }
}
