/** Only a native Gemini conversation is a completed-answer destination. */
export function sanitizeConversationUrl(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4_096 &&
    /^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app\/[A-Za-z0-9_-]+$/.test(value)
    ? value : null;
}
