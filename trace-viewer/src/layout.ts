/**
 * Dagre layout for the React Flow canvas. The caller passes the spine nodes
 * in append order along with every edge that should constrain ranking: the
 * visible chain links (time order, older above newer) and any real supports
 * edges between spine records. Review nodes fork off horizontally and are
 * positioned by the caller, not dagre.
 */
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 72;

/** Horizontal gap between a spine record and a review node forked from it. */
export const REVIEW_GAP = 56;

export function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
	const graph = new dagre.graphlib.Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 48, marginx: 16, marginy: 16 });
	for (const node of nodes) {
		graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	}
	for (const edge of edges) {
		graph.setEdge(edge.source, edge.target);
	}
	dagre.layout(graph);
	return nodes.map((node) => {
		const positioned = graph.node(node.id);
		return {
			...node,
			position: { x: positioned.x - NODE_WIDTH / 2, y: positioned.y - NODE_HEIGHT / 2 },
		};
	});
}
