'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Camera, Loader2 } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { uploadAvatarAction } from '@/lib/actions/profile';

interface AvatarUploaderProps {
  value: string | null;
  fullName: string;
  onChange: (url: string | null) => void;
}

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AvatarUploader({ value, fullName, onChange }: AvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(value);

  const handlePick = () => {
    inputRef.current?.click();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('Formato não suportado. Use PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Arquivo maior que 2MB.');
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    const formData = new FormData();
    formData.append('file', file);

    startTransition(async () => {
      const res = await uploadAvatarAction(formData);
      if (!res.success || !res.data) {
        setPreview(value);
        toast.error(res.error ?? 'Falha no upload do avatar.');
        return;
      }
      onChange(res.data.url);
      setPreview(res.data.url);
      toast.success('Avatar atualizado.');
    });
  };

  const handleRemove = () => {
    setPreview(null);
    onChange(null);
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-20">
        {preview ? <AvatarImage src={preview} alt={fullName} /> : null}
        <AvatarFallback>{getInitials(fullName)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePick}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="size-4" aria-hidden="true" />
            )}
            {isPending ? 'Enviando…' : 'Trocar avatar'}
          </Button>
          {preview ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={isPending}
            >
              Remover
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-text-secondary">PNG, JPG ou WEBP. Máx 2MB.</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}
