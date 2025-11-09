import { NativeSelect } from "@mantine/core";
import { type DiagramFont, DIAGRAM_FONTS } from "../utils/FontLoadUtils";

interface FontPickerProps {
  value: DiagramFont;
  onChange: (font: DiagramFont) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  return (
    <NativeSelect
      w={150}
      dir=""
      title='Select Font'
      label='Font'
      value={value}
      onChange={(e) => onChange(e.target.value as DiagramFont)}
      className="font-picker"
    >
      {DIAGRAM_FONTS.map(font => (
        <option 
          key={font} 
          value={font}
          style={{ fontFamily: font }}
        >
          {font}
        </option>
      ))}
    </NativeSelect>
  );
}