import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, List, Menu, Modal, Text } from '@mantine/core';
import { ChevronDown16Regular, DocumentAdd20Regular, FolderOpen20Regular, Save20Regular } from '@fluentui/react-icons';
import { useDiagram } from './DiagramProvider';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

interface FileMenuProps {
  /** Phone layout: bigger hit area, pinned bottom-left so it clears the centred toolbar. */
  compact?: boolean;
}

/**
 * New / Open / Save for the diagram file format (utils/DiagramIO).
 * Ctrl/⌘+O and Ctrl/⌘+S work too; Ctrl/⌘+N belongs to the browser.
 */
export default function FileMenu({ compact = false }: FileMenuProps) {
  const { nodes, loadDiagram, serializeDiagram, fitToContent } = useDiagram();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('diagram.json');
  const [report, setReport] = useState<{ title: string; lines: string[] } | null>(null);
  const fitPending = useRef(false);

  // Fit once the opened diagram is committed. The provider syncs the state that
  // fitToContent reads in its own effect, which runs after this one, so wait a frame.
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    requestAnimationFrame(() => fitToContent({ animate: false }));
  }, [nodes, fitToContent]);

  const confirmDiscard = useCallback(
    () => nodes.length === 0 || window.confirm('Discard the current diagram? Unsaved changes will be lost.'),
    [nodes.length]
  );

  const newDiagram = useCallback(() => {
    if (!confirmDiscard()) return;
    loadDiagram({ nodes: [], edges: [] });
    setFileName('diagram.json');
  }, [confirmDiscard, loadDiagram]);

  const openFile = useCallback(() => {
    if (confirmDiscard()) inputRef.current?.click();
  }, [confirmDiscard]);

  const onFileChosen = useCallback(async (file: File | undefined) => {
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch (e) {
      setReport({ title: `Couldn't open ${file.name}`, lines: [`Not valid JSON: ${(e as Error).message}`] });
      return;
    }
    fitPending.current = true;
    const problems = loadDiagram(json);
    setFileName(file.name);
    if (problems.length) setReport({ title: `Opened ${file.name} with ${problems.length} problem${problems.length > 1 ? 's' : ''}`, lines: problems });
  }, [loadDiagram]);

  const save = useCallback(() => {
    const blob = new Blob([JSON.stringify(serializeDiagram(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [serializeDiagram, fileName]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); save(); }
      else if (key === 'o') { e.preventDefault(); openFile(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, openFile]);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          zIndex: 20,
          left: 'max(12px, calc(env(safe-area-inset-left) + 8px))',
          ...(compact
            ? { bottom: 'max(12px, calc(env(safe-area-inset-bottom) + 8px))' }
            : { top: 'max(12px, calc(env(safe-area-inset-top) + 8px))' }),
          padding: 4,
          borderRadius: 10,
          background: 'rgba(30, 30, 30, 0.92)',
          border: '1px solid #444',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(6px)',
          touchAction: 'manipulation',
        }}
      >
        <Menu position={compact ? 'top-start' : 'bottom-start'} shadow="md" width={220}>
          <Menu.Target>
            <Button variant="subtle" color="gray" size={compact ? 'md' : 'sm'} rightSection={<ChevronDown16Regular />}>
              File
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<DocumentAdd20Regular />} onClick={newDiagram}>New diagram</Menu.Item>
            <Menu.Item leftSection={<FolderOpen20Regular />} rightSection={<Text size="xs" c="dimmed">{mod}O</Text>} onClick={openFile}>
              Open…
            </Menu.Item>
            <Menu.Item leftSection={<Save20Regular />} rightSection={<Text size="xs" c="dimmed">{mod}S</Text>} onClick={save}>
              Save
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>{fileName}</Menu.Label>
          </Menu.Dropdown>
        </Menu>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => { void onFileChosen(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}
      />

      {/* body is a centred flex row (index.css), which would place the portalled modal
          after #root, off screen; pin it to the viewport instead. */}
      <Modal opened={report !== null} onClose={() => setReport(null)} title={report?.title} size="lg" lockScroll={false} styles={{ inner: { left: 0 } }}>
        <List size="sm" spacing={4}>
          {report?.lines.map((line, i) => <List.Item key={i}>{line}</List.Item>)}
        </List>
      </Modal>
    </>
  );
}
