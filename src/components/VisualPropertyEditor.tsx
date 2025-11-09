import { useCallback, useEffect, useState } from "react";
import { useDiagram } from "./DiagramProvider"
import { ColorInput, TextInput } from "@mantine/core";
import type { DiagramNode } from "../types";
import { FontPicker } from "./FontPicker";
import type { DiagramFont } from "../utils/FontLoadUtils";

export default function VisualPropertyEditor() {
    const {interaction, updateNode, setFocusedOnInput, focusedOnInput} = useDiagram();
    const [nodeHexValue, setNodeHexValue] = useState('');
    const [textHexValue, setTextHexValue] = useState('');
    const [nodeLabelValue, setNodeLabelValue] = useState('');


    useEffect(() => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0].visual)  {
            setNodeHexValue(interaction.selectedNodes[0].visual!.color as string)

            setTextHexValue(interaction.selectedNodes[0].visual!.labelColor as string)
            if (interaction.selectedNodes[0].visual?.shape === 'none' && interaction.selectedNodes[0].visual.visualContent?.colorizable) {
                setNodeHexValue(interaction.selectedNodes[0].visual!.iconColor as string || '#ffffff');
            }
        }

        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0].data.label) {
            setNodeLabelValue(interaction.selectedNodes[0].data.label);
        }

    }, [interaction.selectedNodes, setNodeHexValue, setTextHexValue, setNodeLabelValue]);

    const handleNodeColorChange = useCallback((hexValue: string) => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0]) {
            const updatedNode: DiagramNode = {...interaction.selectedNodes[0]}

            if ((interaction.selectedNodes[0].visual?.shape === 'none' && interaction.selectedNodes[0].visual.visualContent?.colorizable)) {
                updatedNode.visual!.iconColor = hexValue;
            }
            else {
            updatedNode.visual!.color = hexValue;
            }
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

    const onChangeFont = useCallback((font: DiagramFont) => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0]) {
            const updatedNode: DiagramNode = {...interaction.selectedNodes[0]}
            updatedNode.visual!.labelFont = font;
            updateNode(updatedNode);
        }
    }, [interaction.selectedNodes, updateNode]);

    const onChangeLabel = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (interaction.selectedNodes.length > 0 && interaction.selectedNodes[0]) {
            const updatedNode: DiagramNode = {...interaction.selectedNodes[0]}
            updatedNode.data.label = e.currentTarget.value;
            setNodeLabelValue(e.currentTarget.value);
            updateNode(updatedNode);
        }

    },[interaction.selectedNodes, updateNode, nodeLabelValue, setNodeLabelValue]);

    const onFocusTextInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {

        console.log('text input focus triggered...', e.currentTarget);
        if (!focusedOnInput) setFocusedOnInput(true);
    }, [setFocusedOnInput, focusedOnInput]);


    return (
    <>
    {interaction.selectedNodes.length > 0 && (
        <div>
            <h3>Visual properties:</h3>
            
            {interaction.selectedNodes[0].data && (<div><div><FontPicker onChange={onChangeFont} value={interaction.selectedNodes[0].visual!.labelFont as DiagramFont}/></div><div><ColorInput title='label text color hex value' label='text color' pb={10} w={150} fixOnBlur={false}  value={textHexValue} defaultValue='#ffffff' 
            onChange={handleTextColorChange} /></div>
            </div>
            )}
            {((interaction.selectedNodes[0].visual?.shape === 'none' && interaction.selectedNodes[0].visual.visualContent?.colorizable) || (interaction.selectedNodes[0].visual?.shape !== 'none')) && (<ColorInput title='node color hex value' pb={10} label='node color' w={150} fixOnBlur={false} value={nodeHexValue} defaultValue='#ffffff'
            onChange={handleNodeColorChange} />)}
            {interaction.selectedNodes[0] && (<div><TextInput onFocus={onFocusTextInput} w={150} label='label' defaultValue={nodeLabelValue} value={nodeLabelValue} onChange={onChangeLabel} /></div>)}


            


        </div>)}
        
    </>);
        
    
}
