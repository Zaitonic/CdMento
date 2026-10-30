import { useState, useEffect, useRef } from "react";
import { Plus, Save, Download } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { useStore } from "../../store";
import { api, json } from "../../api";
import { Title, Evidence, useArtifacts } from "../study/StudyShared";

export default function MindMap() {
  const a = useArtifacts("mindmap");
  const s = useStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const flow = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    api(`/notebooks/${s.active}/mind-map`)
      .then((map) => {
        if (cancelled) return;
        revision.current = map.revision;
        setNodes(
          map.nodes.length
            ? map.nodes
            : [
                {
                  id: "root",
                  position: { x: 250, y: 160 },
                  data: {
                    label:
                      s.notebooks.find((n) => n.id === s.active)?.name ||
                      "My notebook",
                  },
                  style: {
                    background: "#6655f5",
                    color: "white",
                    borderRadius: 14,
                  },
                },
              ],
        );
        setEdges(map.edges);
        setDirty(false);
        if (map.viewport) flow.current?.setViewport(map.viewport);
      })
      .catch((e) => toast.error(e.message));
    return () => {
      cancelled = true;
    };
  }, [s.active]);
  async function save() {
    setSaving(true);
    try {
      const result = await api(`/notebooks/${s.active}/mind-map`, {
        method: "PUT",
        body: json({
          nodes,
          edges,
          viewport: flow.current?.getViewport() || null,
          revision: revision.current,
        }),
      });
      revision.current = result.revision;
      setDirty(false);
      toast.success("Map saved.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  function applyGenerated() {
    if (!a.artifact) return;
    setNodes(
      a.artifact.nodes.map((node: any, i: number) => ({
        id: node.id,
        position: { x: (i % 3) * 250, y: Math.floor(i / 3) * 130 },
        data: { label: node.label, source_ids: node.source_ids },
        style: {
          borderRadius: 12,
          background: "var(--surface)",
          color: "var(--text)",
        },
      })),
    );
    setEdges(
      a.artifact.edges.map((edge: any, i: number) => ({
        ...edge,
        id: "generated-" + i,
        type: "smoothstep",
      })),
    );
    setDirty(true);
    toast.info(
      "Generated concepts added. Save when you’re happy with the map.",
    );
  }
  const node = nodes.find((n) => n.id === selected);
  return (
    <section className="feature-screen mindmaps-screen">
      <Title
        label="CONCEPTS / CONNECTION CANVAS"
        title="Find the connections"
        desc="Arrange your ideas, connect concepts, and keep the evidence nearby."
      />
      {a.controls}
      {a.artifact && (
        <button className="secondary" onClick={applyGenerated}>
          Use generated concept map
        </button>
      )}
      <div className="map-toolbar">
        <input
          aria-label="New concept"
          placeholder="Add a concept…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="secondary"
          disabled={!label.trim()}
          onClick={() => {
            setNodes((old) => [
              ...old,
              {
                id: crypto.randomUUID(),
                position: { x: 80 + old.length * 25, y: 80 + old.length * 15 },
                data: { label: label.trim() },
                style: {
                  background: "var(--surface)",
                  color: "var(--text)",
                  borderRadius: 12,
                },
              },
            ]);
            setLabel("");
            setDirty(true);
          }}
        >
          <Plus size={15} />
          Add
        </button>
        <button className="primary" disabled={saving} onClick={save}>
          <Save size={15} />
          {saving ? "Saving…" : dirty ? "Save changes" : "Save map"}
        </button>
        <button
          className="secondary"
          onClick={() => {
            const exportData = {
              notebook: s.active,
              nodes,
              edges,
              viewport: flow.current?.getViewport() || null,
              exported_at: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `mindmap-${s.active}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("Mind map exported.");
          }}
        >
          <Download size={14} />
          Export map
        </button>
      </div>
      <div className="mindmap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={(instance) => {
            flow.current = instance;
          }}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            if (
              changes.some(
                (c) => c.type !== "select" && c.type !== "dimensions",
              )
            )
              setDirty(true);
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            setDirty(true);
          }}
          onConnect={(connection) => {
            setEdges((old) => addEdge(connection, old));
            setDirty(true);
          }}
          onNodeClick={(_, node) => setSelected(node.id)}
          fitView
        >
          <Background color="#bfb6d0" gap={24} />
          <Controls />
          <MiniMap pannable zoomable nodeColor="var(--primary)" />
        </ReactFlow>
      </div>
      {node && (
        <div className="selected-concept">
          <input
            aria-label="Concept label"
            value={String(node.data.label)}
            onChange={(e) => {
              setNodes((old) =>
                old.map((n) =>
                  n.id === selected
                    ? { ...n, data: { ...n.data, label: e.target.value } }
                    : n,
                ),
              );
              setDirty(true);
            }}
          />
          <button
            className="secondary"
            onClick={() => {
              setNodes((old) => old.filter((n) => n.id !== selected));
              setEdges((old) =>
                old.filter(
                  (e) => e.source !== selected && e.target !== selected,
                ),
              );
              setSelected("");
              setDirty(true);
            }}
          >
            Remove concept
          </button>
          <Evidence ids={(node.data.source_ids as string[]) || []} />
        </div>
      )}
      <p className="small-print">
        Drag nodes to arrange them. Connect the dots on nodes to add
        relationships. Save to keep your changes.
      </p>
    </section>
  );
}
