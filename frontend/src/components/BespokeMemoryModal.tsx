'use client';

import {
  useEffect,
  useState,
  useRef,
  ChangeEvent,
  DragEvent,
  useCallback,
  useMemo,
  memo
} from 'react';
import { gatewayFetch } from '@/lib/gatewayFetch';

interface BespokeMemoryModalProps {
  onClose: () => void;
}

export type BespokeIngestionStatus = 'chunking' | 'chunked' | 'indexing' | 'uploaded' | 'failed';

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
}

type UploadStage = 'idle' | 'uploading';

interface QueuedFile {
  file: File;
  name: string;
  size: number;
  relativePath: string;
}

export function BespokeMemoryModal({ onClose }: BespokeMemoryModalProps) {
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([]);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<BespokeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [history, setHistory] = useState<BespokeStatus[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const [dragActive, setDragActive] = useState(false);
  const allowedExtensions = useMemo(() => ['.md'], []);

  const loadStatus = useCallback(async () => {
    try {
      const response = await gatewayFetch('memory/status');
      if (!response.ok) throw new Error('Failed to load status');
      const data = await response.json();
      setStatusData(data.ingestion ?? null);
    } catch (error) {
      console.error('Failed to load memory status', error);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (limit = 6) => {
    try {
      const response = await gatewayFetch(`memory/history?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to load history');
      const data = await response.json();
      setHistory(data.history ?? []);
    } catch (error) {
      console.error('Failed to load ingestion history', error);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadStatus();
    loadHistory();
  }, [loadStatus, loadHistory]);

  useEffect(() => {
    loadStatus();
    loadHistory();
    const interval = setInterval(refreshAll, 300000);
    return () => clearInterval(interval);
  }, [loadStatus, loadHistory, refreshAll]);

  useEffect(() => {
    if (!statusData) {
      return;
    }
    const inProgressStatuses: BespokeIngestionStatus[] = ['chunking', 'chunked', 'indexing'];
    if (!inProgressStatuses.includes(statusData.status)) {
      return;
    }
    const interval = setInterval(() => {
      refreshAll();
    }, 3000);
    return () => clearInterval(interval);
  }, [statusData, refreshAll]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    handleSelectedFiles(files);
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
    handleSelectedFiles(files);
  }

  function handleSelectedFiles(files: File[]) {
    const validFiles = files.filter((file) =>
      allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    );
    const queue: QueuedFile[] = validFiles.map((file) => {
      const fileWithPath = file as File & { webkitRelativePath?: string };
      const relativePath = fileWithPath.webkitRelativePath || file.name;
      return {
        file,
        name: relativePath,
        size: file.size,
        relativePath
      };
    });
    setFileQueue(queue);
    setUploadError(null);
    if (queue.length) {
      void handleUpload(queue);
    } else {
      setUploadStage('idle');
    }
  }

  async function handleUpload(queueOverride?: QueuedFile[]) {
    const activeQueue = queueOverride ?? fileQueue;
    if (!activeQueue.length || isUploading) return;
    setUploadStage('uploading');
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      activeQueue.forEach(({ file, relativePath }) => {
        formData.append('files', file, file.name);
        formData.append('paths', relativePath);
      });
      const response = await gatewayFetch('memory/upload', {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        let errorMessage = 'Upload failed';
        try {
          const data = await response.json();
          errorMessage = data.error || `Upload failed (${response.status})`;
        } catch {
          try {
            const text = await response.text();
            errorMessage = text || `Upload failed (${response.status})`;
          } catch {
            errorMessage = `Upload failed (${response.status})`;
          }
        }
        throw new Error(errorMessage);
      }
      await loadStatus();
      await loadHistory();
    } catch (error) {
      console.error('Failed to upload bespoke memory', error);
      setUploadError((error as Error).message || 'Upload failed');
    } finally {
      setIsUploading(false);
      setUploadStage('idle');
      setFileQueue([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleDelete(ingestionId: string) {
    setActionLoading(ingestionId);
    try {
      const response = await gatewayFetch(`memory/${ingestionId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete ingestion');
      await loadStatus();
      await loadHistory();
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
      const response = await gatewayFetch('memory', {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to clear bespoke memories');
      await loadStatus();
      await loadHistory();
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
          <span>Index</span>
        </div>
        <div className="profile-modal-body">
          <div className="memory-single-column">
            <UploadSection
              dragActive={dragActive}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
              allowedExtensions={allowedExtensions}
              uploadStage={uploadStage}
              fileQueue={fileQueue}
              isUploading={isUploading}
              onOpenPicker={handleOpenFilePicker}
              uploadError={uploadError}
              statusData={statusData}
              statusLoading={statusLoading}
            />
            <HistorySection
              history={history}
              historyLoading={historyLoading}
              clearingAll={clearingAll}
              onClearAll={handleClearAll}
              onDelete={handleDelete}
              actionLoadingId={actionLoading}
            />
          </div>
        </div>
        <div className="bespoke-modal-footer">
          <button type="button" className="profile-done-btn" onClick={onClose}>
            Done
          </button>
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

interface UploadSectionProps {
  dragActive: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  allowedExtensions: string[];
  uploadStage: UploadStage;
  fileQueue: QueuedFile[];
  isUploading: boolean;
  onOpenPicker: () => void;
  uploadError: string | null;
  statusData: BespokeStatus | null;
  statusLoading: boolean;
}

const UploadSection = memo(function UploadSection({
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  fileInputRef,
  onFileChange,
  allowedExtensions,
  uploadStage,
  fileQueue,
  isUploading,
  onOpenPicker,
  uploadError,
  statusData,
  statusLoading
}: UploadSectionProps) {
  return (
    <section>
      <h3>Upload</h3>
      <div
        className={`memory-dropzone ${dragActive ? 'active' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
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
          onChange={onFileChange}
          accept={allowedExtensions.join(',')}
        />
        {uploadStage === 'uploading' && (
          <div className="memory-upload-progress">
            <div className="progress-track">
              <div className="progress-value active" style={{ width: '60%' }} />
            </div>
            <p>
              Uploading {fileQueue.length} Markdown file{fileQueue.length === 1 ? '' : 's'}…
            </p>
            {fileQueue.length > 0 && (
              <ul className="memory-file-queue">
                {fileQueue.slice(0, 6).map((file) => (
                  <li key={file.name}>{file.name}</li>
                ))}
                {fileQueue.length > 6 && <li>+ {fileQueue.length - 6} more</li>}
              </ul>
            )}
          </div>
        )}
        {uploadStage !== 'uploading' &&
          statusData &&
          statusData.status !== 'uploaded' &&
          statusData.status !== 'failed' && <MemoryProgress status={statusData} />}
        {uploadStage !== 'uploading' && statusData && statusData.status === 'failed' && (
          <p className="profile-error">{statusData.error || 'Ingestion failed'}</p>
        )}
        {uploadStage === 'idle' && statusLoading && <p className="text-muted">Checking status…</p>}
        {uploadStage === 'idle' && !statusLoading && (!statusData || statusData.status === 'uploaded' || statusData.status === 'failed') && (
          <>
            <p>Drop Markdown files or click Upload.</p>
            <button type="button" className="memory-upload-btn primary" onClick={onOpenPicker} disabled={isUploading}>
              Upload
            </button>
          </>
        )}
      </div>
      {uploadError && <p className="profile-error">{uploadError}</p>}
    </section>
  );
});

interface HistorySectionProps {
  history: BespokeStatus[];
  historyLoading: boolean;
  clearingAll: boolean;
  onClearAll: () => void;
  onDelete: (ingestionId: string) => void;
  actionLoadingId: string | null;
}

const HistorySection = memo(function HistorySection({
  history,
  historyLoading,
  clearingAll,
  onClearAll,
  onDelete,
  actionLoadingId
}: HistorySectionProps) {
  return (
    <section>
      <div className="memory-history-header">
        <h3>History</h3>
        {history.length > 0 && (
          <button type="button" className="memory-upload-btn secondary" onClick={onClearAll} disabled={clearingAll}>
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
                <p className="memory-history-title">
                  {item.batchName || `${item.totalFiles} file${item.totalFiles === 1 ? '' : 's'}`}
                </p>
                <small>
                  {item.statusLabel} · {new Date(item.createdAt).toLocaleString()}
                </small>
              </div>
              <div className="memory-history-actions">
                <button
                  type="button"
                  className="memory-upload-btn secondary"
                  onClick={() => onDelete(item.id)}
                  disabled={actionLoadingId === item.id}
                >
                  {actionLoadingId === item.id ? 'Removing…' : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
