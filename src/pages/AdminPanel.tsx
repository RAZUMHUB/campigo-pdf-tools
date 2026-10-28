import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../lib/firebase";

const API = (import.meta.env.VITE_API_BASE_URL || "https://p9jp3l3qdn473ypm.hq5.lambda-web.ap-northeast-1.on.aws").replace(/\/$/, "");

type AdminData = {
  generatedAt?: string;
  users?: { total: number; registeredToday: number };
  sessions?: { total: number; unexpired: number; note?: string };
  recentUsers?: Array<{
    id: string;
    email: string;
    emailVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

type UserRow = {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sessionCount: number;
};

type SessionRow = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
  user: { id: string; email: string };
};

type FirebaseUserRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
};

type VisitorRow = {
  visitorId: string;
  uid: string | null;
  email: string | null;
  page: string;
  lastSeenAt: string | null;
};

type ActivityRow = {
  eventId: string;
  visitorId: string | null;
  uid: string | null;
  email: string | null;
  eventType: string;
  page: string;
  tool: string | null;
  createdAt: string | null;
};

type Tab = "overview" | "users" | "sessions" | "firebase" | "visitors" | "activity";

function date(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export default function AdminPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<AdminData | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [firebaseUsers, setFirebaseUsers] = useState<FirebaseUserRow[]>([]);
  const [visitors, setVisitors] = useState<VisitorRow[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
  }, []);

  const request = useCallback(
    async (path: string) => {
      if (!user) throw new Error("Please sign in with your owner account.");

      const token = await user.getIdToken();
      const response = await fetch(`${API}/api/admin${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (response.status === 401) {
        throw new Error("Your session is invalid or expired. Sign in again.");
      }
      if (response.status === 403) {
        throw new Error("Access denied. This Firebase account is not configured as the CampiGo owner.");
      }
      if (!response.ok) {
        throw new Error(`Admin API failed (${response.status}). Check the backend deployment.`);
      }

      return response.json();
    },
    [user],
  );

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");

    try {
      if (tab === "overview") {
        const result = await request("/overview");
        setOverview(result);
      } else if (tab === "users") {
        const query = new URLSearchParams({ limit: "100" });
        if (search.trim()) query.set("search", search.trim());
        const result = await request(`/users?${query.toString()}`);
        setUsers(result.users ?? []);
      } else if (tab === "sessions") {
        const result = await request("/sessions?limit=100");
        setSessions(result.sessions ?? []);
      } else if (tab === "firebase") {
        const result = await request("/firebase-users?limit=100");
        setFirebaseUsers(result.users ?? []);
      } else if (tab === "visitors") {
        const result = await request("/visitors");
        setVisitors(result.visitors ?? []);
        setActiveCount(result.activeCount ?? 0);
      } else if (tab === "activity") {
        const result = await request("/activity?limit=100");
        setActivity(result.events ?? []);
      }
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load admin data.");
    } finally {
      setLoading(false);
    }
  }, [user, tab, search, request]);

  useEffect(() => {
    if (user) void loadData();
  }, [user, loadData]);

  if (!authReady) {
    return <main className="grid min-h-screen place-items-center bg-slate-950 text-white">Checking your session…</main>;
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-5 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8">
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-cyan-400 font-black text-slate-950">C</div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">CampiGo · Owner Console</p>
          <h1 className="mt-3 text-3xl font-bold">Sign in required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Sign in to CampiGo first, then open this page again. Only the server-authorized owner account can access admin data.
          </p>
          <a href="/" className="mt-6 inline-flex rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950">Go to CampiGo</a>
        </div>
      </main>
    );
  }

  const nav: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "Users" },
    { id: "sessions", label: "Login sessions" },
    { id: "firebase", label: "Firebase Users" },
    { id: "visitors", label: "Live Visitors" },
    { id: "activity", label: "Activity Log" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-slate-950 p-5 text-white md:flex">
        <a href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 font-black text-slate-950">C</span>
          <span>
            <span className="block text-lg font-bold">CampiGo</span>
            <span className="text-xs text-slate-400">Owner Console</span>
          </span>
        </a>
        <p className="mb-3 mt-10 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Workspace</p>
        <nav className="space-y-1">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${
                tab === item.id ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/10"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Owner session</div>
          <p className="mt-2 break-all text-xs text-slate-400">{user.email}</p>
          <a href="/" className="mt-4 inline-block text-xs font-bold text-cyan-300">← Back to website</a>
        </div>
      </aside>

      <main className="md:ml-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur md:px-9">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">CampiGo / Admin</p>
              <h1 className="mt-1 text-xl font-bold md:text-2xl">
                {nav.find((item) => item.id === tab)?.label}
              </h1>
            </div>
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-7xl p-5 md:p-9">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">Welcome back</h2>
              <p className="mt-1 text-sm text-slate-500">Real records from the CampiGo backend.</p>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              {lastUpdated ? `Updated ${lastUpdated}` : "Waiting for data"}
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <strong>Could not load data</strong>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-xs">Check that the updated backend is deployed and this account has owner access.</p>
            </div>
          )}

          {tab === "overview" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Registered users" value={overview?.users?.total ?? "—"} detail="Accounts in PostgreSQL" />
                <Metric label="Registered today" value={overview?.users?.registeredToday ?? "—"} detail="New accounts since midnight" />
                <Metric label="Login sessions" value={overview?.sessions?.total ?? "—"} detail="Stored sessions in database" />
                <Metric label="Unexpired sessions" value={overview?.sessions?.unexpired ?? "—"} detail="Not the same as live visitors" />
              </div>

              <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="font-bold">Recently registered users</h3>
                  <p className="mt-1 text-xs text-slate-500">Newest PostgreSQL accounts</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr><th className="px-5 py-3">Email</th><th className="px-5 py-3">Verified</th><th className="px-5 py-3">Registered</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(overview?.recentUsers ?? []).map((item) => (
                        <tr key={item.id}>
                          <td className="px-5 py-4 font-medium">{item.email}</td>
                          <td className="px-5 py-4">{item.emailVerifiedAt ? "Yes" : "No"}</td>
                          <td className="px-5 py-4 text-slate-500">{date(item.createdAt)}</td>
                        </tr>
                      ))}
                      {overview && !overview.recentUsers?.length && (
                        <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-500">No PostgreSQL users found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                Visitor analytics, Firebase-only accounts and PDF tool events are not included until their tracking/storage is implemented.
              </p>
            </>
          )}

          {tab === "users" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div><h3 className="font-bold">User directory</h3><p className="mt-1 text-xs text-slate-500">Search by email · maximum 100 rows per request</p></div>
                <form onSubmit={(event) => { event.preventDefault(); void loadData(); }} className="flex gap-2">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search email…" className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                  <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Search</button>
                </form>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="px-5 py-3">Email</th><th className="px-5 py-3">Verified</th><th className="px-5 py-3">Sessions</th><th className="px-5 py-3">Registered</th><th className="px-5 py-3">Last updated</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap px-5 py-4 font-medium">{item.email}</td>
                        <td className="px-5 py-4">{item.emailVerifiedAt ? "Yes" : "No"}</td>
                        <td className="px-5 py-4">{item.sessionCount}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-500">{date(item.createdAt)}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-500">{date(item.updatedAt)}</td>
                      </tr>
                    ))}
                    {!loading && !users.length && (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-500">No matching users found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "sessions" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5">
                <h3 className="font-bold">Recent login sessions</h3>
                <p className="mt-1 text-xs text-slate-500">A stored session is not proof that a person is currently online.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="px-5 py-3">Account</th><th className="px-5 py-3">Session started</th><th className="px-5 py-3">Expires</th><th className="px-5 py-3">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.map((item) => (
                      <tr key={item.id}>
                        <td className="px-5 py-4 font-medium">{item.user.email}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-500">{date(item.createdAt)}</td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-500">{date(item.expiresAt)}</td>
                        <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.active ? "Unexpired" : "Expired"}</span></td>
                      </tr>
                    ))}
                    {!loading && !sessions.length && (
                      <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No sessions found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}


          {tab === "firebase" && (
            <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <h2 className="p-5 font-bold">Firebase Users</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="bg-slate-50">
                  <th className="p-3">Name / Email</th><th className="p-3">Verified</th>
                  <th className="p-3">Status</th><th className="p-3">Registered</th>
                  <th className="p-3">Last login</th>
                </tr></thead>
                <tbody>{firebaseUsers.map((u) => (
                  <tr key={u.uid} className="border-t border-slate-100">
                    <td className="p-3">{u.displayName || "—"}<div className="text-xs text-slate-500">{u.email || u.uid}</div></td>
                    <td className="p-3">{u.emailVerified ? "Yes" : "No"}</td>
                    <td className="p-3">{u.disabled ? "Disabled" : "Active"}</td>
                    <td className="p-3">{date(u.createdAt ?? undefined)}</td>
                    <td className="p-3">{date(u.lastSignInAt ?? undefined)}</td>
                  </tr>
                ))}{!loading && !firebaseUsers.length && <tr><td colSpan={5} className="p-6 text-center">No Firebase users returned.</td></tr>}</tbody>
              </table>
            </section>
          )}

          {tab === "visitors" && (
            <>
              <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-6">
                <p className="text-sm text-slate-500">Active visitors · last 90 seconds</p>
                <p className="mt-2 text-4xl font-black">{activeCount}</p>
              </div>
              <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <h2 className="p-5 font-bold">Live Visitors</h2>
                <table className="w-full text-left text-sm">
                  <thead><tr className="bg-slate-50"><th className="p-3">User / Visitor</th><th className="p-3">Page</th><th className="p-3">Last seen</th></tr></thead>
                  <tbody>{visitors.map((v) => (
                    <tr key={v.visitorId} className="border-t border-slate-100">
                      <td className="p-3">{v.email || "Anonymous"}<div className="text-xs text-slate-500">{v.uid || v.visitorId}</div></td>
                      <td className="p-3">{v.page}</td><td className="p-3">{date(v.lastSeenAt ?? undefined)}</td>
                    </tr>
                  ))}{!loading && !visitors.length && <tr><td colSpan={3} className="p-6 text-center">No active visitors yet.</td></tr>}</tbody>
                </table>
              </section>
            </>
          )}

          {tab === "activity" && (
            <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <h2 className="p-5 font-bold">Activity Log</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="bg-slate-50"><th className="p-3">Time</th><th className="p-3">User / Visitor</th><th className="p-3">Event</th><th className="p-3">Tool</th><th className="p-3">Page</th></tr></thead>
                <tbody>{activity.map((e) => (
                  <tr key={e.eventId} className="border-t border-slate-100">
                    <td className="p-3">{date(e.createdAt ?? undefined)}</td><td className="p-3">{e.email || e.uid || e.visitorId || "Anonymous"}</td>
                    <td className="p-3">{e.eventType}</td><td className="p-3">{e.tool || "—"}</td><td className="p-3">{e.page}</td>
                  </tr>
                ))}{!loading && !activity.length && <tr><td colSpan={5} className="p-6 text-center">No activity recorded yet.</td></tr>}</tbody>
              </table>
            </section>
          )}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-500">
            <span>CampiGo Owner Console</span>
            <span>Admin data is protected by server-side authorization.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
