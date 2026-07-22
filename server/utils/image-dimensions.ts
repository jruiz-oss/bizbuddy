// Dependency-free image dimension reader for the formats Google Business Profile
// accepts for post/photo media (PNG, JPEG, GIF, WebP). Returns null when the
// dimensions can't be determined (unknown/corrupt header) so callers can decide
// how strict to be.

export interface ImageDimensions {
  width: number;
  height: number;
  format: "png" | "jpeg" | "gif" | "webp";
}

export function getImageDimensions(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length < 16) return null;

  // PNG: 8-byte signature, then IHDR chunk with width/height as big-endian uint32.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: "png" };
  }

  // GIF: "GIF87a"/"GIF89a", then width/height as little-endian uint16.
  if (buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: "gif" };
  }

  // WebP: "RIFF"...."WEBP" then a VP8/VP8L/VP8X chunk.
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ") {
      // Lossy: 16-bit width/height (14 bits used) at offset 26/28.
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: "webp" };
    }
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: "webp" };
    }
    if (chunk === "VP8X") {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height, format: "webp" };
    }
    return null;
  }

  // JPEG: 0xFFD8, then walk marker segments until a Start-Of-Frame (SOFn) marker,
  // whose payload holds height then width as big-endian uint16.
  if (buf.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      // Markers are 0xFF followed by a non-0x00, non-0xFF marker code.
      if (buf[offset] !== 0xff) { offset++; continue; }
      let marker = buf[offset + 1];
      // Skip fill bytes (0xFF padding).
      while (marker === 0xff && offset + 1 < buf.length) { offset++; marker = buf[offset + 1]; }
      // SOF0..SOF15 carry dimensions, excluding DHT(0xC4), DAC(0xCC), and RSTn.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height, format: "jpeg" };
      }
      // Otherwise skip this segment using its length field.
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2) return null;
      offset += 2 + segLen;
    }
    return null;
  }

  return null;
}

// Google Business Profile rejects post/photo media below these thresholds,
// often surfacing it as an opaque 500 INTERNAL rather than a clear 4xx.
export const GBP_MIN_IMAGE_DIMENSION = 250; // px, per side
export const GBP_MIN_IMAGE_BYTES = 10 * 1024; // 10 KB

export interface ImageValidationResult {
  ok: boolean;
  message?: string;
}

export function validateGbpImage(buf: Buffer): ImageValidationResult {
  if (buf.length < GBP_MIN_IMAGE_BYTES) {
    return {
      ok: false,
      message: `Image is too small (${Math.round(buf.length / 1024)} KB). Google Business Profile requires at least 10 KB.`,
    };
  }

  const dims = getImageDimensions(buf);
  // If we can't read dimensions we don't block the upload — let GBP be the
  // final arbiter rather than rejecting a valid file we simply couldn't parse.
  if (!dims) return { ok: true };

  if (dims.width < GBP_MIN_IMAGE_DIMENSION || dims.height < GBP_MIN_IMAGE_DIMENSION) {
    return {
      ok: false,
      message: `Image is too small (${dims.width}×${dims.height}px). Google Business Profile requires at least ${GBP_MIN_IMAGE_DIMENSION}×${GBP_MIN_IMAGE_DIMENSION}px.`,
    };
  }

  return { ok: true };
}
