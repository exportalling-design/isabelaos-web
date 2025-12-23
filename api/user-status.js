export default async function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      step: "function_loaded",
      env: {
        hasUrl: !!process.env.SUPABASE_URL,
        hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e),
    });
  }
}
