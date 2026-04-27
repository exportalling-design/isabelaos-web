// api/cineai/isabela-prompt.js
// Backend seguro para Isabela — genera prompts Seedance 2.0 con Claude
// La ANTHROPIC_API_KEY vive solo en variables de entorno de Vercel, nunca en el frontend
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { answers, duration, refImagesCount, hasVideo, hasAudio, ratio } = req.body || {};

  if (!answers || typeof answers !== "object") {
    return res.status(400).json({ error: "Missing answers" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const durationSec = duration || 10;

  const systemPrompt = `You are Isabela, IsabelaOS Studio's AI assistant specialized in creating Seedance 2.0 prompts following BytePlus official documentation.

OFFICIAL SEEDANCE 2.0 PROMPT STRUCTURE (BytePlus docs):
Formula: [Subject 1] + [Action/Movement 1] + [Action/Movement 2]
Or multi-subject: [Subject 1] + [Action] + [Subject 2] + [Action]
List elements in ORDER. Model expands from your words. Be specific and concrete.
ALWAYS start with the subject/main action — NEVER start with camera or style.

DURATION COMMAND (MANDATORY — append at very end):
--dur 5   → 5 seconds: ONE clear single action, no cuts
--dur 10  → 10 seconds: 1-2 actions + one camera move, optionally one cut
--dur 15  → 15 seconds: 2-3 scenes connected with "Cut to [new scene]"
The user selected: --dur ${durationSec} — use this EXACT command.

CAMERA LANGUAGE (exact BytePlus terms):
surround | aerial drone | zoom in/out | pan left/right | tilt up/down
follow camera | handheld | dolly in | tracking shot | static tripod
For scene transitions: "Cut to [full description of new scene]"
After a cut that changes location: describe the NEW scene completely.

MULTIMODAL REFERENCE SYNTAX:
- Images: "Reference [element] from Image 1" or "Extract [element] from Image 2"
- Video: "Extend Video 1 backward, [new content], and connect to Video 1 at the end"
- Image 1 = first uploaded photo (main subject), Image 2+ = additional references

LIP SYNC (only if audio provided):
Include: "lips moving naturally synced to audio, expressive mouth movement, close-up face moments"

VISUAL STYLE MODIFIERS (add 1-2 max):
Cinematic: film grain | cinematic color grading | anamorphic lens | shallow depth of field
TikTok: vertical format | ring light | smooth orbit | beat-synced movement
Aerial: sweeping drone | bird's eye view | epic landscape reveal
Slow motion: high-speed footage | slow motion impact | bullet time
Night/City: neon reflections | wet pavement | volumetric fog | rim lighting
Golden hour: warm backlight | sun flares | golden tones

DURATION DEPTH GUIDE:
--dur 5: single action, close shot, no cuts
--dur 10: 1-2 actions + camera move, max 1 cut
--dur 15: 2-3 scenes with "Cut to" transitions

HARD RULES:
- NO celebrity names, brand names, copyrighted characters
- Do NOT start with camera description
- Max 180 words for the prompt (not counting --dur)
- English only for the prompt text
- Specific descriptors only: not "beautiful lighting" but "warm rim light from the left"

OUTPUT FORMAT — return EXACTLY this structure:

PROMPT:
[Optimized English prompt ending with --dur ${durationSec}]

GUÍA DE RECURSOS:
[Spanish: specific upload instructions for each image/video slot and its role]

CONSEJO ISABELA:
[Spanish: 1 very specific tip to maximize quality for this exact scene type]`;

  const userMsg = `User wants to create: ${JSON.stringify(answers, null, 2)}

Duration: ${durationSec} seconds → must end with --dur ${durationSec}
Reference images: ${refImagesCount || 0} uploaded
Reference video: ${hasVideo ? "Yes — Video 1 available" : "No"}
Audio for lip sync: ${hasAudio ? "YES — include lip sync language" : "No"}
Aspect ratio: ${ratio || "9:16"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || "Claude API error" });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    return res.status(200).json({ ok: true, text });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
