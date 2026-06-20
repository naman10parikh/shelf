// validate.ts — the upload validation pipeline (O-02 / O-10 / O-13; P-07 / P-09 / P-11; S4 / S5 / S15).
//
// "Validate the file" is NOT "check the extension". The senior move (O-13) caps what the file DOES to
// your machine: type by MAGIC BYTES (not the client header/extension — P-07), and resource-consumption
// (size, pixel dimensions, ratio). SVG is an XML DOCUMENT, not an image, so it is REFUSED from untrusted
// users (O-10 / P-09 / S5). This is the load-bearing reject in the acceptance test (fake.png, evil.svg).

import { fileTypeFromBuffer } from "file-type";

/** Default image allowlist (the common safe raster set). SVG is deliberately absent (O-10). */
export const DEFAULT_ALLOW = ["jpg", "jpeg", "png", "gif", "webp", "avif"];

export interface ValidateOptions {
  /** Allowed extension/type tokens (e.g. ["png","jpg"]). Defaults to DEFAULT_ALLOW. */
  allow?: string[];
  /** Max raw byte size. */
  maxBytes?: number;
  /** Max total pixels (width × height) — the pixel-flood / decompression-bomb cap (P-11). */
  maxPixels?: number;
  /** Max width:height (or height:width) ratio — rejects degenerate strip images. */
  maxRatio?: number;
}

export interface ValidateResult {
  ok: boolean;
  detectedType: string | null;
  detectedMime: string | null;
  sizeBytes: number;
  width?: number;
  height?: number;
  reasons: string[];
}

/** Defaults applied when an option is omitted. Conservative, defense-in-depth. */
const DEFAULTS = {
  maxBytes: 25 * 1024 * 1024, // 25 MiB
  maxPixels: 50_000_000, // 50 MP — well under the 50k×50k pixel-flood (P-11)
  maxRatio: 50, // strips beyond 50:1 are almost always hostile/decode-abusive
};

/**
 * Run the full validation pipeline over a file's bytes. Returns ok:false WITH reasons rather than
 * throwing, so callers can render the rejection (the CLI maps ok:false → non-zero exit).
 */
export async function validateBytes(bytes: Buffer, opts: ValidateOptions = {}): Promise<ValidateResult> {
  const reasons: string[] = [];
  const allow = (opts.allow && opts.allow.length > 0 ? opts.allow : DEFAULT_ALLOW).map((t) =>
    t.toLowerCase().replace(/^\./, ""),
  );
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxPixels = opts.maxPixels ?? DEFAULTS.maxPixels;
  const maxRatio = opts.maxRatio ?? DEFAULTS.maxRatio;

  const sizeBytes = bytes.length;

  // (1) Size cap — first line of defense (O-13).
  if (sizeBytes > maxBytes) {
    reasons.push(`size ${sizeBytes} exceeds max ${maxBytes} bytes`);
  }

  // (2) SVG / HTML refusal — these are XML/HTML DOCUMENTS, not images. file-type does NOT sniff text
  //     formats, so we MUST detect them by content (P-07's spoof = an .html renamed .png; P-09 = SVG).
  const head = bytes.subarray(0, 2048).toString("utf8");
  if (looksLikeSvg(head)) {
    reasons.push("SVG from untrusted input is refused (XML document → stored XSS + SSRF; O-10/P-09). Rasterize-and-discard in a sandbox if you must accept it.");
    return done(false, null, null, sizeBytes, reasons);
  }
  if (looksLikeHtml(head)) {
    reasons.push("file is HTML, not an allowed image type (the classic .html-renamed-.png stored-XSS spoof; O-02/P-07). Validate by magic bytes, never the client extension.");
    return done(false, null, null, sizeBytes, reasons);
  }

  // (3) Magic-byte type detection — the source of truth, NOT the client extension (O-02 / P-07).
  const ft = await fileTypeFromBuffer(bytes);
  const detectedType = ft?.ext ?? null;
  const detectedMime = ft?.mime ?? null;

  if (!detectedType) {
    reasons.push("could not determine file type by magic bytes (not a recognized binary format). Refusing — type by structure, never by the client's claim (O-02).");
    return done(false, detectedType, detectedMime, sizeBytes, reasons);
  }

  const normalized = detectedType === "jpg" ? "jpeg" : detectedType;
  const allowNormalized = allow.map((a) => (a === "jpg" ? "jpeg" : a));
  if (!allowNormalized.includes(normalized)) {
    reasons.push(`detected type '${detectedType}' (${detectedMime ?? "?"}) is not in the allowlist [${allow.join(", ")}]`);
  }

  // (4) Pixel-dimension / ratio caps — the pixel-flood / decode-bomb gate (P-11 / S15).
  const dims = readDimensions(bytes, detectedType);
  if (dims) {
    const { width, height } = dims;
    const pixels = width * height;
    if (pixels > maxPixels) {
      reasons.push(`image is ${width}×${height} = ${pixels.toLocaleString()} px, exceeding the ${maxPixels.toLocaleString()} px cap (pixel-flood DoS; P-11)`);
    }
    const ratio = Math.max(width / Math.max(height, 1), height / Math.max(width, 1));
    if (ratio > maxRatio) {
      reasons.push(`aspect ratio ${ratio.toFixed(1)}:1 exceeds the ${maxRatio}:1 cap`);
    }
    return done(reasons.length === 0, detectedType, detectedMime, sizeBytes, reasons, width, height);
  }

  return done(reasons.length === 0, detectedType, detectedMime, sizeBytes, reasons);
}

function done(
  ok: boolean,
  detectedType: string | null,
  detectedMime: string | null,
  sizeBytes: number,
  reasons: string[],
  width?: number,
  height?: number,
): ValidateResult {
  const result: ValidateResult = { ok, detectedType, detectedMime, sizeBytes, reasons };
  if (width !== undefined) result.width = width;
  if (height !== undefined) result.height = height;
  return result;
}

function looksLikeSvg(head: string): boolean {
  return /<\s*svg[\s>]/i.test(head) || /<\?xml[^>]*>\s*<!doctype\s+svg/i.test(head);
}

function looksLikeHtml(head: string): boolean {
  return /<!doctype\s+html/i.test(head) || /<\s*html[\s>]/i.test(head) || /<\s*script[\s>]/i.test(head);
}

/**
 * Read image dimensions from header bytes for the common raster formats — no native `sharp` dependency
 * (keeps the CI gate $0 and portable). Returns null for formats we don't header-parse (the type/size
 * caps still apply).
 */
export function readDimensions(buf: Buffer, type: string): { width: number; height: number } | null {
  try {
    if (type === "png") {
      // PNG: width/height are big-endian uint32 at offsets 16 and 20 (after the 8-byte sig + IHDR len/type).
      if (buf.length < 24) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type === "gif") {
      // GIF: width/height are little-endian uint16 at offsets 6 and 8.
      if (buf.length < 10) return null;
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (type === "jpg" || type === "jpeg") {
      return readJpegDimensions(buf);
    }
    return null;
  } catch {
    return null;
  }
}

/** Scan JPEG segments for an SOF marker carrying height/width. */
function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let offset = 2; // skip SOI (0xFFD8)
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0..SOF15 (excluding DHT/JPG/DAC at C4/C8/CC) carry frame dimensions.
    if (marker !== undefined && marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    const segLen = buf.readUInt16BE(offset + 2);
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
}
