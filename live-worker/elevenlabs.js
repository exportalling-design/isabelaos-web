import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EL_BASE = "https://api.elevenlabs.io/v1";

// Generates MP3 via ElevenLabs TTS, uploads to Supabase Storage, returns public URL.
export async function synthesizeAndUpload(text, voiceId, sessionId) {
  // 1. Call ElevenLabs
  const ttsRes = await fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.75 },
    }),
  });

  if (!ttsRes.ok) {
    const errText = await ttsRes.text().catch(() => "");
    throw new Error(`ElevenLabs ${ttsRes.status}: ${errText.slice(0, 200)}`);
  }

  const audioBuffer = await ttsRes.arrayBuffer();

  // 2. Upload to Supabase Storage
  const filename = `${sessionId}/${Date.now()}.mp3`;
  const { error: upErr } = await supabase.storage
    .from("live-audio")
    .upload(filename, Buffer.from(audioBuffer), {
      contentType: "audio/mpeg",
      upsert: false,
    });

  if (upErr) throw new Error("Supabase upload: " + upErr.message);

  const { data } = supabase.storage.from("live-audio").getPublicUrl(filename);
  return data.publicUrl;
}
