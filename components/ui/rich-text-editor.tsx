"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SmartTextParams {
  commandKey: string;
  insertReplacement: (text: string, trailing: string) => void;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  onSmartTextCommand?: (params: SmartTextParams) => void;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = "120px",
  onSmartTextCommand,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      handleKeyDown: (view, event) => {
        if (!onSmartTextCommand) return false;

        const triggerKeys = new Set([" ", "Enter", "Tab"]);
        if (!triggerKeys.has(event.key)) return false;

        const { from } = view.state.selection;
        const textBeforeCursor = view.state.doc.textBetween(0, from, "\n");
        const match = textBeforeCursor.match(/(?:^|\s)(\.[a-zA-Z0-9_-]+)$/);
        if (!match) return false;

        const commandKey = match[1].toLowerCase();
        const commandStart = from - commandKey.length;

        event.preventDefault();
        const trailing = event.key === "Enter" ? "\n" : event.key === " " ? " " : "";

        onSmartTextCommand({
          commandKey,
          insertReplacement: (replacement: string, trailingStr: string) => {
            const tr = view.state.tr
              .delete(commandStart, from)
              .insertText(replacement + trailingStr, commandStart);
            view.dispatch(tr);
          },
        });

        // Eagerly insert trailing so the editor doesn't feel blocked
        if (trailing) {
          const tr = view.state.tr.insertText(trailing, from);
          view.dispatch(tr);
        }

        return true;
      },
    },
    immediatelyRender: false,
  });

  // Sync external value changes (e.g. SOAP rewrite, transcription import)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  return (
    <div
      className={cn(
        "border rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-ring",
        className
      )}
    >
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/40">
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={editor?.isActive("bold") ?? false}
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={editor?.isActive("italic") ?? false}
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={editor?.isActive("bulletList") ?? false}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          active={editor?.isActive("orderedList") ?? false}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        className="rich-text-content px-3 py-2 text-sm"
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "p-1 rounded transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {children}
    </button>
  );
}
