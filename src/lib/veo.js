import { GoogleAuth } from "google-auth-library"

const projectId = process.env.GOOGLE_PROJECT_ID
const location = process.env.GOOGLE_LOCATION
const model = process.env.GOOGLE_VEO_MODEL

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/cloud-platform"]
})

export async function generateVeoVideo({ prompt, imageUrl, aspectRatio = "9:16" }) {

  const client = await auth.getClient()
  const accessToken = await client.getAccessToken()

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`

  const body = {
    instances: [
      {
        prompt,
        image: imageUrl,
        aspectRatio
      }
    ],
    parameters: {
      durationSeconds: 8
    }
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err)
  }

  const data = await res.json()

  return data
    }
