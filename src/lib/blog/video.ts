/** Preview-only: how the editor shows a video URL. The site renders its own click-to-load player. */
export type VideoEmbed = { kind: "iframe"; src: string } | { kind: "file"; src: string } | { kind: "link"; src: string };

export function videoEmbed(url: string): VideoEmbed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const yt =
    host === "youtu.be"
      ? u.pathname.slice(1)
      : host === "youtube.com" || host === "youtube-nocookie.com"
        ? (u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1])
        : null;
  if (yt && /^[\w-]{6,}$/.test(yt)) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${yt}` };
  const vimeo = host === "vimeo.com" ? u.pathname.match(/^\/(\d+)/)?.[1] : null;
  if (vimeo) return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo}?dnt=1` };
  if (/\.(mp4|webm|m3u8)$/i.test(u.pathname)) return { kind: "file", src: u.toString() };
  return { kind: "link", src: u.toString() };
}
