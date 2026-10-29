import { knowledgeCards, matchesKnowledgeQuery } from './knowledge.js';

interface GraphNode {
  id: string;
  label: string;
  kind: string;
  category: string;
}
interface GraphEdge {
  from: string;
  to: string;
}
export interface KnowledgeGraphFilters {
  focus: string;
  query: string;
  category: string;
  kind: string;
}

/** Keep the canvas, node list and relation list on the same filtered graph. */
export function filterKnowledgeGraph<Node extends GraphNode, Edge extends GraphEdge>(
  graph: { nodes: Node[]; edges: Edge[] },
  filters: KnowledgeGraphFilters,
) {
  const neighbors = new Set([
    filters.focus,
    ...graph.edges.flatMap((edge) =>
      edge.from === filters.focus ? [edge.to] : edge.to === filters.focus ? [edge.from] : [],
    ),
  ]);
  const nodes = graph.nodes
    .filter((node) => {
      const knowledge =
        node.kind === 'knowledge'
          ? knowledgeCards.find((card) => 'knowledge:' + card.id === node.id)
          : undefined;
      return (
        (!filters.focus || neighbors.has(node.id)) &&
        (filters.category === 'all' || node.category === filters.category) &&
        (filters.kind === 'all' || node.kind === filters.kind) &&
        matchesKnowledgeQuery(node.label + ' ' + node.id, filters.query, [
          node.category,
          ...(knowledge
            ? [knowledge.title, knowledge.category, ...knowledge.aliases, ...knowledge.tags]
            : []),
        ])
      );
    })
    .sort((a, b) => Number(b.id === filters.focus) - Number(a.id === filters.focus));
  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
  };
}
