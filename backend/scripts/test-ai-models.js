require('dotenv').config();
const axios = require('axios');

async function testGeminiModels() {
  const key = process.env.GEMINI_API_KEY;
  const modelsToTest = [
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-flash-lite',
    'gemini-pro-latest',
    'gemma-4-26b-a4b-it'
  ];

  console.log('=== Testing Gemini Models ===');
  for (const m of modelsToTest) {
    try {
      process.stdout.write(`Testing Gemini [${m}]... `);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
      const res = await axios.post(url, {
        contents: [{ parts: [{ text: 'Respond with valid JSON: {"status": "ok", "message": "hello"}' }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }, { timeout: 8000 });
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log(`✅ SUCCESS! Response:`, text?.trim());
    } catch (err) {
      console.log(`❌ FAILED (${err.response?.status}):`, err.response?.data?.error?.message || err.message);
    }
  }
}

async function testGrokModels() {
  const key = process.env.OPENAI_API_KEY; // contains grok key
  const grokModels = [
    'grok-3',
    'grok-3-mini',
    'grok-2',
    'grok-2-latest',
    'grok-2-mini',
    'grok-2-1212',
    'grok-2-vision-1212',
    'grok-beta',
    'grok-vision-beta'
  ];

  console.log('\n=== Testing xAI / Grok Models with key ===');
  for (const m of grokModels) {
    try {
      process.stdout.write(`Testing xAI [${m}]... `);
      const res = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: m,
        messages: [{ role: 'user', content: 'Respond with valid JSON: {"status": "ok"}' }],
        response_format: { type: 'json_object' }
      }, {
        headers: {
          'Authorization': `Bearer ${key.trim()}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      });
      console.log(`✅ SUCCESS! Response:`, res.data?.choices?.[0]?.message?.content);
    } catch (err) {
      console.log(`❌ FAILED (${err.response?.status}):`, err.response?.data?.error || err.message);
    }
  }
}

async function main() {
  await testGeminiModels();
  await testGrokModels();
}

main();
