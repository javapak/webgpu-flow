import { type ElkExtendedEdge } from 'elkjs';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();
const GRID = 50;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export async function applyElkLayout(
    nodes: any[],
    edges: any[],
    options = {}
) {
    const elkNodes = nodes.map(node => ({
        id: node.id,
        width: node.visual.size.width,
        height: node.visual.size.height,
    }));

    const elkEdges = edges.map(edge => ({
        id: edge.id,
        sources: [edge.sourceNodeId],
        targets: [edge.targetNodeId],
    }));

    const graph = {
        id: 'root',
        layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',

        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
        'elk.layered.crossingMinimization.semiInteractive': 'true',

        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',

        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.unnecessaryBendpoints': 'true',
        'elk.layered.mergeEdges': 'false',

        'elk.layered.spacing.nodeNodeBetweenLayers': '400',
        'elk.spacing.nodeNode': '200',
        'elk.spacing.edgeNode': '50',
        'elk.spacing.edgeEdge': '30',
        'elk.layered.spacing.edgeNodeBetweenLayers': '50',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '30',

        // Label handling
        'elk.nodeLabels.placement': 'OUTSIDE H_CENTER V_BOTTOM',
        'elk.considerModelOrder.strategy': 'PREFER_EDGES',

        'elk.layered.thoroughness': '100',
        'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER',
            ...options
        },
        children: elkNodes,
        edges: elkEdges,
    };

    const result = await elk.layout(graph);

    const layoutNodes = nodes.map(node => {
        const elkNode = result.children?.find(n => n.id === node.id);
        if (!elkNode) return node;
        return {
            ...node,
            position: {
                x: snap(elkNode.x ?? 0),
                y: snap(elkNode.y ?? 0),
            }
        };
    });

    const layoutEdges = edges.map(edge => {
        const elkEdge: ElkExtendedEdge | undefined = result.edges?.find(e => e.id === edge.id);
        if (!elkEdge?.sections?.length) return { ...edge, userVertices: [] };

        // ELK gives bend points per section, flatten them all
        const bendPoints = elkEdge.sections.flatMap(section => [
            ...(section.bendPoints ?? [])
        ]).map(p => ({
            x: snap(p.x),
            y: snap(p.y),
        }));

        return { ...edge, userVertices: bendPoints };
    });

    return { nodes: layoutNodes, edges: layoutEdges };
}