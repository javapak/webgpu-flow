#  WebGPU Flow 

An interactive flow diagram editor built with **React**, **TypeScript**, and **WebGPU**. Create flow graphs, system diagrams, and visual workflows with hardware-accelerated rendering.

![WebGPU Flow Editor](https://img.shields.io/badge/WebGPU-Enabled-blue) ![React](https://img.shields.io/badge/React-18+-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

### GPU acceleration and performance
- **WebGPU Rendering**: Hardware-accelerated viewport rendering.
- **Spatial Indexing**: Quadtree-based spatial partitioning for efficient hit testing and viewport culling
- **Optimized for Scale**: Handle large diagrams with ease thanks to rendering optimizations

### Customizability
- **Custom Visual Content**: Embed emojis, icons, and custom graphics with texture atlas optimization
- **Flexible Styling**: Full color customization, size control, and visual properties

### Floating Edges + Definable anchor vertices
- **Floating Edge System**: Smooth bezier curves with user-defined control points
- **Smart Connection Points**: Automatic edge-to-shape intersection calculation
- **Interactive Editing**: Add, move, and delete edge vertices with visual handles
- **Edge Labels**: Add descriptive text labels to connections

### Intuitive Interactions
- **Multi-Mode Editing**: Select, pan, draw edges, and edit modes
- **Resize Handles**: 8-point handles for all shapes
- **Drag & Drop**: Drag nodes from palette onto canvas
- **Zoom & Pan**: Smooth viewport navigation with mouse wheel zoom

### Mobile Support (currently not fully featured)
- **Touch Optimized**: Full touch support with pinch-to-zoom and tap interactions
- **Responsive Design**: Adapts to different screen sizes and orientations


### Visual Features
- **Dynamic Grid**: Adaptive grid that adjusts to zoom level
- **Text Labels**: Texture atlas-based text rendering
- **Depth Layering**: Proper z-ordering for overlapping elements
- **Selection Highlighting**: Visual feedback for selected nodes and edges
- **Anti-aliased Shapes**: Smoothed rendering with SDF.


## 📋 Prerequisites

- **Node.js**: 18+ 
- **Browser**: A browser that supports WebGPU which should be most major browsers at this current time. See [here](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status "WebGPU Implementation Status (wiki)") to look into current status.
- **GPU**: Ideally a dedicated one, but you can probably get away with less.

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/javapak/webgpu-flow.git
cd webgpu-flow

# Install dependencies
npm install

# Start development server
npm run dev
```

The editor will be available at `http://localhost:5173`

### Basic Usage

```typescript
import { DiagramProvider, DiagramCanvas, Node, Edge } from './index';

function App() {
  return (
    <DiagramProvider>
      <DiagramCanvas width={800} height={600} />
      
      {/* Add nodes */}
      <Node 
        id="node1" 
        type="process" 
        position={{ x: 0, y: 0 }}
        data={{ label: "Start" }}
        visual={{ color: "#3b82f6", shape: "rectangle" }}
      />

      <Node 
        id="node2" 
        type="process" 
        position={{ x: 200, y: 0 }}
        data={{ label: "End" }}
        visual={{ color: "#3b82f6", shape: "rectangle" }}
      />
      
      {/* Add edges */}
      <Edge 
        id="edge1"
        sourceNodeId="node1"
        targetNodeId="node2"
        userVertices={[]}
        style={{ color: [1, 1, 1, 1], thickness: 2 }}
      />
    </DiagramProvider>
  );
}
```

## Controls

### Desktop
- **Left Click**: Select node/edge
- **Click + Drag**: Move selected node or pan viewport
- **Mouse Wheel**: Zoom in/out
- **E Key**: Toggle edge drawing mode
- **Alt + Drag**: Disable grid snapping
- **Escape**: Exit current mode
- **Drag from Palette**: Add new nodes

### Mobile
- **Tap**: Select node/edge
- **Drag**: Move node or pan viewport
- **Pinch**: Zoom in/out
- **Show Palette**: Access node types
- **Tap + Tap Canvas**: Place node

## Architecture

```
src/
├── components/
│   ├── DiagramCanvas.tsx      # Main canvas component
│   ├── DiagramProvider.tsx    # State management
│   ├── Node.tsx               # Node component
│   ├── Edge.tsx               # Edge component
│   └── NodePalette.tsx        # Node selection palette
├── renderers/
│   ├── WebGPURenderer.ts      # Main GPU renderer
│   ├── LabelRenderer.ts       # Text rendering
│   ├── FloatingEdgeRenderer.ts # Edge rendering
│   └── VisualContentRenderer.ts # Custom content
├── utils/
│   ├── SpatialIndex.ts        # Quadtree spatial indexing
│   ├── MouseInteractions.ts   # Input handling
│   ├── GridSnapping.ts        # Grid snap utilities
│   └── MobileUtils.ts         # Mobile optimization
├── hooks/
│   └── useSpatialIndex.ts     # Spatial index hook
└── types/
    └── index.ts               # TypeScript definitions
```

## Configuration

### Viewport Settings

```typescript
const viewport = {
  x: 0,          // Center X position
  y: 0,          // Center Y position
  zoom: 1.0,     // Zoom level (0.1 - 5.0)
  width: 800,    // Canvas width
  height: 600,   // Canvas height
};
```

### Performance Settings

```typescript
const spatialIndex = {
  maxItems: 10,   // Max items per quadtree node
  maxDepth: 8,    // Max quadtree depth
  bounds: {       // World bounds
    minX: -10000,
    minY: -10000,
    maxX: 10000,
    maxY: 10000,
  },
};
```

## Customization

### Custom Node Shapes:

You have two options:

1. Add your own shapes by extending the shape renderer:
Pass shape key to shader in a template string. This occurs simply by passing to the component. By default if a key doesn't have its own case, you will end up with a rectangle. 
```typescript
// In WebGPURenderer.ts shader
case 10: { // Custom shape
  distance = sdCustomShape(p, vec2<f32>(0.95));
}
```


2. Utilize visual.visualContent prop: visual.visualContent.content with type 'svg' and where the content prop is an svg string. Set visual.shape to 'none' in order for floating edges to use the correct borders with a compute shader approach. You can also use svg primitives through this method for defining simple shapes.
```typescript
<Node
  id="svg-test-node" 
  type="Database"
  position={{ x: 200, y: -100 }} 
  data={{ label: "Database svg test" }}
  visual={{
    shape: 'none',
    size: { width: 130, height: 130 },
    visualContent: { 
      type: 'svg', 
      content: `<svg width="130px" height="130px" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 0C5.53411 0 3.73573 0.227063 2.41295 0.604819C1.75496 0.792725 1.18616 1.02584 0.770363 1.30649C0.372144 1.57528 0 1.96886 0 2.49866V12.4922C0 13.022 0.372144 13.4156 0.770363 13.6844C1.18616 13.965 1.75496 14.1981 2.41295 14.386C3.73573 14.7638 5.53411 14.9908 7.5 14.9908C9.46589 14.9908 11.2643 14.7638 12.587 14.386C13.245 14.1981 13.8138 13.965 14.2296 13.6844C14.6279 13.4156 15 13.022 15 12.4922V2.49866C15 1.96886 14.6279 1.57528 14.2296 1.30649C13.8138 1.02584 13.245 0.792725 12.587 0.604819C11.2643 0.227063 9.46589 0 7.5 0ZM1.26222 2.86383L1.71405 3.07795C2.84095 3.61197 4.98314 3.99872 7.49994 3.99872C10.0167 3.99872 12.1589 3.61197 13.2858 3.07795L13.7377 2.86383L14.1659 3.7675L13.7141 3.98162C12.3912 4.60852 10.0758 4.99872 7.49994 4.99872C4.92408 4.99872 2.60872 4.60852 1.28582 3.98162L0.833984 3.7675L1.26222 2.86383ZM1.71405 8.04816L1.26222 7.83405L0.833984 8.73771L1.28582 8.95183C2.60872 9.57873 4.92408 9.96894 7.49994 9.96894C10.0758 9.96894 12.3912 9.57873 13.7141 8.95183L14.1659 8.73771L13.7377 7.83405L13.2858 8.04816C12.1589 8.58218 10.0167 8.96894 7.49994 8.96894C4.98314 8.96894 2.84095 8.58218 1.71405 8.04816Z" fill="#00ff0dff"/>
                </svg>`,
      size: {width: 130, height: 130}

    }
  }} 
/>
```
### Custom Visual Content

```typescript
<Node
  id="emoji-test-node" 
  type="Test"
  position={{ x: -200, y: -100 }} 
  data={{ label: "Test" }}
  visual={{ 
    visualContent: { 
      type: 'emoji', 
      content: '🚀', 
      size: { width: 64, height: 64 }
    }
  }} 
/>
```

## Known Issues
- **MSAA**: Multisampling settings not yet functional (UI placeholder)
- **Edge Labels**: Positioning may need adjustment for complex paths
- **Mobile touch handling**: Interaction set is behind pointer/mouse implementation

## Roadmap
- [x] **Full svg content support: Define node shapes with an svg string or reference
- [ ] **Edge markers**: Define edge marker by svg/canvas to texture or with primitive shape shaders provided
- [ ] **Multi-selection**: Select and move multiple nodes
- [ ] **Undo/Redo**: Full history management
- [ ] **Export/Import**: JSON diagram serialization
- [ ] **Themes**: Dark/light mode support
- [ ] **Minimap**: Overview navigation
- [ ] **Alignment Guides**: Smart alignment helpers
- [ ] **Auto-layout**: Automatic diagram organization
- [ ] **Collaborative Editing**: Real-time multi-user support

## Contributing

Contributions are welcome! 

### Development Setup

```bash
# Install dependencies
npm install

# Run development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **TypeGPU**
- **Mantine**
- **Fluent UI Icons**
- **Vite**

- **Issues**: [GitHub Issues](https://github.com/javapak/webgpu-flow-editor/issues)
- **Discussions**: [GitHub Discussions](https://github.com/javapak/webgpu-flow-editor/discussions)




If you find this project helpful, please consider giving it a sta.

---

**Built with ❤️ using WebGPU and React**
