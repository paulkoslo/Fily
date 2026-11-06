const assert = require('node:assert/strict');
const test = require('node:test');
const { LLMClient } = require('../dist/agents/llm-client');

for (const provider of ['openrouter', 'openai']) {
  test(`the upgraded SDK retains the ${provider} chat request contract without network access`, async () => {
    let request;
    const client = new LLMClient({
      provider, apiKey: 'synthetic-test-key', model: 'openai/gpt-5-mini',
      fetch: async (input, options) => {
        const url = input instanceof Request ? input.url : String(input);
        const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
        const body = options?.body ?? (input instanceof Request ? await input.text() : '');
        request = { url, headers, body: JSON.parse(body) };
        return new Response(JSON.stringify({
          id: 'test', object: 'chat.completion', created: 0,
          choices: [{ index: 0, message: { role: 'assistant', content: '  Structured result  ' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const result = await client.chatCompletion([{ role: 'user', content: 'Synthetic document' }], { maxTokens: 128 });
    assert.equal(result, 'Structured result');
    const host = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
    assert.equal(request.url, `${host}/chat/completions`);
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-test-key');
    assert.equal(request.body.model, provider === 'openrouter' ? 'openai/gpt-5-mini' : 'gpt-5-mini');
    assert.equal(request.body.max_completion_tokens, 128);
    assert.deepEqual(request.body.messages, [{ role: 'user', content: 'Synthetic document' }]);
  });
}
