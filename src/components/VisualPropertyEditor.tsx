import { useDiagram } from "./DiagramProvider"
export default function VisualPropertyEditor() {
    const {interaction} = useDiagram();

    return (
    <>
    {interaction.selectedNodes.length > 0 && (
        <div>
            <h3>Visual properties:</h3>
        </div>)}
        
    </>);
        
    
}
