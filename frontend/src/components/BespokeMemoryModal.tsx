'use client';

import { useEffect, useState, useRef, ChangeEvent, DragEvent, useCallback } from 'react';
import cytoscape, { Core as CytoscapeInstance, ElementDefinition, LayoutOptions } from 'cytoscape';
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';
const FILE_GRAPH_LIMIT = 320;

interface BespokeMemoryModalProps {
  onClose: () => void;
}

export type BespokeIngestionStatus = 'chunking' | 'chunked' | 'indexing' | 'uploaded' | 'failed';

export interface BespokeGraphMetrics {
  chunk_count?: number | null;
  section_count?: number | null;
  avg_chunk_tokens?: number | null;
  max_chunk_tokens?: number | null;
  [key: string]: unknown;
}

export interface BespokeStatus {
  id: string;
  status: BespokeIngestionStatus;
  statusLabel: string;
  totalFiles: number;
  chunkedFiles: number;
  indexedChunks: number;
  totalChunks: number;
  createdAt: string;
  completedAt: string | null;
  lastIndexedAt: string | null;
  batchName: string | null;
  error: string | null;
  graphMetrics: BespokeGraphMetrics | null;
  graphSyncedAt: string | null;
}

export interface FileGraphNode {
  id: string;
  label: string;
  filePath: string;
  ingestionId: string;
  batchName: string | null;
  createdAt: string;
}

export interface FileGraphEdge {
  id: string;
  source: string;
  target: string;
  ingestionId: string;
}

export interface FileGraphResponse {
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
  meta: {
    nodeCount: number;
    edgeCount: number;
    ingestionCount: number;
  };
}

type UploadStage = 'idle' | 'confirm' | 'uploading';

