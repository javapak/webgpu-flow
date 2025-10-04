import { Edge } from "./Edge";
import { Node } from "./Node";

export const VisualContentNodesTest = () => {
  return (
    <>
      {/* Test Emojis */}
      <Node 
        id="some-actor" 
        type="test" 
        position={{ x: -200, y: -100 }} 
        data={{ label: "Actor (User)" }}
        visual={{ 
          labelColor: "#ffffff",
          color: "#f59f0b00", 
          shape: "none", 
          size: { width: 50, height: 50 },
          visualContent: { 
            type: 'emoji', 
            content: '👤', 
            size: { width: 48, height: 48 }
          }
        }} 
      />
      
      




      <Node 
        id="some-server" 
        type="test" 
        position={{ x: -50, y: 100 }} 
        data={{ label: "Server" }}
        visual={{ 
          labelColor: "#ffffff",
          color: "#44efefff", 
          shape: "rectangle", 
          size: { width: 150, height: 100 },
          visualContent: { 
            type: 'emoji', 
            content: '💽', 
            size: { width: 64, height: 64 }
          }
        }} 
      />

      <Node 
        id="some-service" 
        type="test" 
        position={{ x: 150, y: 100 }} 
        data={{ label: "Service" }}
        visual={{ 
          labelColor: "#ffffff",
          color: "#f16363ff", 
          shape: "roundedRectangle", 
          size: { width: 150, height: 150 },
        }} 
      />

      <Edge id='bye' data={{label: 'queries'}} sourceNodeId="some-actor" targetNodeId="some-service" userVertices={[{x: -150, y: -100}, {x: -150 , y: -50}]} style={{color: [0,0,0,1], labelColor: '#ffffff', thickness: 2}}/>

      <Edge id='hi' data={{label: 'hosts'}} sourceNodeId="some-server" targetNodeId="some-service" userVertices={[]} style={{color: [1,1,1,1], labelColor: '#7300ffff', thickness: 2}} />
    </>
  );
};