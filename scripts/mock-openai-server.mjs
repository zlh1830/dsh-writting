#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible stub for local-coach protocol tests on a machine
 * without a real local model. It is deliberately not a model: it returns a
 * deterministic link JSON so the DSH provider, prompt, JSON parsing and
 * degradation paths can be exercised end to end.
 *
 * Usage: node scripts/mock-openai-server.mjs
 * Provider baseURL: http://127.0.0.1:3456/v1
 */
import { createServer } from 'node:http'

const port = Number(process.env.MOCK_COACH_PORT ?? 3456)
const model = process.env.MOCK_COACH_MODEL ?? 'mock-coach'

function linkPayload(text) {
  if (/只回复\s*OK|ping/i.test(text)) return 'OK'
  const known = ['受理', '核查', '定性', '方案', '时限', '验收', '目的', '范围', '内容', '责任', '问题', '原因', '主体', '措施', '保障']
  const covered = known.filter((link) => text.includes(link)).slice(0, 4)
  const uncertain = covered.length === 0 ? ['时限', '验收'] : []
  return JSON.stringify({ covered, uncertain, missing: [] })
}

function completionBody(text) {
  return {
    id: 'mock-coach-completion',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 32, completion_tokens: Math.max(1, text.length), total_tokens: 32 + Math.max(1, text.length) },
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function sendStream(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const base = { id: 'mock-coach-completion', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model }
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`)
  const chunks = Array.from(text.match(/.{1,12}/gsu) ?? [])
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`)
  }
  res.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 32, completion_tokens: Math.max(1, text.length), total_tokens: 32 + Math.max(1, text.length) },
    })}\n\n`,
  )
  res.write('data: [DONE]\n\n')
  res.end()
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    sendJson(res, 200, { object: 'list', data: [{ id: model, object: 'model', created: 0, owned_by: 'local-mock' }] })
    return
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } })
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      sendJson(res, 400, { error: { message: 'invalid JSON', type: 'invalid_request_error' } })
      return
    }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const text = messages
      .map((message) => (typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map((part) => part?.text ?? '').join('\n') : ''))
      .join('\n')
    const answer = linkPayload(text)
    if (parsed.stream === true) sendStream(res, answer)
    else sendJson(res, 200, completionBody(answer))
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock coach server listening on http://127.0.0.1:${port}/v1 (model ${model})`)
})