export function BespokeMemoryModal({ onClose }: BespokeMemoryModalProps) {
  const [fileQueue, setFileQueue] = useState<{ name: string; size: number }[]>([]);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<BespokeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [history, setHistory] = useState<BespokeStatus[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [graphData, setGraphData] = useState<FileGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const allowedExtensions = ['.md'];

  async function loadStatus() {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/status`);
      if (!response.ok) throw new Error('Failed to load status');
      const data = await response.json();
      setStatusData(data.ingestion ?? null);
    } catch (error) {
      console.error('Failed to load memory status', error);
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadHistory(limit = 6) {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/history?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to load history');
      const data = await response.json();
      setHistory(data.history ?? []);
    } catch (error) {
      console.error('Failed to load ingestion history', error);
    } finally {
      setHistoryLoading(false);
    }
  }

  const loadFileGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const params = new URLSearchParams({
        limit: String(FILE_GRAPH_LIMIT)
      });
      const response = await fetch(`${GATEWAY_URL}/api/memory/graph?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to load file graph');
      }
      const data = await response.json();
      setGraphData(data.graph ?? null);
    } catch (error) {
      console.error('Failed to load file graph', error);
      setGraphError((error as Error).message || 'Failed to load graph');
      setGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      loadStatus();
      loadHistory();
      loadFileGraph();
    };
    refresh();
    const interval = setInterval(refresh, 6000);
    return () => clearInterval(interval);
  }, [loadFileGraph]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter((file) =>
      allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    );
    const queue = validFiles.map((file) => ({
      name: file.webkitRelativePath || file.name,
      size: file.size
    }));
    setFileQueue(queue);
    setUploadError(null);
    setUploadStage(queue.length ? 'confirm' : 'idle');
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    const filtered = files.filter((file) =>
      allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    );
    const queue = filtered.map((file) => ({
      name: file.webkitRelativePath || file.name,
      size: file.size
    }));
    setFileQueue(queue);
    setUploadError(null);
    setUploadStage(queue.length ? 'confirm' : 'idle');
  }

  async function handleUpload() {
    if (!fileQueue.length || isUploading || !fileInputRef.current?.files) return;
    setUploadStage('uploading');
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      Array.from(fileInputRef.current.files).forEach((file) => {
        formData.append('files', file, file.name);
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        formData.append('paths', relativePath || file.name);
      });
      const response = await fetch(`${GATEWAY_URL}/api/memory/upload`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      await loadStatus();
      await loadHistory();
      await loadFileGraph();
      setFileQueue([]);
      setUploadStage('idle');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to upload bespoke memory', error);
      setUploadError((error as Error).message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleReindex(ingestionId: string) {
    setActionLoading(ingestionId);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/${ingestionId}/reindex`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to queue re-index');
      await loadStatus();
      await loadHistory();
    } catch (error) {
      console.error('Failed to reindex ingestion', error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(ingestionId: string) {
    setActionLoading(ingestionId);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/${ingestionId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete ingestion');
      await loadStatus();
      await loadHistory();
      await loadFileGraph();
    } catch (error) {
      console.error('Failed to delete ingestion', error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleClearAll() {
    if (clearingAll) return;
    setClearingAll(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to clear bespoke memories');
      await loadStatus();
      await loadHistory();
      await loadFileGraph();
      setFileQueue([]);
      setUploadStage('idle');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error('Failed to clear bespoke memories', error);
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal memory-modal" onClick={(evt) => evt.stopPropagation()}>
        <div className="profile-modal-header">
          <div>
            <p className="profile-name">Bespoke Memory</p>
          </div>
          <button className="profile-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="profile-modal-body">
          <div className="memory-columns">
            <div className="memory-left-column">
              <section>
                <h3>Upload Local Folder</h3>
                <div className={`memory-dropzone ${dragActive ? 'active' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    // allow folder selection when supported
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    webkitdirectory="true"
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    directory="true"
                    onChange={handleFileChange}
                    accept={allowedExtensions.join(',')}
                  />
                  {uploadStage === 'confirm' && fileQueue.length > 0 && (
                    <div className="memory-confirmation">
                      <p>Upload {fileQueue.length} Markdown file{fileQueue.length === 1 ? '' : 's'}?</p>
                      <ul className="memory-file-queue">
                        {fileQueue.slice(0, 6).map((file) => (
                          <li key={file.name}>{file.name}</li>
                        ))}
                        {fileQueue.length > 6 && <li>+ {fileQueue.length - 6} more</li>}
                      </ul>
                      <div className="memory-actions">
                        <button type="button" className="memory-upload-btn primary" onClick={handleUpload} disabled={isUploading}>
                          {isUploading ? 'Uploading…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          className="memory-upload-btn secondary"
                          onClick={() => {
                            setFileQueue([]);
                            setUploadStage('idle');
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          disabled={isUploading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {uploadStage === 'uploading' && (
                    <div className="memory-upload-progress">
                      <div className="progress-track">
                        <div className="progress-value active" style={{ width: '60%' }} />
                      </div>
                      <p>Uploading…</p>
                    </div>
                  )}
                  {uploadStage !== 'confirm' && uploadStage !== 'uploading' && statusData && statusData.status !== 'uploaded' && statusData.status !== 'failed' && (
                    <MemoryProgress status={statusData} />
                  )}
                  {uploadStage !== 'uploading' && statusData && statusData.status === 'failed' && (
                    <p className="profile-error">{statusData.error || 'Ingestion failed'}</p>
                  )}
                  {uploadStage === 'idle' && statusLoading && (
                    <p className="text-muted">Checking status…</p>
                  )}
                  {uploadStage === 'idle' && !statusLoading && (!statusData || statusData.status === 'uploaded' || statusData.status === 'failed') && (
                    <>
                      <p>Drop Markdown files or click Upload.</p>
                      <button type="button" className="memory-upload-btn primary" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                        Upload
                      </button>
                    </>
                  )}
                </div>
                {uploadError && <p className="profile-error">{uploadError}</p>}
              </section>
              <section>
                <div className="memory-history-header">
                  <h3>History</h3>
                  {history.length > 0 && (
                    <button
                      type="button"
                      className="memory-upload-btn secondary"
                      onClick={handleClearAll}
                      disabled={clearingAll}
                    >
                      {clearingAll ? 'Clearing…' : 'Clear All'}
                    </button>
                  )}
                </div>
                {historyLoading ? (
                  <p className="text-muted">Loading history…</p>
                ) : history.length === 0 ? (
                  <p className="text-muted">No uploads yet.</p>
                ) : (
                  <ul className="memory-history-list">
                    {history.map((item) => (
                      <li key={item.id} className="memory-history-item">
                        <div>
                          <p className="memory-history-title">{item.batchName || `${item.totalFiles} file${item.totalFiles === 1 ? '' : 's'}`}</p>
                          <small>{item.statusLabel} · {new Date(item.createdAt).toLocaleString()}</small>
                        </div>
                        <div className="memory-history-actions">
                          {/* Re-index button commented out per request */}
                          {/* {item.status === 'uploaded' && (
                            <button
                              type="button"
                              className="memory-upload-btn secondary"
                              onClick={() => handleReindex(item.id)}
                              disabled={actionLoading === item.id}
                            >
                              {actionLoading === item.id ? 'Queueing…' : 'Re-index'}
                            </button>
                          )} */}
                          <button
                            type="button"
                            className="memory-upload-btn secondary"
                            onClick={() => handleDelete(item.id)}
                            disabled={actionLoading === item.id}
                          >
                            {actionLoading === item.id ? 'Removing…' : 'Delete'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <div className="memory-right-column">
              <section className="memory-graph-section">
            <div className="memory-history-header">
              <h3>Graph View</h3>
              <small>All uploads</small>
            </div>
            <MemoryGraphPanel
              graph={graphData}
              loading={graphLoading}
              error={graphError}
            />
          </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryProgress({ status }: { status: BespokeStatus }) {
  const isIndexing = status.status !== 'chunking' && status.status !== 'failed' && status.status !== 'uploaded';
  const total = isIndexing ? status.totalChunks || status.totalFiles || 0 : status.totalFiles || 0;
  const current = isIndexing ? status.indexedChunks : status.chunkedFiles;
  const progress = total ? Math.min(100, (current / total) * 100) : 0;
  const label = isIndexing
    ? `${status.statusLabel} · ${status.indexedChunks}/${status.totalChunks || '—'} chunks`
    : `${status.statusLabel} · ${status.chunkedFiles}/${status.totalFiles} files`;
  return (
    <div className="memory-upload-progress">
      <div className="progress-track">
        <div className="progress-value active" style={{ width: `${progress}%` }} />
      </div>
      <p>{label}</p>
    </div>
  );
}

function MemoryGraphPanel({
  graph,
  loading,
  error
}: {
  graph: FileGraphResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeInstance | null>(null);

  useEffect(() => {
    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const container = graphContainerRef.current;
    if (!container) return;
    if (!cyRef.current) {
      cyRef.current = cytoscape({
        container,
        autounselectify: true,
        boxSelectionEnabled: false,
        style: GRAPH_STYLES
      });
    }
    const cy = cyRef.current;
    if (!graph || (graph.nodes ?? []).length === 0) {
      cy.elements().remove();
      return;
    }
    const elements = buildGraphElements(graph);
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
    cy.resize();
    try {
      const layout = cy.layout({
        name: 'preset',
        fit: true,
        padding: 48,
        animate: false
      } as LayoutOptions);
      if (layout && typeof layout.run === 'function') {
        layout.run();
      } else {
        cy.fit(undefined, 48);
      }
    } catch (layoutError) {
      console.warn('Cytoscape preset layout failed', layoutError);
      cy.fit(undefined, 48);
    }
  }, [graph]);

  if (loading) {
    return <p className="text-muted">Loading graph…</p>;
  }
  if (error) {
    return <p className="profile-error">{error}</p>;
  }
  if (!graph || (graph.nodes ?? []).length === 0) {
    return <p className="text-muted">Graph not ready yet. Upload a batch and let indexing finish.</p>;
  }

  const nodeCount = graph.meta?.nodeCount ?? graph.nodes.length;
  const edgeCount = graph.meta?.edgeCount ?? graph.edges.length;
  const ingestionCount = graph.meta?.ingestionCount ?? 0;
  const docDescription = `Graph ready: ${nodeCount} files · ${edgeCount} edges · ${ingestionCount} uploads.`;

  return (
    <div className="memory-graph-panel">
      <div className="graph-document-card">
        <p className="graph-document-summary">{docDescription}</p>
      </div>
      <div className="graph-canvas">
        <div className="graph-cytoscape" ref={graphContainerRef} />
        <div className="graph-toggle-row">
          <span>{nodeCount} nodes</span>
          <span>· {edgeCount} edges</span>
        </div>
      </div>
    </div>
  );
}

function buildGraphElements(graph: FileGraphResponse): ElementDefinition[] {
  const groupedByIngestion = new Map<string, FileGraphNode[]>();
  (graph.nodes ?? []).forEach((node) => {
    const group = groupedByIngestion.get(node.ingestionId) ?? [];
    group.push(node);
    groupedByIngestion.set(node.ingestionId, group);
  });
  const baseRadius = 120;
  const radiusStep = 120;
  const positions = new Map<string, { x: number; y: number }>();
  let groupIndex = 0;
  groupedByIngestion.forEach((groupNodes) => {
    const radius = baseRadius + groupIndex * radiusStep;
    const clampedRadius = radius || baseRadius;
    groupNodes.forEach((node, idx) => {
      const angle = (idx / groupNodes.length) * Math.PI * 2;
      const x = clampedRadius * Math.cos(angle);
      const y = clampedRadius * Math.sin(angle);
      positions.set(node.id, { x, y });
    });
    groupIndex += 1;
  });
  const nodes: ElementDefinition[] = (graph.nodes ?? []).map((node, index) => {
    const position =
      positions.get(node.id) ??
      {
        x: baseRadius * Math.cos((index / Math.max(1, graph.nodes.length)) * Math.PI * 2),
        y: baseRadius * Math.sin((index / Math.max(1, graph.nodes.length)) * Math.PI * 2)
      };
    return {
      data: {
        id: node.id,
        label: node.label,
        nodeType: 'FILE',
        ingestionId: node.ingestionId,
        batchName: node.batchName ?? '',
        filePath: node.filePath,
        createdAt: node.createdAt
      },
      position
    };
  });
  const edges: ElementDefinition[] = (graph.edges ?? []).map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType: 'RELATED',
      ingestionId: edge.ingestionId
    }
  }));
  return [...nodes, ...edges];
}

const GRAPH_STYLES = [
  {
    selector: 'node',
    style: {
      'background-color': 'rgba(92, 255, 199, 0.75)',
      'border-width': 0,
      width: 9,
      height: 9,
      label: 'data(label)',
      color: '#0b0f0c',
      'font-size': 9,
      'text-wrap': 'wrap',
      'text-max-width': 100,
      'text-outline-width': 2,
      'text-outline-color': 'rgba(5, 5, 5, 0.8)',
      'border-color': 'rgba(5, 5, 5, 0.8)'
    }
  },
  {
    selector: 'node:selected',
    style: {
      width: 16,
      height: 16,
      color: '#111',
      'font-size': 11,
      'text-outline-width': 3
    }
  },
  {
    selector: 'edge',
    style: {
      width: 1.8,
      'curve-style': 'bezier',
      'line-color': 'rgba(86, 238, 255, 0.5)',
      'target-arrow-color': 'rgba(86, 238, 255, 0.85)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.85,
      opacity: 0.9
    }
  }
] as unknown as cytoscape.StylesheetJson;
