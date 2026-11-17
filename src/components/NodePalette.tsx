import { useMemo, useState, type CSSProperties } from 'react';
import { Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useDiagram } from './DiagramProvider';
import { DEFAULT_PALETTE, TEMPLATE_MIME, type NodeTemplate } from '../utils/NodeTemplates';

/** Above this many entries the palette gets a filter box. */
const FILTER_THRESHOLD = 8;

/**
 * The node types this diagram offers: the loaded file's palette, or the default one.
 * Click (or tap) adds a node at the centre of the view; drag drops it where you let go.
 */
export default function NodePalette() {
  const { palette, addNodeFromTemplate } = useDiagram();
  const templates = palette ?? DEFAULT_PALETTE;
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byGroup = new Map<string, NodeTemplate[]>();
    for (const t of templates) {
      if (q && !`${t.label} ${t.group ?? ''}`.toLowerCase().includes(q)) continue;
      const key = t.group ?? '';
      byGroup.set(key, [...(byGroup.get(key) ?? []), t]);
    }
    return [...byGroup];
  }, [templates, filter]);

  return (
    <div style={{ padding: 12, borderBottom: '1px solid #444' }}>
      <Text fw={600} mb={4}>Add node</Text>
      {templates.length > FILTER_THRESHOLD && (
        <TextInput size="xs" mb={8} placeholder="Filter node types" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} />
      )}
      {groups.length === 0 && <Text size="sm" c="dimmed">No node types match.</Text>}
      {groups.map(([group, items]) => (
        <div key={group} style={{ marginBottom: 8 }}>
          {group && <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>{group}</Text>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6 }}>
            {items.map(t => (
              <Tooltip key={t.id} label="Click to add, or drag onto the canvas" openDelay={600} events={{ hover: true, focus: false, touch: false }}>
                <UnstyledButton
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TEMPLATE_MIME, JSON.stringify(t));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addNodeFromTemplate(t)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '8px 4px', minHeight: 64, borderRadius: 6,
                    border: '1px solid #444', background: '#2a2a2a', cursor: 'grab',
                  }}
                >
                  <TemplatePreview template={t} />
                  <Text size="xs" ta="center" lineClamp={1} style={{ maxWidth: '100%' }}>{t.label}</Text>
                </UnstyledButton>
              </Tooltip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A small stand-in for how the node will look: its SVG, emoji, or outline shape. */
function TemplatePreview({ template }: { template: NodeTemplate }) {
  const { visual } = template;
  const color = visual.color ?? '#3b82f6';
  const box: CSSProperties = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' };

  const content = visual.visualContent;
  if (content?.type === 'svg' || content?.type === 'image') {
    // Like the canvas: an SVG that is the whole node takes the node colour when tinted,
    // one drawn on a shape takes the icon colour, so it stays visible on the fill.
    const ink = visual.shape === 'none' && content.colorizable ? color : (visual.iconColor ?? '#111111');
    const svg = content.type === 'svg' ? content.content.replace(/currentColor/g, ink) : content.content;
    const src = content.type === 'svg' ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : content.content;
    return (
      <div style={{ ...box, position: 'relative' }}>
        {visual.shape !== 'none' && <ShapeSwatch shape={visual.shape} color={color} />}
        <img src={src} alt="" draggable={false} style={{ position: 'absolute', width: 20, height: 20, objectFit: 'contain' }} />
      </div>
    );
  }
  if (visual.icon) return <div style={{ ...box, fontSize: 20 }}>{visual.icon}</div>;
  return <div style={box}><ShapeSwatch shape={visual.shape} color={color} /></div>;
}

function ShapeSwatch({ shape = 'rectangle', color }: { shape?: string; color: string }) {
  const base: CSSProperties = { width: 26, height: 18, background: color, borderRadius: 2 };
  switch (shape) {
    case 'circle': case 'initialNode': return <div style={{ ...base, width: 22, height: 22, borderRadius: '50%' }} />;
    case 'finalNode': return <div style={{ ...base, width: 14, height: 14, borderRadius: '50%', outline: `2px solid ${color}`, outlineOffset: 3 }} />;
    case 'oval': return <div style={{ ...base, borderRadius: '50%' }} />;
    case 'diamond': return <div style={{ ...base, width: 18, height: 18, transform: 'rotate(45deg)' }} />;
    case 'roundedRectangle': return <div style={{ ...base, borderRadius: 6 }} />;
    case 'hexagon': return <div style={{ ...base, clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' }} />;
    case 'package': return <div style={{ ...base, clipPath: 'polygon(0 0, 45% 0, 45% 22%, 100% 22%, 100% 100%, 0 100%)' }} />;
    case 'actor': return (
      <svg width="18" height="24" viewBox="0 0 18 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <circle cx="9" cy="5" r="3.5" /><path d="M9 9v7M3 12h12M9 16l-5 6M9 16l5 6" />
      </svg>
    );
    case 'none': return null;
    default: return <div style={base} />;
  }
}
