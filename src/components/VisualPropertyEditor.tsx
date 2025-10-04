import { useCallback, useEffect, useState } from "react";
import { useDiagram } from "./DiagramProvider"
import { ColorInput } from "@mantine/core";
import type { DiagramNode } from "../types";

export default function VisualPropertyEditor() {
    const {interaction, updateNode} = useDiagram();
    const [nodeHexValue, setNodeHexValue] = useState('');
    const [textHexValue, setTextHexValue] = useState('');


    useEffect(() => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0].visual)  {
            setNodeHexValue(interaction.selectedNodes[0].visual!.color as string)
            setTextHexValue(interaction.selectedNodes[0].visual!.labelColor as string)
        }
    }, [interaction.selectedNodes, setNodeHexValue, setTextHexValue]);

    const handleNodeColorChange = useCallback((hexValue: string) => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0]) {
            const updatedNode: DiagramNode = {...interaction.selectedNodes[0]}
            updatedNode.visual!.color = hexValue;
            updateNode(updatedNode);
        }


    }, [nodeHexValue, interaction.selectedNodes, updateNode]);


        const handleTextColorChange = useCallback((hexValue: string) => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0]) {
            const updatedNode: DiagramNode = {...interaction.selectedNodes[0]}
            updatedNode.visual!.labelColor = hexValue;
            updateNode(updatedNode);
        }


    }, [nodeHexValue, interaction.selectedNodes, updateNode]);


    return (
    <>
    {interaction.selectedNodes.length > 0 && (
        <div style={{margin: 50}} className='is-over-viewport-unselectable'>
            <h3>Visual properties:</h3>
            <ColorInput title='Node color' pb={10} label='Node color' w={150} fixOnBlur={false} value={nodeHexValue} defaultValue='#ffffff'
            onChange={handleNodeColorChange} />

            <ColorInput title='Label text color' label='Text color' w={150} fixOnBlur={false}  value={textHexValue} defaultValue='#ffffff' 
            onChange={handleTextColorChange} />


        </div>)}
        
    </>);
        
    
}
