import { useMemo } from "react";
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphNodeData, TraceGraph } from "../api";
import { kindColor } from "../kinds";
import { NODE_HEIGHT, NODE_WIDTH, REVIEW_GAP, layoutGraph } from "../layout";

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
			{/* Invisible side anchors for review branch edges. */}
			<Handle type="target" position={Position.Left} id="left" />
			<Handle type="source" position={Position.Right} id="right" />
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

		// API edge direction: record -> the earlier records it supports. Display
		// direction flips this so arrows flow forward in time (older -> newer).
		// A review with at least one visible target forks off the spine like a
		// branch; a review with no targets stays on the timeline.
		const reviewTargets = new Map<string, string[]>();
		for (const edge of graph.edges) {
			if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
			reviewTargets.set(edge.source, [...(reviewTargets.get(edge.source) ?? []), edge.target]);
		}
		const isForkedReview = (id: string) =>
			graph.nodes.some((node) => node.id === id && node.kind === "review") && reviewTargets.has(id);

		const spineRecords = graph.nodes.filter((node) => visible.has(node.id) && !isForkedReview(node.id));
		const forkedReviews = graph.nodes.filter((node) => visible.has(node.id) && isForkedReview(node.id));
		const spineIds = new Set(spineRecords.map((node) => node.id));

		const toFlowNode = (node: (typeof graph.nodes)[number]): Node => ({
			id: node.id,
			type: "record",
			position: { x: 0, y: 0 },
			data: {
				record: node,
				dimmed: node.kind === "deadend" && !hideDeadends,
				highlighted: activePattern !== null && node.failureClass === activePattern,
			},
		});

		// Chain links make the time order visible: a muted straight line between
		// consecutive spine records, no arrowhead, since sequence is not a claim.
		const chainEdges: Edge[] = spineRecords.slice(1).map((node, index) => ({
			id: `chain:${spineRecords[index].id}->${node.id}`,
			source: spineRecords[index].id,
			target: node.id,
			style: { stroke: "#313a4a", strokeWidth: 1 },
		}));

		const supportsEdges: Edge[] = graph.edges
			.filter((edge) => spineIds.has(edge.source) && spineIds.has(edge.target))
			.map((edge) => {
				const from = graph.nodes.find((node) => node.id === edge.target);
				const to = graph.nodes.find((node) => node.id === edge.source);
				const accent =
					activePattern !== null && (from?.failureClass === activePattern || to?.failureClass === activePattern);
				return {
					id: `${edge.source}->${edge.target}`,
					source: edge.target,
					target: edge.source,
					style: { stroke: accent ? "#ffcb6b" : "#4a5568", strokeWidth: accent ? 2 : 1 },
					markerEnd: { type: MarkerType.ArrowClosed, color: accent ? "#ffcb6b" : "#4a5568" },
				};
			});

		// Branch links run from a spine record's right side into the review that
		// targets it, in the review kind color.
		const branchEdges: Edge[] = forkedReviews.flatMap((review) =>
			(reviewTargets.get(review.id) ?? []).map((target) => ({
				id: `branch:${target}->${review.id}`,
				source: target,
				sourceHandle: "right",
				target: review.id,
				targetHandle: "left",
				type: "straight",
				style: { stroke: "#f78c6c", strokeWidth: 1.5 },
				markerEnd: { type: MarkerType.ArrowClosed, color: "#f78c6c" },
			})),
		);

		const positioned = layoutGraph(spineRecords.map(toFlowNode), [...chainEdges, ...supportsEdges]);
		const positionById = new Map(positioned.map((node) => [node.id, node.position]));

		// Fork each review sideways from its first target; reviews sharing a
		// target cascade downward so they never overlap.
		const slotsUsed = new Map<string, number>();
		const reviewNodes: Node[] = forkedReviews.map((review) => {
			const primaryId = reviewTargets.get(review.id)![0];
			const anchor = positionById.get(primaryId) ?? { x: 0, y: 0 };
			const slot = slotsUsed.get(primaryId) ?? 0;
			slotsUsed.set(primaryId, slot + 1);
			return {
				...toFlowNode(review),
				position: { x: anchor.x + NODE_WIDTH + REVIEW_GAP, y: anchor.y + slot * (NODE_HEIGHT + 16) },
			};
		});

		return { nodes: [...positioned, ...reviewNodes], edges: [...chainEdges, ...supportsEdges, ...branchEdges] };
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
