import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const templatePath = path.join(dist, "index.html");

const template = await readFile(templatePath, "utf8");

const pages = [
  {
    slug: "pdfmerge",
    title: "Merge PDF Files Online Free | CampiGo",
    description:
      "Combine multiple PDF files into one document with CampiGo. Arrange your PDFs and create a single file using our online PDF tools.",
    heading: "Merge PDF Files Online",
    intro:
      "Combine PDF documents into one file. Open CampiGo to work with your documents in your browser.",
  },
  {
    slug: "pdfedit",
    title: "Edit PDF Online Free | CampiGo",
    description:
      "Edit PDF documents online with CampiGo. Add text, images, highlights and signatures, then save your edited PDF.",
    heading: "Edit PDF Online",
    intro:
      "Make common changes to your PDF, including adding text, images, highlights and signatures.",
  },
  {
    slug: "pdftojpg",
    title: "Convert PDF to JPG Online | CampiGo",
    description:
      "Convert PDF pages to JPG images with CampiGo. Prepare PDF pages as images using our browser-based PDF tools.",
    heading: "Convert PDF to JPG",
    intro:
      "Turn PDF pages into JPG images for previews, sharing or use in other documents.",
  },
  {
    slug: "imgcompress",
    title: "Compress Images Online Free | CampiGo",
    description: "Compress JPG and PNG images in your browser. Adjust image quality and download smaller files with CampiGo.",
    heading: "Compress Images Online",
    intro: "Reduce JPG and PNG image file sizes with adjustable quality. Image processing happens in your browser.",
  },
  {
    slug: "pdfcompress",
    title: "Compress PDF Online Free | CampiGo",
    description: "Try reducing PDF file size with CampiGo. Compare file sizes before and after browser-based PDF optimization.",
    heading: "Compress PDF Online",
    intro: "Try browser-based PDF optimization and compare the output size. Results depend on the structure and contents of your PDF.",
  },
  {
    slug: "jpgtopdf",
    title: "JPG to PDF Online | CampiGo",
    description:
      "Explore CampiGo's PDF tools for working with documents and images. Check supported image import and export features.",
    heading: "JPG to PDF",
    intro:
      "Looking to convert an image into a PDF? Check the currently supported import and export options in CampiGo.",
  },
];

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

for (const page of pages) {
  const canonical = `https://campigo.in/${page.slug}`;

  let html = template
    .replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(page.title)}</title>`
    )
    .replace(
      /<meta\s+name="description"[\s\S]*?\/?>/i,
      `<meta name="description" content="${escapeHtml(page.description)}" />`
    );

  html = html.replace(
    /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"\s*\/?>/i,
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n    <link rel="canonical" href="${canonical}" />`
  );

  const staticContent = `
    <main style="max-width:760px;margin:48px auto;padding:24px;font-family:Arial,sans-serif;color:#0f172a;line-height:1.7">
      <nav><a href="/">CampiGo Home</a></nav>
      <h1>${escapeHtml(page.heading)}</h1>
      <p>${escapeHtml(page.intro)}</p>
      <p><a href="/">Open CampiGo PDF tools</a></p>
      <h2>More PDF tools</h2>
      <ul>
        <li><a href="/pdfmerge">Merge PDF</a></li>
        <li><a href="/pdfedit">Edit PDF</a></li>
        <li><a href="/pdftojpg">PDF to JPG</a></li>
        <li><a href="/jpgtopdf">JPG to PDF</a></li>
      </ul>
    </main>`;

  html = html.replace(
    '<div id="root"></div>',
    `<div id="root">${staticContent}</div>`
  );

  const outputDir = path.join(dist, page.slug);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.html"), html, "utf8");
  console.log(`Generated dist/${page.slug}/index.html`);
}
