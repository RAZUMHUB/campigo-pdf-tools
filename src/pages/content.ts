export type SitePage = "home" | "privacy" | "terms" | "security" | "accessibility" | "contact";

type InfoContent = {
  eyebrow: string;
  title: string;
  intro: string;
  updated?: string;
  sections: Array<{ title: string; body: string[] }>;
};

const configuredEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();

export const infoContent: Record<Exclude<SitePage, "home">, InfoContent> = {
  privacy: {
    eyebrow: "Trust center",
    title: "Privacy policy",
    intro:
      "This policy explains what information CampiGo handles, why it is needed, and the choices available to you.",
    updated: "Last updated: March 2026",
    sections: [
      {
        title: "The short version",
        body: [
          "PDFs selected in the editor are processed entirely in your browser and are never uploaded to a server. We do not sell personal information, use document contents for advertising, or make your work public.",
          "You should still avoid placing highly sensitive records into any online tool unless your school, employer, or organization has approved that use.",
        ],
      },
      {
        title: "Information we handle",
        body: [
          "CampiGo may process basic technical information needed to operate the website, such as browser type, device type, approximate region, and error information. If you contact support, we receive the information you choose to include in your message.",
          "We do not ask you to include private document contents in support requests.",
        ],
      },
      {
        title: "Your documents",
        body: [
          "Files selected in the current editor are used only to provide the actions you request during that browser session. Closing or refreshing the active session clears the current workspace.",
          "Document contents are not sold, used to build advertising profiles, or shared with other CampiGo users.",
        ],
      },
      {
        title: "Your choices",
        body: [
          "You can stop using the service at any time, close the active browser tab, and remove downloaded copies from your own device. You may contact us with a privacy question or request through the contact page.",
        ],
      },
    ],
  },
  terms: {
    eyebrow: "Legal",
    title: "Terms of use",
    intro: "These terms set practical expectations for using CampiGo responsibly and lawfully.",
    updated: "Last updated: March 2026",
    sections: [
      {
        title: "Using CampiGo",
        body: [
          "You may use CampiGo for lawful personal, educational, professional, and administrative document tasks. You are responsible for having permission to open, modify, sign, convert, or distribute each file you use.",
        ],
      },
      {
        title: "Responsible use",
        body: [
          "Do not use CampiGo to violate intellectual property rights, alter records fraudulently, impersonate another person, distribute malicious files, or interfere with the service.",
          "Electronic signature requirements vary. Confirm that your recipient accepts the signature method used before relying on it for an official or legally binding document.",
        ],
      },
      {
        title: "Availability",
        body: [
          "We work to keep CampiGo useful and available, but the service may change, pause, or experience errors. Keep your own copy of important documents and review exported files before submission.",
        ],
      },
      {
        title: "Institutional requirements",
        body: [
          "Schools, universities, employers, and government organizations may have separate rules for records, privacy, accessibility, signatures, and retention. Those requirements remain your responsibility.",
        ],
      },
    ],
  },
  security: {
    eyebrow: "Trust center",
    title: "Security at CampiGo",
    intro:
      "Security starts with collecting less, being clear about file handling, and giving people direct control.",
    sections: [
      {
        title: "Browser-session processing",
        body: [
          "CampiGo keeps selected files in the active browser session and does not upload them. Files are not made public, and other users cannot browse your workspace.",
        ],
      },
      {
        title: "Safe habits",
        body: [
          "Use an updated browser, download files only to trusted devices, and close the workspace when using a shared computer. Review the final PDF before sending it.",
          "Do not upload restricted records unless your organization has approved CampiGo for that classification of information.",
        ],
      },
      {
        title: "Reporting a concern",
        body: [
          "If you believe you found a security issue, use the contact page and include a clear description of the behavior. Do not include real student records, passwords, private PDFs, or sensitive personal information.",
        ],
      },
    ],
  },
  accessibility: {
    eyebrow: "Our commitment",
    title: "Accessibility",
    intro:
      "CampiGo is intended to work for students, educators, staff, and members of the public with different access needs.",
    sections: [
      {
        title: "What we aim for",
        body: [
          "We design for keyboard access, visible focus states, readable contrast, responsive layouts, understandable labels, and clear error messages.",
          "We aim to improve the service in line with widely recognized web accessibility guidance as the product develops.",
        ],
      },
      {
        title: "Document accessibility",
        body: [
          "Editing a PDF does not automatically make the PDF accessible. Authors remain responsible for document structure, reading order, alternative text, headings, form labels, language, and contrast in the final file.",
        ],
      },
      {
        title: "Tell us what is not working",
        body: [
          "If a CampiGo feature creates a barrier, contact us with the page, task, browser, and assistive technology involved. We will use that information to prioritize improvements.",
        ],
      },
    ],
  },
  contact: {
    eyebrow: "Support",
    title: "Contact CampiGo",
    intro: "Questions, accessibility feedback, privacy requests, and product suggestions are welcome.",
    sections: [
      {
        title: "Before you send a message",
        body: [
          "Tell us what you were trying to do, what happened, and which browser or device you used. Screenshots can help, but remove names, student numbers, addresses, grades, signatures, and other private information first.",
        ],
      },
      {
        title: "Support",
        body: [
          `Email: ${configuredEmail || "princekumar085167@gmail.com"}`,
          "WhatsApp: +91 9102137117",
          "Contact by email: mailto:princekumar085167@gmail.com",
          "WhatsApp chat: https://wa.me/919102137117",
        ],
      },
      {
        title: "Security and privacy",
        body: [
          "For security reports or privacy questions, begin the subject line with “Security” or “Privacy.” Never send passwords or attach confidential documents.",
        ],
      },
    ],
  },
};
