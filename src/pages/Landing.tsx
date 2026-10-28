import { useRef, useState, type DragEvent } from "react";
import { Brand, Icon, PdfInput, type IconName } from "@/components/ui";
import type { Intent } from "@/editor/model";
import type { Account, AuthMode } from "./AuthDialog";
import type { SitePage } from "./content";

const tools: Array<{ icon: IconName; title: string; description: string; color: string; intent: Intent; multiple?: boolean }> = [
  {
    icon: "edit",
    title: "Edit PDF",
    description: "Change text, add notes, images & more",
    color: "bg-orange-50 text-orange-600",
    intent: "edit",
  },
  {
    icon: "merge",
    title: "Merge PDF",
    description: "Combine PDFs in the order you want",
    color: "bg-indigo-50 text-indigo-600",
    intent: "edit",
    multiple: true,
  },
  {
    icon: "signature",
    title: "Sign PDF",
    description: "Add your signature in seconds",
    color: "bg-emerald-50 text-emerald-600",
    intent: "sign",
  },
  {
    icon: "image",
    title: "PDF to Image",
    description: "Turn pages into crisp JPGs",
    color: "bg-sky-50 text-sky-600",
    intent: "images",
  },
  {
    icon: "image",
    title: "JPG to PDF",
    description: "Convert JPG and PNG images into a PDF",
    color: "bg-violet-50 text-violet-600",
    intent: "edit",
  },
  {
    icon: "image",
    title: "Image Compress",
    description: "Reduce image file size with quality controls",
    color: "bg-cyan-50 text-cyan-600",
    intent: "edit",
  },
  {
    icon: "edit",
    title: "PDF Compress",
    description: "Optimize a PDF and compare file sizes",
    color: "bg-amber-50 text-amber-600",
    intent: "edit",
  },
];

const audiences = [
  ["Students", "Assignments, forms, applications, notes, and project submissions."],
  ["Teachers & professors", "Course packs, feedback, reading material, and signed approvals."],
  ["Schools & universities", "Admissions, records, internal forms, and department documents."],
  ["Public service teams", "Accessible document workflows for routine office tasks."],
];

const privacyPoints = [
  ["Private by default", "Files are not made public or shared with other users."],
  ["Clear controls", "You decide which file to open and when to download it."],
  ["No document ads", "Document contents are never used to personalize advertising."],
  ["Plain-language policy", "Important information is written to be understood."],
];

const steps = [
  ["01", "Upload", "Choose one PDF or several files to combine."],
  ["02", "Make changes", "Edit, sign, highlight, or rotate pages."],
  ["03", "Download", "Save a clean copy, ready to hand in."],
];

const faqs = [
  [
    "Is CampiGo free to use?",
    "The core tools shown here are available without payment. If optional paid features are introduced later, they will be clearly marked before use.",
  ],
  [
    "What happens to my files?",
    "Files you select are processed in your browser and are never uploaded. Closing or refreshing the session clears the active workspace.",
  ],
  [
    "Can I use CampiGo on a phone or tablet?",
    "Yes. The upload flow and workspace adapt to smaller screens, though detailed editing is usually easier on a larger display.",
  ],
  [
    "Does it work for school and official documents?",
    "CampiGo can help prepare routine PDFs, but always follow your institution’s rules for official records, signatures, retention, and accessibility.",
  ],
];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

