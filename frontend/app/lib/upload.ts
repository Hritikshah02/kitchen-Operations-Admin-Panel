import { apiJson, sendJson } from "./api";

type Signature = { uploadUrl: string; apiKey: string; folder: string; timestamp: number; signature: string };

/** Uploads straight to Cloudinary with a short-lived signature from our API; returns the hosted URL. */
export async function uploadImage(file: File, signaturePath = "/catalogue/images/signature"): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("Choose an image under 10 MB.");
  const signed = await apiJson<Signature>(signaturePath, sendJson("POST"));
  const form = new FormData();
  form.append("file", file); form.append("api_key", signed.apiKey); form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature); form.append("folder", signed.folder);
  const response = await fetch(signed.uploadUrl, { method: "POST", body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.secure_url) throw new Error(body?.error?.message ?? "Upload failed.");
  return body.secure_url as string;
}
