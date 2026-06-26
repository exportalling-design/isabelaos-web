import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Returns 1-2 sentences in character as the avatar persona.
export async function generateResponse(personaPrompt, event) {
  const { type, username, message, giftName, giftCount } = event;

  let userContext;
  if (type === "gift") {
    userContext = `${username} sent you ${giftCount}x "${giftName}" as a gift.`;
  } else if (type === "follow") {
    userContext = `${username} just followed you.`;
  } else {
    userContext = `${username} says: "${message}"`;
  }

  const prompt = `${personaPrompt}

LIVE EVENT: ${userContext}

Respond in character, MAX 2 sentences, warm and engaging for TikTok live. Do not mention you are an AI. Reply directly as if speaking out loud.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    // Hard cap — ElevenLabs works best under ~250 chars for low latency
    return text.slice(0, 300);
  } catch (err) {
    console.error("[gemini] error:", err.message);
    if (type === "gift") return `¡Gracias ${username} por el regalo! ¡Los amo!`;
    if (type === "follow") return `¡Bienvenido/a ${username}! Qué bueno tenerte aquí.`;
    return `¡Gracias ${username}!`;
  }
}
