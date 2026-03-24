export default async function handler(req, res) {
  return res.status(200).json({
    has_uid: !!process.env.PAGADITO_UID,
    has_wsk: !!process.env.PAGADITO_WSK,
    uid_prefix: process.env.PAGADITO_UID
      ? process.env.PAGADITO_UID.slice(0, 4)
      : null,
  });
}
