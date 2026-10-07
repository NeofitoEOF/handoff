import crypto from "node:crypto";
import { config } from "./config.js";

const key = Buffer.from(config.INTEGRATION_ENCRYPTION_KEY, "hex");

export function decryptTeamsWebhook(input: {
  ciphertext: string;
  iv: string;
  tag: string;
}): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  const clear = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);
  return clear.toString("utf8");
}

export async function sendTeamsWebhook(
  webhookUrl: string,
  payload: {
    title: string;
    message: string;
    requestId?: string | null;
  },
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "handoff_notification",
      title: payload.title,
      message: payload.message,
      requestId: payload.requestId ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Teams webhook HTTP ${response.status}`);
  }
}
