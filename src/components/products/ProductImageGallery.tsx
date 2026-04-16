'use client';

import Image from 'next/image';
import { useRef, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, ImageIcon, Star, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteProductImageAction,
  reorderProductImagesAction,
  setPrimaryImageAction,
  uploadProductImageAction,
} from '@/lib/actions/product-images';

export interface ProductImageItem {
  id: string;
  url: string;
  file_name: string;
  position: number | null;
  is_primary: boolean | null;
  signed_url: string | null;
}

interface ProductImageGalleryProps {
  productId: string;
  images: ProductImageItem[];
}

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 20;

export function ProductImageGallery({ productId, images }: ProductImageGalleryProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductImageItem | null>(null);
  const [, startTransition] = useTransition();

  const sorted = [...images].sort((a, b) => {
    const pa = a.position ?? 0;
    const pb = b.position ?? 0;
    return pa - pb;
  });

  function onChooseFiles() {
    fileInputRef.current?.click();
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    const available = Math.max(0, MAX_IMAGES - images.length);
    if (available <= 0) {
      toast.error(`Limite de ${MAX_IMAGES} imagens por produto atingido.`);
      return;
    }
    const toUpload = files.slice(0, available);
    if (toUpload.length < files.length) {
      toast.error(
        `Apenas ${toUpload.length} imagem(ns) será(ão) enviada(s). Limite total é ${MAX_IMAGES}.`
      );
    }

    setIsUploading(true);
    let uploaded = 0;
    try {
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        setUploadStatus(`Enviando ${i + 1}/${toUpload.length}: ${file.name}`);

        if (!ALLOWED.includes(file.type)) {
          toast.error(`${file.name}: formato não suportado. Use JPEG, PNG ou WebP.`);
          continue;
        }
        if (file.size <= 0) {
          toast.error(`${file.name}: arquivo vazio.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name}: excede o tamanho máximo de 5MB.`);
          continue;
        }

        const formData = new FormData();
        formData.append('file', file);
        const res = await uploadProductImageAction(productId, formData);
        if (!res.success) {
          toast.error(`${file.name}: ${res.error ?? 'falha ao enviar.'}`);
          continue;
        }
        uploaded += 1;
      }
      if (uploaded > 0) {
        toast.success(
          uploaded === 1 ? 'Imagem enviada.' : `${uploaded} imagens enviadas.`
        );
      }
    } finally {
      setIsUploading(false);
      setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function onSetPrimary(image: ProductImageItem) {
    if (image.is_primary) return;
    setPendingId(image.id);
    startTransition(async () => {
      const res = await setPrimaryImageAction(image.id);
      setPendingId(null);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível definir como capa.');
        return;
      }
      toast.success('Capa atualizada.');
    });
  }

  function onReorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    if (isReordering) return;

    const next = [...sorted];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    const orderedIds = next.map((img) => img.id);

    setIsReordering(true);
    startTransition(async () => {
      const res = await reorderProductImagesAction(productId, orderedIds);
      setIsReordering(false);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível reordenar.');
        return;
      }
      toast.success('Ordem atualizada.');
    });
  }

  function onConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setPendingId(target.id);
    startTransition(async () => {
      const res = await deleteProductImageAction(target.id);
      setPendingId(null);
      setDeleteTarget(null);
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível excluir.');
        return;
      }
      toast.success('Imagem excluída.');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <p className="text-sm font-medium text-text-primary">
            Imagens do produto
          </p>
          <p className="text-xs text-text-secondary">
            {sorted.length} de {MAX_IMAGES} imagens · JPEG, PNG ou WebP · até 5MB
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onChooseFiles}
          disabled={isUploading || sorted.length >= MAX_IMAGES}
        >
          <Upload className="size-4" aria-hidden="true" />
          Adicionar imagens
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {uploadStatus ? (
        <p className="text-xs text-text-secondary" role="status">
          {uploadStatus}
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-default px-6 py-10 text-center">
          <ImageIcon className="size-6 text-text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-text-primary">
            Nenhuma imagem ainda
          </p>
          <p className="text-sm text-text-secondary">
            Adicione a primeira imagem para montar a galeria.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {sorted.map((image, index) => {
            const isBusy = pendingId === image.id || isReordering;
            return (
              <li
                key={image.id}
                className="group relative flex flex-col overflow-hidden rounded-md border border-default bg-surface-raised"
              >
                <div className="relative aspect-square w-full bg-surface-sunken">
                  {image.signed_url ? (
                    <Image
                      src={image.signed_url}
                      alt={image.file_name}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <ImageIcon
                        className="size-8 text-text-muted"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                  {image.is_primary ? (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-feedback-success-bg px-2 py-0.5 text-xs font-medium text-feedback-success-fg">
                      <Star className="size-3" aria-hidden="true" />
                      Capa
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 p-2">
                  <p
                    className="truncate text-xs text-text-secondary"
                    title={image.file_name}
                  >
                    {image.file_name}
                  </p>
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Mover para cima"
                        disabled={index === 0 || isBusy}
                        onClick={() => onReorder(index, -1)}
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Mover para baixo"
                        disabled={index === sorted.length - 1 || isBusy}
                        onClick={() => onReorder(index, 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={
                          image.is_primary ? 'Já é a capa' : 'Definir como capa'
                        }
                        disabled={!!image.is_primary || isBusy}
                        onClick={() => onSetPrimary(image)}
                      >
                        <Star className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Excluir imagem"
                        disabled={isBusy}
                        onClick={() => setDeleteTarget(image)}
                      >
                        <Trash2 className="size-4 text-feedback-danger-fg" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir imagem?</DialogTitle>
            <DialogDescription>
              Esta ação remove a imagem permanentemente. Se for a capa, a próxima
              imagem será promovida automaticamente.
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
