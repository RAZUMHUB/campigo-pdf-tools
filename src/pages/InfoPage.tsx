import { useState, type FormEvent } from "react";
import emailjs from "@emailjs/browser";
import { Brand } from "@/components/ui";
import { infoContent, type SitePage } from "./content";

export default function InfoPage({
  page,
  onNavigate,
}: {
  page: Exclude<SitePage, "home">;
  onNavigate: (page: SitePage) => void;
}) {
  const content = infoContent[page];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [issueType, setIssueType] = useState("Bug / Problem");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID?.trim();
    const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID?.trim();
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY?.trim();

    if (!serviceId || !templateId || !publicKey) {
      setStatus("Feedback form is not configured yet. Please email princekumar085167@gmail.com directly.");
      return;
    }

    setSending(true);
    try {
      await emailjs.send(
        serviceId,
        templateId,
        {
          from_name: name.trim(),
          reply_to: email.trim(),
          issue_type: issueType,
          message: message.trim(),
          to_email: "princekumar085167@gmail.com",
        },
        { publicKey },
      );
      setStatus("Message sent successfully! Thank you for contacting CampiGo.");
      setName("");
      setEmail("");
      setIssueType("Bug / Problem");
      setMessage("");
    } catch {
      setStatus("Message could not be sent. Please try again or email princekumar085167@gmail.com directly.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <nav className="mx-auto flex max-w-7xl items-center justify-between border-b border-slate-200 px-5 py-4 md:px-8">
        <button type="button" onClick={() => onNavigate("home")} title="CampiGo home">
          <Brand />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-indigo-700"
          onClick={() => onNavigate("home")}
        >
          Back to CampiGo
        </button>
      </nav>

      <section className="mx-auto max-w-4xl px-5 py-16 md:px-8 md:py-24">
        <p className="text-sm font-bold uppercase tracking-widest text-indigo-700">{content.eyebrow}</p>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-950 md:text-6xl">{content.title}</h1>
        <p className="mt-6 max-w-3xl text-lg font-medium leading-8 text-slate-600">{content.intro}</p>
        {content.updated && <p className="mt-5 text-sm font-semibold text-slate-400">{content.updated}</p>}

        {page === "contact" && (
          <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:p-8">
            <h2 className="text-2xl font-black text-slate-950">Send us a message</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Report a problem, share a suggestion, or send feedback to the CampiGo team.
            </p>

            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-bold text-slate-700">
                  Name
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 font-medium outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    maxLength={100}
                    required
                    placeholder="Your name"
                  />
                </label>
                <label className="block text-sm font-bold text-slate-700">
                  Email address
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 font-medium outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    required
                    placeholder="you@example.com"
                  />
                </label>
              </div>

              <label className="block text-sm font-bold text-slate-700">
                Issue type
                <select
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 font-medium outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
                  value={issueType}
                  onChange={(event) => setIssueType(event.target.value)}
                >
                  <option>Bug / Problem</option>
                  <option>Suggestion</option>
                  <option>Feedback</option>
                  <option>Other</option>
                </select>
              </label>

              <label className="block text-sm font-bold text-slate-700">
                Message
                <textarea
                  className="mt-2 min-h-36 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-3 font-medium outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  minLength={10}
                  maxLength={5000}
                  required
                  placeholder="Describe your problem or suggestion..."
                />
              </label>

              <button
                type="submit"
                disabled={sending}
                className="rounded-lg bg-indigo-700 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending..." : "Send Message"}
              </button>

              {status && (
                <p role="status" aria-live="polite" className="text-sm font-semibold text-slate-700">
                  {status}
                </p>
              )}
            </form>

            <p className="mt-5 text-sm text-slate-600">
              Prefer email?{" "}
              <a className="font-bold text-indigo-700 underline" href="mailto:princekumar085167@gmail.com">
                princekumar085167@gmail.com
              </a>
            </p>
          </section>
        )}

        <div className="mt-14 border-t border-slate-300">
          {content.sections.map((section) => (
            <section
              key={section.title}
              className="grid gap-5 border-b border-slate-200 py-9 md:grid-cols-[0.55fr_1fr]"
            >
              <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>
              <div className="space-y-4">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="break-words font-medium leading-7 text-slate-600">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-lg bg-indigo-700 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-800"
            onClick={() => onNavigate("home")}
          >
            Return home
          </button>
          {page !== "contact" && (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => onNavigate("contact")}
            >
              Contact us
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
