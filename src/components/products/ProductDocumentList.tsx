'use client';

import { useRef, useState, useTransition } from 'react';
import {
  Download,
  File as FileIcon,
  FileImage,
  FileText,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  deleteProductDocumentAction,
  getProductDocumentSignedUrlAction,
  uploadProductDocumentAction,
} from '@/lib/actions/product-documents';

export interface ProductDocumentItem {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  document_type: string | null;
  created_at: string | null;
}

interface ProductDocumentListProps {
  productId: string;
  documents: ProductDocumentItem[];
}

const ALLOWED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENTS = 50;

const DOC_TYPE_NONE = '__none__';
const DOCUMENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'ficha-tecnica', label: 'Ficha técnica' },
  { value: 'certificado', label: 'Certificado' },
  { value: 'outro', label: 'Outro' },
];

function iconForMime(mime: string | null) {
  if (!mime) return FileIcon;
  if (mime === 'application/pdf') return FileText;
  if (mime.startsWith('image/')) return FileImage;
  if (mime.includes('word')) return FileText;
  return FileIcon;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function labelForType(type: string | null): string | null {
  if (!type) return null;
  const match = DOCUMENT_TYPES.find((t) => t.value === type);
  return match ? match.label : type;
}

export function ProductDocumentList({
  productId,
  documents,
}: ProductDocumentListProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedType, setSelectedType] = useState<string>(DOC_TYPE_NONE);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ProductDocumentItem | null>(null);
  const [, startTransition] = useTransition();

  function resetUploadDialog() {
    setSelectedFile(null);
    setSelectedType(DOC_TYPE_NONE);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onChooseFile(list: FileList | null) {
    const file = list?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      toast.error('Formato não suportado. Use PDF, DOC, DOCX, JPEG ou PNG.');
      return;
    }
    if (file.size <= 0) {
      toast.error('Arquivo vazio.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Documento excede o tamanho máximo de 20MB.');
      return;
    }
    setSelectedFile(file);
  }

  async function onUpload() {
    if (!selectedFile) {
      toast.error('Selecione um arquivo.');
      return;
    }
    if (documents.length >= MAX_DOCUMENTS) {
      toast.error(`Limite de ${MAX_DOCUMENTS} documentos por produto atingido.`);
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const docType = selectedType !== DOC_TYPE_NONE ? selectedType : undefined;
      const res = await uploadProductDocumentAction(productId, formData, docType);
      if (!res.success) {
        toast.error(res.error ?? 'Falha ao enviar documento.');
        return;
      }
      toast.success('Documento enviado.');
      setUploadOpen(false);
      resetUploadDialog();
    } finally {
      setIsUploading(false);
    }
  }

  function onDownload(doc: ProductDocumentItem) {
    setDownloadingId(doc.id);
    startTransition(async () => {
      const res = await getProductDocumentSignedUrlAction(doc.id);
      setDownloadingId(null);
      if (!res.success || !res.data) {
        toast.error(res.error ?? 'Não foi possível gerar link de download.');
        return;
      }
      window.open(res.data.url, '_blank', 'noopener,noreferrer');
    });
  }

  function onConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setPendingId(target.id);
    startTransition(async () => {
      const res = await deleteProductDocumentAction(target.id);
      setPendingId(null);
      setDeleteTarget(null);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir.');
        return;
      }
      toast.success('Documento excluído.');
    });
  }

  const canUpload = documents.length < MAX_DOCUMENTS;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <p className="text-sm font-medium text-text-primary">
            Documentos do produto
          </p>
          <p className="text-xs text-text-secondary">
            {documents.length} de {MAX_DOCUMENTS} · PDF, DOC, DOCX, JPEG ou PNG · até 20MB
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setUploadOpen(true)}
          disabled={!canUpload}
        >
          <Upload className="size-4" aria-hidden="true" />
          Adicionar documento
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-default px-6 py-10 text-center">
          <FileText className="size-6 text-text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-text-primary">
            Nenhum documento anexado
          </p>
          <p className="text-sm text-text-secondary">
            Envie manuais, fichas técnicas ou certificados como apoio de vendas.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-default">
          {documents.map((doc) => {
            const Icon = iconForMime(doc.mime_type);
            const typeLabel = labelForType(doc.document_type);
            const isBusy = pendingId === doc.id || downloadingId === doc.id;
            return (
              <li
                key={doc.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon
                    className="size-5 shrink-0 text-text-secondary"
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span
                      className="truncate text-sm font-medium text-text-primary"
                      title={doc.file_name}
                    >
                      {doc.file_name}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {formatBytes(doc.file_size)} · Enviado em {formatDate(doc.created_at)}
                    </span>
                  </div>
                  {typeLabel ? (
                    <Badge variant="role-admin">{typeLabel}</Badge>
                  ) : null}
                </div>

                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Baixar ${doc.file_name}`}
                    onClick={() => onDownload(doc)}
                    disabled={isBusy}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    {downloadingId === doc.id ? 'Gerando…' : 'Baixar'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Excluir ${doc.file_name}`}
                    onClick={() => setDeleteTarget(doc)}
                    disabled={isBusy}
                  >
                    <Trash2
                      className="size-4 text-feedback-danger-fg"
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) resetUploadDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar documento</DialogTitle>
            <DialogDescription>
              Envie um arquivo de apoio (manual, ficha técnica, certificado).
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="docFile">Arquivo</Label>
              <Input
                id="docFile"
                ref={fileInputRef}
                type="file"
                accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                onChange={(e) => onChooseFile(e.target.files)}
              />
              {selectedFile ? (
                <p className="text-xs text-text-secondary">
                  {selectedFile.name} · {formatBytes(selectedFile.size)}
                </p>
              ) : (
                <p className="text-xs text-text-secondary">
                  PDF, DOC, DOCX, JPEG ou PNG · até 20MB
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="docType">Tipo (opcional)</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger id="docType">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DOC_TYPE_NONE}>Sem tipo</SelectItem>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setUploadOpen(false);
                resetUploadDialog();
              }}
              disabled={isUploading}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void onUpload()}
              disabled={isUploading || !selectedFile}
            >
              {isUploading ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir documento?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `"${deleteTarget.file_name}" será removido permanentemente.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={pendingId !== null}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={onConfirmDelete}
              disabled={pendingId !== null}
            >
              {pendingId !== null ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
