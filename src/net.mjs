export async function requestJson(url, options = {}, timeoutMs = 12000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 300) }; }
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}: ${String(data?.error?.message || data?.message || 'request failed').slice(0, 250)}`);
    err.status = response.status;
    throw err;
  }
  return data;
}
export const safeError = e => (e instanceof Error ? e.message : String(e)).slice(0, 300);
