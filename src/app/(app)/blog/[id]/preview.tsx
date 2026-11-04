"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ArticleVideo } from "@/lib/blog/contract";
import { videoEmbed } from "@/lib/blog/video";

/**
 * An approximation of the article page, for writing. The real page is rendered by drp_compro's build.
 * react-markdown ignores raw HTML, so pasted <script> or <iframe> never runs here.
 */
export function Preview({
  title,
  body,
  coverUrl,
  coverAlt,
  video,
}: {
  title: string;
  body: string;
  coverUrl: string | null;
  coverAlt: string;
  video: ArticleVideo | null;
}) {
  const embed = video ? videoEmbed(video.url) : null;
  const aspect = video?.aspect === "9:16" ? "aspect-[9/16] max-w-xs mx-auto" : video?.aspect === "1:1" ? "aspect-square max-w-md mx-auto" : "aspect-video";
  return (
    <article className="prose prose-zinc max-w-none prose-headings:scroll-mt-20 prose-img:rounded-lg prose-pre:bg-zinc-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {coverUrl && <img src={coverUrl} alt={coverAlt} className="aspect-[16/9] w-full object-cover" />}
      <h1>{title || "Untitled"}</h1>
      {video && (
        <figure>
          {embed?.kind === "iframe" ? (
            <iframe className={`w-full rounded-lg ${aspect}`} src={embed.src} title="Video preview" allow="encrypted-media; picture-in-picture" allowFullScreen />
          ) : embed?.kind === "file" ? (
            <video className={`w-full rounded-lg ${aspect}`} src={embed.src} poster={video.poster} controls preload="metadata" />
          ) : (
            <p className="rounded-lg bg-zinc-100 p-4 text-sm">
              Video: <a href={video.url} target="_blank" rel="noreferrer">{video.url}</a>
            </p>
          )}
          {(video.creator || video.sourceUrl) && (
            <figcaption>
              {video.creator}
              {video.sourceUrl && (
                <>
                  {video.creator && " · "}
                  <a href={video.sourceUrl} target="_blank" rel="noreferrer">original post</a>
                </>
              )}
            </figcaption>
          )}
        </figure>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </article>
  );
}
