import { createGoogleGenerativeAI } from "@ai-sdk/google"

export function createGeminiModel(getEnv: (name: string) => string | undefined) {
  const apiKey = getEnv("GEMINI_API_KEY")?.trim()
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.")
  const modelName = getEnv("GEMINI_MODEL")?.trim() || "gemini-3.8-flash"
  return createGoogleGenerativeAI({ apiKey })(modelName)
}
