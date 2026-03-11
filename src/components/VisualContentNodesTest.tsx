import { Edge } from "./Edge";
import { Node } from "./Node";

export const VisualContentNodesTest = () => {
  
  return (
    <>
      {/* Test Emojis */}
      <Node 
        id="some-actor" 
        type="test" 
        position={{ x: 0, y: 0 }} 
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
        id="some-database" 
        type="Database" 
        position={{ x: 500, y: 100 }} 
        data={{ label: "Jeffrey JewSteam" }}
        visual={{ 
          labelColor: "#ffffff",
          iconColor: "#000000",
          shape: "none", 
          visualContent: {
            type: 'image',
            content: `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRCzrGXuK5pn3hXMFMosfpBjhFMrnL_hHpNZg&s`,
            size: { width: 256, height: 256 },
            colorizable: true

          },
        }} 
      />

 <Node 
        id="targetTest" 
        type="test" 
        position={{ x: 0, y: -100 }} 
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

      <Edge id='bye' data={{label: 'queries'}} sourceNodeId="some-actor" targetNodeId="targetTest" userVertices={[]} style={{color: [0,0,0,1], labelColor: '#ffffff', thickness: 3, sourceMarker: 'filled-arrow', targetMarker: 'filled-arrow'}}/>

    </>
  );
};