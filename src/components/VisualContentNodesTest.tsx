import { Node } from "./Node";
export const VisualContentNodesTest = () => {
  return (
    <>
      {/* Row 1: SVG Icons */}
      <Node id="svg-1" type="test" position={{ x: -300, y: -150 }} 
        data={{ label: "Database"}}
        visual={{ color: "#10b981", shape: "rectangle", size: { width: 120, height: 80 }, visualContent: { type: 'svg', content: '<rect width="20" height="16" fill="currentColor"/><path d="M0 8h20M0 12h20" stroke="white"/>', size: {width: 32, height: 32} }}} />
      
      
      <Node id="svg-3" type="test" position={{ x: 100, y: -150 }} 
        data={{ label: "API"}}
        visual={{ color: "#8b5cf6", shape: "hexagon", size: { width: 120, height: 120 }, visualContent: { type: 'svg', content: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8 12h8M12 8v8" stroke="white"/>', size: {width: 32, height: 32} }}} />

      {/* Row 2: Emojis */}
      <Node id="emoji-1" type="test" position={{ x: -300, y: 0 }} 
        data={{ label: "User", }}
        visual={{ color: "#f59e0b", shape: "circle", size: { width: 100, height: 100 }, visualContent: { type: 'emoji', content: '👤', size: {width: 48, height: 48}}} } />
        
      <Node id="emoji-2" type="test" position={{ x: -100, y: 0 }} 
        data={{ label: "Mobile" }}
        visual={{ color: "#06b6d4", shape: "roundedRectangle", size: { width: 110, height: 70 }, visualContent: { type: 'emoji', content: '📱', size: {width: 48, height: 48} }}} />
        
      <Node id="emoji-3" type="test" position={{ x: 100, y: 0 }} 
        data={{ label: "Cloud"}}
        visual={{ color: "#6b7280", shape: "oval", size: { width: 130, height: 80 }, visualContent: { type: 'emoji', content: '☁️', size: {width: 48, height: 48}} }}/>

      {/* Row 3: Images */}
      <Node id="img-1" type="test" position={{ x: -300, y: 150 }} 
        data={{ label: "Docker", }}
        visual={{ color: "#0ea5e9", shape: "rectangle", size: { width: 120, height: 80 }, visualContent: { type: 'image', content: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg', size: {width: 64, height: 64 }} }}/>
        
    </>
  );
};