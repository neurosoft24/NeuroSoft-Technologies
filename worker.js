// NeuroSoft AI Proxy Worker (multi-mode)
// One Worker powers all five demos: chat, voice, docqa, and resume.
// Your Groq key lives only here, as an encrypted secret — never in frontend code.

const SYSTEM_PROMPTS = {
  chat: `You are NeuroBot, a friendly AI customer support assistant for "NeuroSoft Demo Store".
Knowledge you have:
- Hours: Monday-Saturday, 10 AM-9 PM. Closed Sundays.
- Returns: 7-day window, item must be unused and in original packaging.
- Shipping: standard 2-4 business days, express next-day in major cities.
- Discount code WELCOME10 gives 10% off a first order.
Reply in 2-3 short, warm sentences. If asked something outside this store's scope, politely redirect to hours, orders, returns, or shipping.`,

  voice: `You are a helpful AI voice receptionist for a small business. Keep every reply to ONE short natural sentence - it will be read aloud, so avoid lists, symbols, or long explanations. You can help book appointments, share hours (Mon-Sat, 10 AM-9 PM), give the location (Main Boulevard, city center), or check order status.`,

  docqa: `You are a document assistant. You will be given a DOCUMENT and a QUESTION.
Answer using ONLY information found in the document. Quote or closely paraphrase the relevant part.
If the answer is not in the document, reply exactly: "That's not covered in this document."
Keep answers to 1-3 sentences.`,

  resume: `You are a resume coach. You will receive a RESUME and a JOB DESCRIPTION.
Respond with ONLY valid JSON, no markdown, no commentary, in this exact shape:
{"score": <integer 0-100>, "missingKeywords": ["...", "..."], "matchedKeywords": ["...", "..."], "bullets": ["...", "...", "...", "..."]}
- score: how well the resume matches the job description.
- missingKeywords: up to 6 important terms from the job description absent from the resume.
- matchedKeywords: up to 6 terms already well covered.
- bullets: 4 rewritten resume bullet points, each starting with a strong action verb, incorporating relevant missing keywords naturally, and quantifying impact where plausible. Base them on the candidate's actual resume content - do not invent unrelated experience.`
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    try {
      const body = await request.json();
      const mode = body.mode;

      if (!SYSTEM_PROMPTS[mode]) {
        return new Response(JSON.stringify({ error: 'Invalid mode' }), { status: 400, headers: corsHeaders() });
      }

      let userContent;
      let history = [];

      if (mode === 'chat' || mode === 'voice') {
        if (!body.message) return badRequest('Missing message');
        userContent = body.message;
        history = Array.isArray(body.history) ? body.history.slice(-6) : [];
      } else if (mode === 'docqa') {
        if (!body.document || !body.question) return badRequest('Missing document or question');
        userContent = `DOCUMENT:\n${body.document}\n\nQUESTION:\n${body.question}`;
      } else if (mode === 'resume') {
        if (!body.resume || !body.jobDescription) return badRequest('Missing resume or jobDescription');
        userContent = `RESUME:\n${body.resume}\n\nJOB DESCRIPTION:\n${body.jobDescription}`;
      }

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: SYSTEM_PROMPTS[mode] },
            ...history,
            { role: 'user', content: userContent }
          ],
          temperature: mode === 'resume' ? 0.4 : 0.6,
          max_tokens: mode === 'resume' ? 500 : 220
        })
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        return new Response(JSON.stringify({ error: 'Groq API error', detail: errText }), {
          status: 502, headers: corsHeaders()
        });
      }

      const data = await groqRes.json();
      const raw = data.choices?.[0]?.message?.content?.trim() || '';

      if (mode === 'resume') {
        try {
          const cleaned = raw.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          return new Response(JSON.stringify(parsed), { headers: corsHeaders() });
        } catch (e) {
          return new Response(JSON.stringify({ error: 'Could not parse AI response' }), { status: 502, headers: corsHeaders() });
        }
      }

      return new Response(JSON.stringify({ reply: raw }), { headers: corsHeaders() });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Server error', detail: String(err) }), {
        status: 500, headers: corsHeaders()
      });
    }
  }
};

function badRequest(msg) {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}
