export function StatusBadge({ published, dirty }: { published: boolean; dirty: boolean }) {
  if (!published)
    return (
      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-sm font-medium text-zinc-700" title="Only visible in the CMS">
        Draft
      </span>
    );
  if (dirty)
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900" title="The website still shows the previous version">
        On website · new changes not published
      </span>
    );
  return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-medium text-emerald-800">On website</span>;
}
