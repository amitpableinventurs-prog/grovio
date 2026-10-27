import { useEffect, useState, type ReactNode } from 'react';
import { Button, Divider, Input, Modal, Select, Tooltip } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  StrikethroughOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  LinkOutlined,
  LineOutlined,
  ClearOutlined,
  UndoOutlined,
  RedoOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';

// Rich-text editor for admin-authored HTML (Content Pages). Works as an antd Form control: `value`
// and `onChange` are HTML strings. Only what the customer site styles is offered (headings,
// paragraphs, lists, links, bold/italic/underline/strike, a divider); "HTML" shows the raw source.

const BLOCKS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h2', label: 'Heading' },
  { value: 'h3', label: 'Subheading' },
];

function toHtml(editor: Editor) {
  return editor.isEmpty ? '' : editor.getHTML();
}

function ToolButton({ title, icon, active, disabled, onClick }: { title: string; icon: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip title={title}>
      <Button type="text" size="small" icon={icon} className={active ? 'is-active' : undefined} disabled={disabled} onClick={onClick} />
    </Tooltip>
  );
}

export default function RichTextEditor({ value, onChange, placeholder = 'Start writing…' }: { value?: string; onChange?: (html: string) => void; placeholder?: string }) {
  const [source, setSource] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        // Keep links as written (the saved pages use plain mailto: links), no target/rel added.
        link: { openOnClick: false, defaultProtocol: 'https', HTMLAttributes: { target: null, rel: null } },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? '',
    onUpdate: ({ editor }) => onChange?.(toHtml(editor)),
  });

  // Take in content set from outside: the form's initial values, or edits made in the HTML view.
  useEffect(() => {
    if (!source && value !== undefined && value !== toHtml(editor)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value, source]);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      block: editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      link: editor.isActive('link'),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  const setBlock = (block: string) => {
    if (block === 'p') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: block === 'h2' ? 2 : 3 }).run();
  };

  const openLink = () => {
    setLinkUrl(editor.getAttributes('link').href ?? '');
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!url) chain.unsetLink().run();
    else if (editor.state.selection.empty && !state.link) chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    else chain.setLink({ href: url }).run();
    setLinkOpen(false);
  };

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <Select size="small" style={{ width: 120 }} value={state.block} options={BLOCKS} onChange={setBlock} disabled={source} />
        <Divider orientation="vertical" />
        <ToolButton title="Bold (Ctrl+B)" icon={<BoldOutlined />} active={state.bold} disabled={source} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton title="Italic (Ctrl+I)" icon={<ItalicOutlined />} active={state.italic} disabled={source} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton title="Underline (Ctrl+U)" icon={<UnderlineOutlined />} active={state.underline} disabled={source} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolButton title="Strikethrough" icon={<StrikethroughOutlined />} active={state.strike} disabled={source} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Divider orientation="vertical" />
        <ToolButton title="Bullet list" icon={<UnorderedListOutlined />} active={state.bulletList} disabled={source} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolButton title="Numbered list" icon={<OrderedListOutlined />} active={state.orderedList} disabled={source} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolButton title="Link" icon={<LinkOutlined />} active={state.link} disabled={source} onClick={openLink} />
        <ToolButton title="Divider line" icon={<LineOutlined />} disabled={source} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <ToolButton title="Clear formatting" icon={<ClearOutlined />} disabled={source} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
        <Divider orientation="vertical" />
        <ToolButton title="Undo (Ctrl+Z)" icon={<UndoOutlined />} disabled={source || !state.canUndo} onClick={() => editor.chain().focus().undo().run()} />
        <ToolButton title="Redo (Ctrl+Y)" icon={<RedoOutlined />} disabled={source || !state.canRedo} onClick={() => editor.chain().focus().redo().run()} />
        <div style={{ flex: 1 }} />
        <Tooltip title={source ? 'Back to the editor' : 'Edit the HTML source'}>
          <Button type="text" size="small" icon={<CodeOutlined />} className={source ? 'is-active' : undefined} onClick={() => setSource(!source)}>
            HTML
          </Button>
        </Tooltip>
      </div>

      {source ? (
        <Input.TextArea
          variant="borderless"
          autoSize={{ minRows: 18, maxRows: 30 }}
          style={{ fontFamily: 'monospace', fontSize: 13, padding: '12px 16px' }}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
      ) : (
        <EditorContent editor={editor} className="rte-content" />
      )}

      <Modal title={state.link ? 'Edit link' : 'Add link'} open={linkOpen} onOk={applyLink} onCancel={() => setLinkOpen(false)} okText="Apply" destroyOnHidden>
        <Input
          autoFocus
          placeholder="https://example.com or mailto:support@grovio.com"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onPressEnter={applyLink}
        />
        {state.link && (
          <Button type="link" danger style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => { setLinkUrl(''); editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}>
            Remove link
          </Button>
        )}
      </Modal>
    </div>
  );
}
