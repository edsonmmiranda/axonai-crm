'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { LossReasonOption } from '@/lib/actions/leads';

interface LossReasonModalProps {
  open: boolean;
  lossReasons: LossReasonOption[];
  onConfirm: (reasonId: string, notes: string | null) => void;
  onCancel: () => void;
  submitting: boolean;
}

export function LossReasonModal({
  open,
  lossReasons,
  onConfirm,
  onCancel,
  submitting,
}: LossReasonModalProps) {
  const [reasonId, setReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReasonId('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const hasReasons = lossReasons.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonId) {
      setError('Selecione um motivo de perda.');
      return;
    }
    onConfirm(reasonId, notes.trim() === '' ? null : notes.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        {!hasReasons ? (
          <>
            <DialogHeader>
              <DialogTitle>Nenhum motivo de perda cadastrado</DialogTitle>
              <DialogDescription>
                Para marcar um lead como perdido é necessário ter ao menos um motivo
                cadastrado na sua organização.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 rounded-md border border-feedback-warning-border bg-feedback-warning-bg p-3 text-sm text-feedback-warning-fg">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                O lead permanecerá no estágio atual. Cadastre um motivo e tente novamente.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onCancel}>
                Fechar
              </Button>
              <Button asChild>
                <Link href="/leads-loss-reasons">Cadastrar motivo</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Marcar lead como perdido</DialogTitle>
              <DialogDescription>
                Selecione o motivo da perda. O lead será atualizado para o status
                &ldquo;Perdido&rdquo;.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="loss-reason" required>
                Motivo
              </Label>
              <Select
                value={reasonId}
                onValueChange={(v) => {
                  setReasonId(v);
                  setError(null);
                }}
              >
                <SelectTrigger id="loss-reason" aria-invalid={Boolean(error)}>
                  <SelectValue placeholder="Selecione o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {lossReasons.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && (
                <p role="alert" className="text-xs text-feedback-danger-fg">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="loss-notes">Observações (opcional)</Label>
              <Textarea
                id="loss-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Detalhes adicionais sobre a perda…"
              />
              <p className="text-xs text-text-muted">
                {notes.length}/500 caracteres
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger" disabled={submitting}>
                {submitting ? 'Movendo…' : 'Confirmar perda'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
