import { useCallback, useEffect, useState } from "react";
import { useDiagram } from "./DiagramProvider"
import { ColorInput } from "@mantine/core";
import type { DiagramNode } from "../types";
export default function VisualPropertyEditor() {
    const {interaction, updateNode} = useDiagram();
    const [hexValue, setHexValue] = useState('');

    useEffect(() => {
    if (interaction.selectedNodes.length > 0)
         setHexValue(interaction.selectedNodes[0].visual!.color as string)
    }, [interaction.selectedNodes, setHexValue]);

    const handleChange = useCallback((hexValue: string) => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0]) {
            const updatedNode: DiagramNode = {...interaction.selectedNodes[0]}
            updatedNode.visual!.color = hexValue;
            updateNode(updatedNode);
        }


    }, [hexValue, interaction.selectedNodes, updateNode]);


    return (
    <>
    {interaction.selectedNodes.length > 0 && (
        <div style={{margin: 50}}>
            <h3>Visual properties:</h3>
            <ColorInput w={150} fixOnBlur={false} value={hexValue} defaultValue={'#ffffff'}
            onChange={handleChange}/>
        </div>)}
        
    </>);
        
    
}
