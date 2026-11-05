"use client";

/**
 * The Word-like editor. What you see is formatted text; what it stores is still the Markdown the
 * site builds from (via @tiptap/markdown), so nothing changes for drp_compro or the git history.
 * Only what the site can show is offered: headings 2–3, bold, italic, links, lists, quotes, code,
 * tables, images and a divider.
 */
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, type ReactNode } from "react";

type Uploaded = { url: string; alt: string };

export function RichEditor({
  value,
  onChange,
  upload,
  uploading,
}: {
  value: string;
  onChange: (markdown: string) => void;
  /** Uploads images and returns where they live; errors are shown by the caller. */
  upload: (files: File[]) => Promise<Uploaded[]>;
  uploading: boolean;
}) {
  const insertImages = async (editor: Editor, files: File[], pos?: number) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    const done = await upload(images);
    const chain = editor.chain().focus();
    if (pos !== undefined) chain.setTextSelection(pos);
    done.forEach((img) => chain.setImage({ src: img.url, alt: img.alt }).createParagraphNear());
    chain.run();
    return true;
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Markdown has no underline; the site would drop it.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Image.configure({ inline: false }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Start writing your article here…" }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: {
      attributes: {
        class: "prose prose-zinc max-w-none min-h-[60vh] px-6 py-5 text-[17px] leading-relaxed outline-none",
        "aria-label": "Article text",
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.some((f) => f.type.startsWith("image/")) || !editorRef.current) return false;
        void insertImages(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.some((f) => f.type.startsWith("image/")) || !editorRef.current) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(editorRef.current, files, pos);
        return true;
      },
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  if (!editor) return <div className="min-h-[60vh] px-6 py-5 text-zinc-400">Loading the editor…</div>;
  return (
    <>
      <Toolbar editor={editor} uploading={uploading} onImages={(files) => insertImages(editor, files)} />
      <EditorContent editor={editor} />
    </>
  );
}

function Toolbar({ editor, uploading, onImages }: { editor: Editor; uploading: boolean; onImages: (files: File[]) => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("codeBlock"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const setLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const href = prompt(
      "Paste the web address for the link.\n\nAnother website: https://…\nA page of our own site: /contact/ (the right language is added automatically)\n\nLeave empty to remove the link.",
      current ?? "https://",
    );
    if (href === null) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href.trim() || href.trim() === "https://") chain.unsetLink().run();
    else chain.setLink({ href: href.trim() }).run();
  };

  return (
    <div className="sticky top-[var(--bar-h,0px)] z-[5] flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-2 py-2">
      <select
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
        value={s.block}
        aria-label="Text style"
        onChange={(e) => {
          const v = e.target.value;
          const c = editor.chain().focus();
          (v === "p" ? c.setParagraph() : c.setHeading({ level: v === "h2" ? 2 : 3 })).run();
        }}
      >
        <option value="p">Normal text</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <Sep />
      <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
      <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i className="font-serif">I</i></Btn>
      <Btn label="Link" active={s.link} onClick={setLink}>🔗 Link</Btn>
      <Sep />
      <Btn label="Bulleted list" active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Btn>
      <Btn label="Numbered list" active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Btn>
      <Btn label="Quote" active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝ Quote</Btn>
      <Btn label="Code block (for programming code)" active={s.code} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"</>"}</Btn>
      <Sep />
      <label className={`cursor-pointer rounded-md px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 ${uploading ? "opacity-50" : ""}`} title="Insert a picture (you can also paste or drag one in)">
        {uploading ? "Uploading…" : "🖼 Picture"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
          multiple
          hidden
          disabled={uploading}
          onChange={(e) => {
            if (e.target.files) onImages([...e.target.files]);
            e.target.value = "";
          }}
        />
      </label>
      <Btn label="Table" active={s.table} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()} disabled={s.table}>
        ▦ Table
      </Btn>
      <Btn label="Divider line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>― Line</Btn>
      <Sep />
      <Btn label="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!s.canUndo}>↶</Btn>
      <Btn label="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!s.canRedo}>↷</Btn>

      {s.table && (
        <div className="flex w-full flex-wrap items-center gap-1 border-t border-zinc-100 pt-1.5 text-sm">
          <span className="px-1 text-zinc-500">Table:</span>
          <Btn label="Add a row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</Btn>
          <Btn label="Add a column to the right" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</Btn>
          <Btn label="Remove this row" onClick={() => editor.chain().focus().deleteRow().run()}>− Row</Btn>
          <Btn label="Remove this column" onClick={() => editor.chain().focus().deleteColumn().run()}>− Column</Btn>
          <Btn label="Remove the whole table" onClick={() => editor.chain().focus().deleteTable().run()}>Remove table</Btn>
        </div>
      )}
    </div>
  );
}

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`rounded-md px-2.5 py-1.5 text-sm disabled:opacity-40 ${active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-zinc-200" aria-hidden="true" />;
