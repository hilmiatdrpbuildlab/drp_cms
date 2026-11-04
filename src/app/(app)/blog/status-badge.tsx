export function StatusBadge({ published, dirty }: { published: boolean; dirty: boolean }) {
  if (!published) return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">Draft</span>;
  if (dirty)
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="Saved changes that are not on the site yet">
        Published · changes not live
      </span>
    );
  return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Published</span>;
}
