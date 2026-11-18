export const Z_LAYERS = {
  HANDLES: -0.6,
  LABELS: -0.5,    
  VISUALS: -0.7,
  NODES: -0.75,    
  EDGES: -0.77,      
  BACKGROUND: -1,       
};

// Larger z is nearer. Nested nodes (see Nesting) get one band of NEST_STEP per
// level above NODES, so a child is always drawn in front of its container:
//   node body < its visual content < markers at its edge < edges one level in
// and the next level's bodies come after all of those. MAX_NESTING levels stay
// below HANDLES and LABELS, which are drawn on top of everything.
const NEST_STEP = 0.01;

/** A node body at nesting depth `depth`. */
export const nodeZ = (depth: number) => Z_LAYERS.NODES + depth * NEST_STEP;
/** SVG or image content (or an icon) of a node at `depth`. */
export const visualZ = (depth: number) => nodeZ(depth) + 0.004;
/** A marker where an edge meets a node at `depth`: over the node, so the node never hides it. */
export const markerZ = (depth: number) => nodeZ(depth) + 0.006;
/**
 * An edge between nodes at these depths: in front of the containers of its
 * deeper end, behind the bodies at that end's own level. Between top-level
 * nodes that is behind every node, as edges always were.
 */
export const edgeZ = (sourceDepth: number, targetDepth: number) =>
  nodeZ(Math.max(sourceDepth, targetDepth) - 1) + 0.008;
