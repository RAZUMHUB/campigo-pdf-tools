import { useState, type FormEvent } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { Brand, Icon, Modal } from "@/components/ui";
import { auth } from "@/lib/firebase";
import type { SitePage } from "./content";

export type AuthMode = "login" | "register";
export type Account = { name: string; email: string };

function Field({
  id,
  label,
  type = "text",
  placeholder,
  autoComplete,
  minLength,
  maxLength,
}: {
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  placeholder: string;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-2 block text-sm font-bold text-slate-800">
        {label}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        required
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

function firebaseErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/email-already-in-use":
      return "This email already has an account. Please sign in.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Choose a stronger password.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Incorrect email or password.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in popup. Allow popups and try again.";
    case "auth/unauthorized-domain":
      return "This website domain is not authorized in Firebase Authentication settings.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled in Firebase Console.";
    case "auth/network-request-failed":
      return "Network error. Check your internet connection and try again.";
    default:
      return "Authentication failed. Please try again.";
  }
}

export default function AuthDialog({
  mode,
  onClose,
  onModeChange,
  onComplete,
  onNavigate,
}: {
  mode: AuthMode;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  onComplete: (account: Account) => void;
  onNavigate: (page: SitePage) => void;
}) {
  const isRegister = mode === "register";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const complete = () => {
    const user = auth.currentUser;
    if (!user?.email) {
      setError("Sign-in completed, but no email was returned by Firebase.");
      return;
    }

    onComplete({
      name: user.displayName || user.email.split("@")[0],
      email: user.email,
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setError("");
    setNotice("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();

    try {
      if (isRegister) {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );

        if (name) {
          await updateProfile(credential.user, { displayName: name });
        }

        await sendEmailVerification(credential.user);
        await signOut(auth);
        setNotice("Verification email sent! Open the link in your inbox, then sign in with your email and password.");
        return;
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password);

        if (!credential.user.emailVerified) {
          await signOut(auth);
          setError("Please verify your email using the link we sent before signing in.");
          return;
        }
      }

      complete();
    } catch (authError) {
      setError(firebaseErrorMessage(authError));
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (loading) return;

    setError("");
    setNotice("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      complete();
    } catch (authError) {
      setError(firebaseErrorMessage(authError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal titleId="auth-title" onClose={onClose}>
      <div className="flex items-start justify-between gap-6">
        <Brand />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <h2
        id="auth-title"
        className="mt-9 text-3xl font-extrabold tracking-tight text-slate-950"
      >
        {isRegister ? "Create your CampiGo account" : "Welcome back"}
      </h2>

      <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
        {isRegister
          ? "Create your account with your email and a strong password."
          : "Sign in with your registered email and password."}
      </p>

      <button
        type="button"
        disabled={loading}
        onClick={() => void signInWithGoogle()}
        className="mt-7 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-5 py-3.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg viewBox="0 0 48 48" aria-hidden="true" className="h-5 w-5">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.3 0 24 0 14.6 0 6.5 5.4 3 13.3l7.8 6.1C12.5 13.6 17.7 9.5 24 9.5Z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.2-3.1-.5-4.5H24v9h12.4c-.6 3-2.3 5.5-4.7 7.2l7.3 5.7c4.3-4 7.1-9.9 7.1-17.4Z" />
          <path fill="#FBBC05" d="M10.8 28.6a14.5 14.5 0 0 1 0-9.2L3 13.3a24 24 0 0 0 0 21.4l7.8-6.1Z" />
          <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15-6.1l-7.3-5.7c-2 1.3-4.5 2.1-7.7 2.1-6.3 0-11.5-4.1-13.2-9.9L3 34.7C6.5 42.6 14.6 48 24 48Z" />
        </svg>
        {loading ? "Please wait..." : "Continue with Google"}
      </button>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold uppercase text-slate-400">
          or continue with email
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form className="space-y-5" onSubmit={submit}>
        {isRegister && (
          <Field
            id="name"
            label="Full name"
            placeholder="Your name"
            autoComplete="name"
            maxLength={100}
          />
        )}

        <Field
          id="email"
          label="Email address"
          type="email"
          placeholder="name@school.edu"
          autoComplete="email"
          maxLength={254}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          placeholder={isRegister ? "At least 12 characters" : "Your password"}
          autoComplete={isRegister ? "new-password" : "current-password"}
          minLength={isRegister ? 12 : 1}
          maxLength={128}
        />

        {error && (
          <p
            role="alert"
            className="border-l-2 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="border-l-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"
          >
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-indigo-700 px-5 py-3.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? "Please wait..."
            : isRegister
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm font-medium text-slate-500">
        {isRegister ? "Already have an account?" : "New to CampiGo?"}{" "}
        <button
          type="button"
          className="font-bold text-indigo-700 hover:text-indigo-900"
          onClick={() => {
            setError("");
            setNotice("");
            onModeChange(isRegister ? "login" : "register");
          }}
        >
          {isRegister ? "Sign in" : "Create account"}
        </button>
      </p>

      {isRegister && (
        <p className="mt-5 text-center text-xs font-medium leading-5 text-slate-400">
          By continuing, you agree to our{" "}
          <button
            type="button"
            className="underline hover:text-slate-700"
            onClick={() => onNavigate("terms")}
          >
            Terms
          </button>{" "}
          and{" "}
          <button
            type="button"
            className="underline hover:text-slate-700"
            onClick={() => onNavigate("privacy")}
          >
            Privacy Policy
          </button>
          .
        </p>
      )}

      <div className="mt-7 border-t border-slate-200 pt-5">
        <p className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-400">
          <Icon name="lock" size="sm" />
          Your account is securely managed by Firebase Authentication.
        </p>
      </div>
    </Modal>
  );
}
