// ---------------------------------------------------------
// /api/optimize-prompt.js – API route para OpenAI
// ---------------------------------------------------------

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Falta prompt" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Optimiza prompts para generación de imágenes. Hazlos más descriptivos, cinematográficos, fotográficos, claros y sin contradicciones.",
        },
        { role: "user", content: prompt },
      ],
    });

    const optimized = completion.choices[0].message.content;

    res.status(200).json({ optimized });
  } catch (err) {
    console.error("Error en optimize-prompt:", err);
    res.status(500).json({ error: "Error interno optimizando prompt" });
  }
}
