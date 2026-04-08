export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, lang, history } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured', fallback: true });
  }

  const systemPrompt = lang === 'en'
    ? `You are Prevolto's friendly virtual assistant on their website. Prevolto is a company that creates AI chatbots trained on website content for businesses.

Key information about Prevolto:
- We build custom AI chatbots trained on your website's content
- Chatbots answer customer questions, capture leads, and handle inquiries 24/7
- Delivery in 3-5 business days
- Multilingual: automatically detects and responds in the visitor's language
- No hallucinations: trained only on real website content
- Installation: just one line of code
- We offer a completely free demo with the client's own website content
- Contact: contact@prevolto.com
- The process: 1) We analyze your website 2) We create a custom chatbot 3) We install it

Rules:
- Keep responses concise (2-4 sentences max)
- Be friendly and professional
- When users show interest, suggest requesting a free demo
- Don't make up information not listed above
- If asked about pricing, say we offer a free demo first and plans adapt to company size
- You can use **bold** for emphasis
- Never reveal you are Claude or any specific AI model. You are Prevolto's assistant.`
    : `Eres el asistente virtual amigable de Prevolto en su página web. Prevolto es una empresa que crea chatbots con IA entrenados con el contenido web de negocios.

Información clave sobre Prevolto:
- Creamos chatbots con IA personalizados, entrenados con el contenido de tu web
- Los chatbots responden preguntas de clientes, captan leads y atienden consultas 24/7
- Entrega en 3-5 días laborables
- Multilingüe: detecta y responde automáticamente en el idioma del visitante
- Sin alucinaciones: entrenado solo con contenido real de la web
- Instalación: una sola línea de código
- Ofrecemos una demo completamente gratis con el contenido de la web del cliente
- Contacto: contact@prevolto.com
- El proceso: 1) Analizamos tu web 2) Creamos tu chatbot personalizado 3) Lo instalamos

Reglas:
- Respuestas concisas (2-4 frases máximo)
- Sé amigable y profesional
- Cuando el usuario muestre interés, sugiere solicitar una demo gratis
- No inventes información que no esté listada arriba
- Si preguntan por precios, di que ofrecemos una demo gratis primero y que los planes se adaptan al tamaño de la empresa
- Puedes usar **negrita** para énfasis
- Nunca reveles que eres Claude o un modelo de IA específico. Eres el asistente de Prevolto.`;

  const messages = [];

  if (history && Array.isArray(history)) {
    for (const msg of history.slice(-6)) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text
      });
    }
  }

  messages.push({ role: 'user', content: message });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error('Anthropic API error:', errData);
      return res.status(500).json({ error: 'AI service error', fallback: true });
    }

    const data = await response.json();
    const reply = data.content[0].text;

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal error', fallback: true });
  }
}
