import { useCallback, useEffect, useState } from "react";
import { useDiagram } from "./DiagramProvider"
import { ColorInput, TextInput } from "@mantine/core";
import { FontPicker } from "./FontPicker";
import type { DiagramFont } from "../utils/FontLoadUtils";

export default function VisualPropertyEditor() {
    const {interaction, editNode, setFocusedOnInput, focusedOnInput} = useDiagram();
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

    const selected = interaction.selectedNodes[0];

    const handleNodeColorChange = useCallback((hexValue: string) => {
        if (!selected) return;
        // A tinted SVG that is the whole node is coloured through its icon colour.
        const tintedSvg = selected.visual?.shape === 'none' && selected.visual.visualContent?.colorizable;
        setNodeHexValue(hexValue);
        editNode(selected.id, tintedSvg ? { iconColor: hexValue } : { color: hexValue });
    }, [selected, editNode]);

    const handleTextColorChange = useCallback((hexValue: string) => {
        if (!selected) return;
        setTextHexValue(hexValue);
        editNode(selected.id, { labelColor: hexValue });
    }, [selected, editNode]);

    const onChangeFont = useCallback((font: DiagramFont) => {
        if (selected) editNode(selected.id, { labelFont: font });
    }, [selected, editNode]);

    const onChangeLabel = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (!selected) return;
        setNodeLabelValue(e.currentTarget.value);
        editNode(selected.id, { label: e.currentTarget.value });
    }, [selected, editNode]);

    const onFocusTextInput = useCallback(() => {
        if (!focusedOnInput) setFocusedOnInput(true);
    }, [setFocusedOnInput, focusedOnInput]);


    return (
    <>
    {interaction.selectedNodes.length > 0 && (
        <div>
            
            {interaction.selectedNodes[0].data && (<div><div><FontPicker onChange={onChangeFont} value={interaction.selectedNodes[0].visual!.labelFont as DiagramFont}/></div><div><ColorInput title='label text color hex value' label='text color' pb={10} w={150} fixOnBlur={false}  value={textHexValue ?? ''} 
            onChange={handleTextColorChange} /></div>
            </div>
            )}
            {((interaction.selectedNodes[0].visual?.shape === 'none' && interaction.selectedNodes[0].visual.visualContent?.colorizable) || (interaction.selectedNodes[0].visual?.shape !== 'none')) && (<ColorInput title='node color hex value' pb={10} label='node color' w={150} fixOnBlur={false} value={nodeHexValue ?? ''}
            onChange={handleNodeColorChange} />)}
            {interaction.selectedNodes[0] && (<div><TextInput onFocus={onFocusTextInput} w={150} label='label' value={nodeLabelValue} onChange={onChangeLabel} /></div>)}


            


        </div>)}
        
    </>);
        
    
}
