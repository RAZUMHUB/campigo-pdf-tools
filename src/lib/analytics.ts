import { auth } from "./firebase";

const API = (
  import.meta.env.VITE_API_BASE_URL ||
  "https://p9jp3l3qdn473ypm.hq5.lambda-web.ap-northeast-1.on.aws"
).replace(/\/$/, "");

const KEY = "campigo_visitor_id";

function visitorId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `cg_${crypto.randomUUID().replace(/-/g, "")}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `cg_${crypto.randomUUID().replace(/-/g, "")}`;
  }
}

export async function trackEvent(
  eventType: string,
  details: { page?: string; tool?: string } = {},
) {
  try {
    const currentUser = auth.currentUser;
    const token = currentUser ? await currentUser.getIdToken() : null;
    await fetch(`${API}/api/analytics/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        visitorId: visitorId(),
        eventType,
        page: details.page ?? window.location.pathname,
        ...(details.tool ? { tool: details.tool } : {}),
      }),
      keepalive: true,
    });
  } catch {
    // Analytics failures must never break the main application.
  }
}

export function startVisitorHeartbeat() {
  const send = () => void trackEvent("heartbeat");
  send();
  const timer = window.setInterval(send, 30_000);
  return () => window.clearInterval(timer);
}
