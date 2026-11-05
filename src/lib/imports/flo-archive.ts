import { inflateRawSync } from "node:zlib";

export const FLO_LIMITS = { inputBytes: 16 * 1024 * 1024, memberBytes: 8 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024, members: 256, rows: 100000, milliseconds: 15000 } as const;

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function decodeFlo(bytes: Uint8Array): string {
  // No replacement characters: other encodings need an explicitly reviewed adapter.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error("Unsupported CSV control character");
  return text;
}

export function safeMemberPath(path: string): void {
  const parts = path.split("/");
  if (!path || path.length > 240 || /[\\:\u0000-\u001f]/.test(path) || parts.length > 5 ||
    parts.some(p => !p || p === "." || p === ".." || /[. ]$/.test(p))) throw new Error("Unsafe archive path");
}

/** A deliberately restricted ZIP reader: stored/deflated CSV only, no extraction to disk.
 * Central and local metadata must agree. ZIP64, encryption, links, special files,
 * nested archives and ambiguous paths are rejected for the entire archive.
 */
export function readFloZip(input: Buffer): Array<{ path: string; bytes: Buffer; error?: string }> {
  if (input.length > FLO_LIMITS.inputBytes) throw new Error("ZIP input limit exceeded");
  const started = Date.now();
  let end = -1;
  for (let i = input.length - 22; i >= Math.max(0, input.length - 65557); i--) {
    if (input.readUInt32LE(i) === 0x06054b50 && i + 22 + input.readUInt16LE(i + 20) === input.length) { end = i; break; }
  }
  if (end < 0) throw new Error("Malformed ZIP end record");
  const count = input.readUInt16LE(end + 10);
  const centralSize = input.readUInt32LE(end + 12);
  const central = input.readUInt32LE(end + 16);
  if (input.readUInt16LE(end + 4) || input.readUInt16LE(end + 6) || input.readUInt16LE(end + 8) !== count ||
    count === 65535 || count > FLO_LIMITS.members || central + centralSize !== end) throw new Error("Unsupported ZIP layout or member limit");
  const entries: Array<{ path: string; bytes: Buffer; error?: string }> = [];
  const paths = new Set<string>();
  const ranges: Array<[number, number]> = [];
  let pos = central, total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > end || input.readUInt32LE(pos) !== 0x02014b50) throw new Error("Malformed ZIP directory");
    const flags = input.readUInt16LE(pos + 8), method = input.readUInt16LE(pos + 10);
    const crc = input.readUInt32LE(pos + 16), compressed = input.readUInt32LE(pos + 20), size = input.readUInt32LE(pos + 24);
    const nameSize = input.readUInt16LE(pos + 28), extraSize = input.readUInt16LE(pos + 30), commentSize = input.readUInt16LE(pos + 32);
    const offset = input.readUInt32LE(pos + 42), attributes = input.readUInt32LE(pos + 38);
    const next = pos + 46 + nameSize + extraSize + commentSize;
    if (next > end || input.readUInt16LE(pos + 34)) throw new Error("Malformed ZIP entry");
    const path = decodeFlo(input.subarray(pos + 46, pos + 46 + nameSize));
    safeMemberPath(path);
    const unixType = (attributes >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 || attributes & 0x10) throw new Error("ZIP links/directories/special files unsupported");
    if (!/\.csv$/i.test(path) || paths.has(path.toLowerCase())) throw new Error("ZIP requires unique CSV member paths; no nested archives");
    paths.add(path.toLowerCase());
    if ((flags & ~0x0808) || ![0, 8].includes(method) || size > FLO_LIMITS.memberBytes || compressed === 0xffffffff || offset === 0xffffffff ||
      (size > 0 && (compressed === 0 || size / compressed > 200)) || (total += size) > FLO_LIMITS.totalBytes) throw new Error("ZIP resource/encoding/compression limit");
    if (offset + 30 > central || input.readUInt32LE(offset) !== 0x04034b50 ||
      input.readUInt16LE(offset + 6) !== flags || input.readUInt16LE(offset + 8) !== method) throw new Error("ZIP local header mismatch");
    const localNameSize = input.readUInt16LE(offset + 26), localExtra = input.readUInt16LE(offset + 28);
    const data = offset + 30 + localNameSize + localExtra, finish = data + compressed;
    if (finish > central || !input.subarray(offset + 30, offset + 30 + localNameSize).equals(input.subarray(pos + 46, pos + 46 + nameSize)) ||
      ranges.some(([a, b]) => offset < b && finish > a)) throw new Error("ZIP overlapping/mismatched member");
    if (!(flags & 8) && (input.readUInt32LE(offset + 14) !== crc || input.readUInt32LE(offset + 18) !== compressed || input.readUInt32LE(offset + 22) !== size)) throw new Error("ZIP size/CRC metadata mismatch");
    ranges.push([offset, finish]);
    let bytes: Buffer;
    try {
      const packed = input.subarray(data, finish);
      bytes = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: FLO_LIMITS.memberBytes });
      if (bytes.length !== size || crc32(bytes) !== crc) throw new Error("ZIP member size/CRC mismatch");
      entries.push({ path, bytes });
    } catch {
      entries.push({ path, bytes: Buffer.alloc(0), error: "Corrupt ZIP member (decompression/size/CRC)" });
    }
    if (Date.now() - started > FLO_LIMITS.milliseconds) throw new Error("ZIP time limit exceeded");
    pos = next;
  }
  if (pos !== end || !entries.length) throw new Error("Empty or malformed ZIP directory");
  return entries;
}
