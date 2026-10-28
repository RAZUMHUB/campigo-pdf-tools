import { lazy, Suspense, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import { isPdf } from "./lib/files";
import { startVisitorHeartbeat, trackEvent } from "./lib/analytics";
import type { Intent } from "./editor/model";
import type { PdfFile } from "./lib/pdf";
import AuthDialog, { type Account, type AuthMode } from "./pages/AuthDialog";
import AdminPanel from "./pages/AdminPanel";
import InfoPage from "./pages/InfoPage";
import Landing from "./pages/Landing";
import type { SitePage } from "./pages/content";
import ToolLanding, { type ToolSlug } from "./pages/ToolLanding";

const Editor = lazy(() => import("./editor/Editor"));

export default function App() {
  const [session, setSession] = useState<{ files: PdfFile[]; intent: Intent } | null>(null);
  const [page, setPage] = useState<SitePage>("home");
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toolSlug = window.location.pathname.replace(/^\/+|\/+$/g, "");
  const toolRoutes: ToolSlug[] = ["pdfmerge", "pdfedit", "pdftojpg", "jpgtopdf", "imgcompress", "pdfcompress"];

  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) {
    return <AdminPanel />;
  }

  useEffect(() => {
    return startVisitorHeartbeat();
  }, []);

  useEffect(() => {
    void trackEvent("page_view", { page: window.location.pathname });
  }, [page]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) void trackEvent("login", { page: window.location.pathname });
      if (user?.email) {
        setAccount({
          name: user.displayName || user.email.split("@")[0],
          email: user.email,
        });
      } else {
        setAccount(null);
      }

      setAuthChecking(false);
    });

    return unsubscribe;
  }, []);

  const navigate = (next: SitePage) => {
    setAuthMode(null);
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openFiles = async (picked: File[], intent: Intent) => {
    if (!picked.length || busy) return;
    const pdfs = picked.filter(isPdf);

    if (!pdfs.length) {
      setError("That doesn’t look like a PDF. Choose a .pdf file.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const { openPdfs } = await import("./lib/pdf");
      setSession({ files: await openPdfs(pdfs), intent });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn’t be opened.");
    } finally {
      setBusy(false);
    }
  };

  const completeAuth = (next: Account) => {
    setAccount(next);
    setError(null);
    setAuthMode(null);
  };

  const handleSignOut = async () => {
    setError(null);

    try {
      await signOut(auth);
      setAccount(null);
    } catch {
      setError("Could not sign out. Please try again.");
    }
  };

  if (session) {
    return (
      <Suspense fallback={<p className="p-8 text-sm font-semibold text-slate-500">Loading editor…</p>}>
        <Editor
          initialFiles={session.files}
          intent={session.intent}
          onClose={() => setSession(null)}
        />
      </Suspense>
    );
  }

  if (toolRoutes.includes(toolSlug as ToolSlug)) {
    return (
      <ToolLanding
        slug={toolSlug as ToolSlug}
        onFiles={openFiles}
        busy={busy}
        error={error}
      />
    );
  }

  if (page !== "home") return <InfoPage page={page} onNavigate={navigate} />;

  return (
    <>
      {authChecking ? (
        <div className="p-8 text-center text-sm font-semibold text-slate-500">
          Checking your session…
        </div>
      ) : (
        <Landing
          onFiles={openFiles}
          onNavigate={navigate}
          account={account}
          onAuth={setAuthMode}
          onSignOut={() => void handleSignOut()}
          busy={busy}
          error={error}
        />
      )}

      {authMode && (
        <AuthDialog
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
          onComplete={completeAuth}
          onNavigate={navigate}
        />
      )}
    </>
  );
}
