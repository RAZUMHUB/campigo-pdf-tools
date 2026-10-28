export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
