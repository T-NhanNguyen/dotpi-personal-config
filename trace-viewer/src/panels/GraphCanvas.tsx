import { useMemo } from "react";
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNodeData, TraceGraph } from "../api";
import { kindColor } from "../kinds";
import { NODE_HEIGHT, NODE_WIDTH, layoutGraph } from "../layout";

interface RecordNodeData extends Record<string, unknown> {
	record: GraphNodeData;
	dimmed: boolean;
	highlighted: boolean;
}

type RecordNodeType = Node<RecordNodeData, "record">;

function RecordNode({ data, selected }: NodeProps<RecordNodeType>) {
	const { record } = data;
	return (
		<div
			className="record-node"
			style={{
				width: NODE_WIDTH,
				minHeight: NODE_HEIGHT,
				borderLeftColor: kindColor(record.kind),
				opacity: data.dimmed ? 0.35 : 1,
				outline: data.highlighted ? "2px solid #ffcb6b" : undefined,
				outlineOffset: 2,
			}}
		>
			<Handle type="target" position={Position.Top} />
			<div className="record-node-head">
				<span className="record-kind" style={{ color: kindColor(record.kind) }}>
					{record.kind}
				</span>
				<span className="record-id">{record.id}</span>
				{selected ? <span className="record-selected">●</span> : null}
			</div>
			<div className="record-title">{record.title}</div>
			{record.failureClass ? <div className="record-failure">{record.failureClass}</div> : null}
			<Handle type="source" position={Position.Bottom} />
		</div>
	);
}

const nodeTypes = { record: RecordNode };

export function GraphCanvas({
	graph,
	selectedId,
	onSelect,
	hideDeadends,
	activePattern,
}: {
	graph: TraceGraph | null;
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	hideDeadends: boolean;
	activePattern: string | null;
}) {
	const { nodes, edges } = useMemo(() => {
		if (!graph) return { nodes: [], edges: [] };
		const visible = new Set(graph.nodes.filter((node) => !hideDeadends || node.kind !== "deadend").map((node) => node.id));
		const flowEdges: Edge[] = graph.edges
			.filter((edge) => visible.has(edge.source) && visible.has(edge.target))
			.map((edge) => {
				const source = graph.nodes.find((node) => node.id === edge.source);
				const accent = activePattern !== null && source?.failureClass === activePattern;
				return {
					id: `${edge.source}->${edge.target}`,
					source: edge.source,
					target: edge.target,
					style: { stroke: accent ? "#ffcb6b" : "#4a5568", strokeWidth: accent ? 2 : 1 },
					markerEnd: { type: MarkerType.ArrowClosed, color: accent ? "#ffcb6b" : "#4a5568" },
				};
			});
		const flowNodes: Node[] = graph.nodes
			.filter((node) => visible.has(node.id))
			.map((node) => ({
				id: node.id,
				type: "record",
				position: { x: 0, y: 0 },
				data: {
					record: node,
					dimmed: node.kind === "deadend" && !hideDeadends,
					highlighted: activePattern !== null && node.failureClass === activePattern,
				},
			}));
		return { nodes: layoutGraph(flowNodes, flowEdges), edges: flowEdges };
	}, [graph, hideDeadends, activePattern]);

	return (
		<div className="graph-canvas">
			{graph ? (
				<ReactFlow
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					fitView
					nodesDraggable={false}
					onNodeClick={(_, node) => onSelect(node.id)}
					onPaneClick={() => onSelect(null)}
					proOptions={{ hideAttribution: true }}
				/>
			) : (
				<div className="placeholder">No trace loaded.</div>
			)}
		</div>
	);
}
