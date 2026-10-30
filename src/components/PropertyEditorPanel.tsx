import { Text } from "@mantine/core";
import { useDiagram } from "./DiagramProvider";
import LayoutPanel from "./LayoutPanel";
import VisualPropertyEditor from "./VisualPropertyEditor";

export default function PropertyEditorPanel() {
    const { interaction } = useDiagram();

    return (
        <div style={{ height: '100vh', overflowY: 'auto' }}>
            <LayoutPanel />
            <div style={{ padding: 12 }}>
                <Text fw={600} mb={4}>Properties</Text>
                {interaction.selectedNodes.length === 0 && (
                    <Text size="sm" c="dimmed">Select a node to edit its label, font and colors.</Text>
                )}
                <VisualPropertyEditor />
            </div>
        </div>
    )
}
