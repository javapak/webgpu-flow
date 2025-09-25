import { Node } from "./Node";

export const VisualContentNodesTest = () => {
  return (
    <>
      {/* Test Emojis */}
      <Node 
        id="emoji-test-1" 
        type="test" 
        position={{ x: -200, y: -100 }} 
        data={{ label: "User" }}
        visual={{ 
          color: "#f59e0b", 
          shape: "circle", 
          size: { width: 100, height: 100 },
          visualContent: { 
            type: 'emoji', 
            content: '👤', 
            size: { width: 48, height: 48 }
          }
        }} 
      />
      
      <Node 
        id="emoji-test-2" 
        type="test" 
        position={{ x: 0, y: -100 }} 
        data={{ label: "Database" }}
        visual={{ 
          color: "#10b981", 
          shape: "rectangle", 
          size: { width: 120, height: 80 },
          visualContent: { 
            type: 'emoji', 
            content: '🗄️', 
            size: { width: 1000, height: 1000 }
          }
        }} 
      />

      <Node 
        id="emoji-test-3" 
        type="test" 
        position={{ x: 200, y: -100 }} 
        data={{ label: "Cloud" }}
        visual={{ 
          color: "#06b6d4", 
          shape: "oval", 
          size: { width: 130, height: 80 },
          visualContent: { 
            type: 'emoji', 
            content: '☁️', 
            size: { width: 48, height: 48 }
          }
        }} 
      />

      {/* Test Simple SVGs */}
      <Node 
        id="svg-test-1" 
        type="test" 
        position={{ x: -200, y: 100 }} 
        data={{ label: "API" }}
        visual={{ 
          color: "#8b5cf6", 
          shape: "hexagon", 
          size: { width: 120, height: 120 },
          visualContent: { 
            type: 'svg', 
            content: '<circle cx="16" cy="16" r="12" fill="currentColor"/><path d="M12 16h8M16 12v8" stroke="white" stroke-width="2"/>', 
            size: { width: 32, height: 32 }
          }
        }} 
      />

      <Node 
        id="svg-test-2" 
        type="test" 
        position={{ x: 0, y: 100 }} 
        data={{ label: "Server" }}
        visual={{ 
          color: "#ef4444", 
          shape: "rectangle", 
          size: { width: 120, height: 80 },
          visualContent: { 
            type: 'svg', 
            content: '<rect x="4" y="4" width="24" height="16" fill="currentColor" rx="2"/><rect x="4" y="12" width="24" height="4" fill="white"/>', 
            size: { width: 32, height: 32 }
          }
        }} 
      />

      {/* Test Image placeholder */}
      <Node 
        id="image-test-1" 
        type="test" 
        position={{ x: 200, y: 100 }} 
        data={{ label: "External Service" }}
        visual={{ 
          color: "#6366f1", 
          shape: "roundedRectangle", 
          size: { width: 140, height: 80 },
          visualContent: { 
            type: 'image', 
            content: 'https://via.placeholder.com/64x64/4f46e5/ffffff?text=API', 
            size: { width: 48, height: 48 }
          }
        }} 
      />
    </>
  );
};