export default function Landing({
  onFiles,
  onNavigate,
  account,
  onAuth,
  onSignOut,
  busy,
  error,
}: {
  onFiles: (files: File[], intent: Intent) => void;
  onNavigate: (page: SitePage) => void;
  account: Account | null;
  onAuth: (mode: AuthMode) => void;
  onSignOut: () => void;
  busy: boolean;
  error: string | null;
}) {
  const single = useRef<HTMLInputElement>(null);
  const multiple = useRef<HTMLInputElement>(null);
  const intent = useRef<Intent>("edit");
  const [dragging, setDragging] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const pick = (next: Intent, input: React.RefObject<HTMLInputElement | null>) => {
    intent.current = next;
    input.current?.click();
  };

  const acceptDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    onFiles(Array.from(event.dataTransfer.files), "edit");
  };

  return (
    <main className="min-h-screen overflow-hidden bg-white text-slate-950">
      <nav className="mx-auto flex max-w-7xl items-center justify-between border-b border-slate-200 px-5 py-4 md:px-8">
        <Brand />
        <div className="hidden items-center gap-7 text-sm font-semibold text-slate-600 md:flex">
          <button type="button" className="transition hover:text-slate-950" onClick={() => scrollTo("tools")}>
            PDF tools
          </button>
          <button type="button" className="transition hover:text-slate-950" onClick={() => scrollTo("audiences")}>
            Who it’s for
          </button>
          <button type="button" className="transition hover:text-slate-950" onClick={() => scrollTo("help")}>
            Help
          </button>
        </div>
        <div className="flex items-center gap-2">
          {account ? (
            <>
              <span className="hidden text-sm font-semibold text-slate-600 sm:block">{account.name}</span>
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                onClick={onSignOut}
              >
                Close profile
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="hidden px-3 py-2 text-sm font-bold text-slate-700 hover:text-indigo-700 sm:block"
                onClick={() => onAuth("login")}
              >
                Open profile
              </button>
              <button
                type="button"
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-indigo-700"
                onClick={() => onAuth("register")}
              >
                Create profile
              </button>
            </>
          )}
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-14 md:px-8 md:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
          <p className="mb-5 text-sm font-bold uppercase tracking-widest text-indigo-700">
            PDF tools for campus life
          </p>
          <h1 className="max-w-xl text-5xl font-black leading-none tracking-tight text-slate-950 md:text-6xl">
            Get your PDF ready to submit.
          </h1>
          <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-slate-600">
            Edit text, add a signature, combine files, and download the finished document. One workspace,
            without the clutter.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-slate-500">
            <span className="flex items-center gap-2">
              <span className="text-emerald-600">
                <Icon name="check" size="sm" />
              </span>
              Free to use
            </span>
            <span className="flex items-center gap-2">
              <span className="text-emerald-600">
                <Icon name="check" size="sm" />
              </span>
              No watermark
            </span>
            <span className="flex items-center gap-2">
              <span className="text-emerald-600">
                <Icon name="lock" size="sm" />
              </span>
              Files stay private
            </span>
          </div>
        </div>

        <div
          className={`border p-3 transition ${
            dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50 shadow-xl shadow-slate-200/60"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={acceptDrop}
        >
          <div className="flex min-h-96 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 py-12 text-center md:px-12">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-700 text-white">
              <Icon name="upload" />
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-950">Upload a PDF</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Drop a file here, or select one from your device.
            </p>
            <button
              type="button"
              disabled={busy}
              className="mt-7 inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:cursor-wait disabled:opacity-70"
              onClick={() => pick("edit", single)}
            >
              {busy ? "Opening…" : "Select PDF"} {!busy && <Icon name="arrow" size="sm" />}
            </button>
            <PdfInput ref={single} onFiles={(files) => onFiles(files, intent.current)} />
            <p className="mt-5 text-xs font-medium text-slate-400">PDF files up to 100 MB</p>
            {error && (
              <p
                role="alert"
                className="mt-5 max-w-sm border-l-2 border-rose-500 bg-rose-50 px-3 py-2 text-left text-sm font-semibold text-rose-700"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <section id="tools" className="border-y border-slate-200 bg-slate-50 px-5 py-14 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">Start with a tool</h2>
            <p className="mt-2 text-base font-medium text-slate-500">
              Pick a task, upload your file, and CampiGo will open the right workspace.
            </p>
          </div>
          <div className="overflow-hidden border border-slate-200 bg-white">
            {tools.map((tool, index) => (
              <button
                type="button"
                key={tool.title}
                disabled={busy}
                className={`group flex w-full items-center gap-4 p-5 text-left transition hover:bg-slate-50 md:p-6 ${
                  index !== tools.length - 1 ? "border-b border-slate-200" : ""
                }`}
                onClick={() => {
                  const toolRoutes: Record<string, string> = {
                    "PDF to Image": "/pdftojpg",
                    "JPG to PDF": "/jpgtopdf",
                    "Image Compress": "/imgcompress",
                    "PDF Compress": "/pdfcompress",
                  };
                  const route = toolRoutes[tool.title];

                  if (route) {
                    window.location.href = route;
                    return;
                  }

                  pick(tool.intent, tool.multiple ? multiple : single);
                }}
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tool.color}`}>
                  <Icon name={tool.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-slate-900">{tool.title}</span>
                  <span className="mt-0.5 block text-sm font-medium text-slate-500">{tool.description}</span>
                </span>
                <span className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-indigo-700">
                  <Icon name="arrow" />
                </span>
              </button>
            ))}
          </div>
          <PdfInput ref={multiple} multiple onFiles={(files) => onFiles(files, intent.current)} />
        </div>
      </section>

      <section id="audiences" className="px-5 py-20 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-indigo-700">Made for real work</p>
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950">
                One PDF workspace for every desk.
              </h2>
              <p className="mt-4 font-medium leading-7 text-slate-500">
                Straightforward enough for a first assignment, dependable enough for daily administrative work.
              </p>
            </div>
            <div className="grid border-l border-t border-slate-200 sm:grid-cols-2">
              {audiences.map(([title, description]) => (
                <div key={title} className="border-b border-r border-slate-200 p-6">
                  <div className="mb-8 h-1 w-8 bg-indigo-700" />
                  <h3 className="text-base font-bold text-slate-950">{title}</h3>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-950 px-5 py-16 text-white md:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-300">Privacy without fine print</p>
            <h2 className="mt-4 max-w-xl text-3xl font-extrabold tracking-tight">
              Your documents should remain your documents.
            </h2>
            <p className="mt-4 max-w-xl font-medium leading-7 text-slate-300">
              Selected files are processed in your browser and are never uploaded. We do not sell personal
              information or use documents for advertising.
            </p>
            <button
              type="button"
              className="mt-7 inline-flex items-center gap-2 border-b border-indigo-300 pb-1 text-sm font-bold text-indigo-200 hover:text-white"
              onClick={() => onNavigate("privacy")}
            >
              Read our privacy policy <Icon name="arrow" size="sm" />
            </button>
          </div>
          <div className="grid border-l border-t border-slate-700 sm:grid-cols-2">
            {privacyPoints.map(([title, text]) => (
              <div key={title} className="border-b border-r border-slate-700 p-5">
                <span className="text-emerald-400">
                  <Icon name="check" />
                </span>
                <p className="mt-5 text-sm font-bold text-white">{title}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 md:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-700">How it works</p>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950">No new software to learn.</h2>
            <p className="mt-4 font-medium leading-7 text-slate-500">
              The editor keeps common actions visible, uses plain language, and runs entirely in your browser.
            </p>
          </div>
          <div className="grid border-y border-slate-200 md:grid-cols-3">
            {steps.map(([number, label, text], index) => (
              <div
                key={number}
                className={`py-7 md:px-7 ${index < 2 ? "border-b border-slate-200 md:border-b-0 md:border-r" : ""}`}
              >
                <span className="text-xs font-bold text-indigo-700">{number}</span>
                <p className="mt-8 text-base font-bold text-slate-900">{label}</p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="help" className="border-t border-slate-200 bg-slate-50 px-5 py-20 md:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-700">Questions</p>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950">Helpful answers, upfront.</h2>
            <p className="mt-4 font-medium leading-7 text-slate-500">
              Need more help? Our contact page explains how to reach the CampiGo team.
            </p>
            <button
              type="button"
              className="mt-6 text-sm font-bold text-indigo-700 hover:text-indigo-900"
              onClick={() => onNavigate("contact")}
            >
              Contact support
            </button>
          </div>
          <div className="border-t border-slate-300">
            {faqs.map(([question, answer], index) => (
              <div key={question} className="border-b border-slate-300">
                <button
                  type="button"
                  aria-expanded={openFaq === index}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left"
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                >
                  <span className="font-bold text-slate-900">{question}</span>
                  <span className={`shrink-0 text-slate-500 transition ${openFaq === index ? "rotate-180" : ""}`}>
                    <Icon name="chevron" />
                  </span>
                </button>
                {openFaq === index && (
                  <p className="max-w-2xl pb-6 text-sm font-medium leading-7 text-slate-600">{answer}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 px-5 py-16 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 bg-indigo-700 p-8 text-white md:flex-row md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Your next PDF can be done in minutes.</h2>
            <p className="mt-3 font-medium text-indigo-100">
              Open a PDF or create a local profile on this device. No online account is required.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <button
              type="button"
              className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-indigo-800 hover:bg-indigo-50"
              onClick={() => pick("edit", single)}
            >
              Open a PDF
            </button>
            {!account && (
              <button
                type="button"
                className="rounded-lg border border-indigo-400 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-600"
                onClick={() => onAuth("register")}
              >
                Create free profile
              </button>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 px-5 py-7 md:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 py-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <Brand />
              <p className="mt-4 max-w-xs text-sm font-medium leading-6 text-slate-500">
                Practical PDF tools for learning, teaching, administration, and public service.
              </p>
            </div>
            <FooterColumn title="Product">
              <FooterLink onClick={() => scrollTo("tools")}>PDF tools</FooterLink>
              <FooterLink onClick={() => scrollTo("audiences")}>For education</FooterLink>
              <FooterLink onClick={() => scrollTo("help")}>Help center</FooterLink>
            </FooterColumn>
            <FooterColumn title="Trust">
              <FooterLink onClick={() => onNavigate("privacy")}>Privacy policy</FooterLink>
              <FooterLink onClick={() => onNavigate("security")}>Security</FooterLink>
              <FooterLink onClick={() => onNavigate("accessibility")}>Accessibility</FooterLink>
            </FooterColumn>
            <FooterColumn title="Company">
              <FooterLink onClick={() => onNavigate("contact")}>Contact</FooterLink>
              <FooterLink onClick={() => onNavigate("terms")}>Terms of use</FooterLink>
            </FooterColumn>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 py-6 text-xs font-medium text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} CampiGo. All rights reserved.</p>
            <p>Designed for clear, responsible document work.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-900">{title}</p>
      <div className="mt-4 space-y-3 text-sm font-medium text-slate-500">{children}</div>
    </div>
  );
}

function FooterLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="block hover:text-indigo-700" onClick={onClick}>
      {children}
    </button>
  );
}
