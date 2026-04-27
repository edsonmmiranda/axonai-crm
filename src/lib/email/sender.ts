import 'server-only';

import nodemailer from 'nodemailer';

import { createServiceClient } from '@/lib/supabase/service';

import { EmailNotConfiguredError, getEmailCredential, type SmtpCredential } from './getCredential';

export type EmailKind = 'invitation' | 'password_reset' | 'admin_notification';
export type RelatedEntityType = 'invitation' | 'platform_admin_invitation' | 'password_reset';

export interface SendEmailPayload {
  kind:        EmailKind;
  to:          string;
  subject:     string;
  html:        string;
  text?:       string;
  related?:    { type: RelatedEntityType; id: string };
  /**
   * Caller-provided link para fallback offline. O sender não gera signed URLs —
   * caller (ex: Sprint 11 invitations) já possui token e monta o link.
   */
  offlineLink?: string;
  sentBy?:      string | null;
}

export type EmailDeliveryResult =
  | { status: 'sent';             deliveryLogId: string }
  | { status: 'fallback_offline'; deliveryLogId: string; offlineLink: string }
  | { status: 'error';            deliveryLogId: string; errorMessage: string };

interface DeliveryLogRow { id: string }

async function logDelivery(
  payload: SendEmailPayload,
  source: 'platform_setting' | 'env_var' | 'offline_fallback',
  status: 'sent' | 'fallback_offline' | 'error',
  offlineLink: string | null,
  errorMessage: string | null,
): Promise<string> {
  const supabase = createServiceClient();
  const resp = await supabase.rpc('log_email_delivery', {
    p_recipient:           payload.to,
    p_subject:             payload.subject,
    p_kind:                payload.kind,
    p_source:              source,
    p_status:              status,
    p_offline_link:        offlineLink,
    p_error_message:       errorMessage,
    p_related_entity_type: payload.related?.type ?? null,
    p_related_entity_id:   payload.related?.id   ?? null,
    p_sent_by:             payload.sentBy        ?? null,
  });
  if (resp.error) {
    console.error('[email:sender:log]', resp.error);
    return '';
  }
  const data = resp.data as DeliveryLogRow | DeliveryLogRow[] | null;
  if (Array.isArray(data)) return data[0]?.id ?? '';
  return data?.id ?? '';
}

export async function sendEmail(payload: SendEmailPayload): Promise<EmailDeliveryResult> {
  let credential: SmtpCredential | null;

  try {
    credential = await getEmailCredential();
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      const deliveryLogId = await logDelivery(payload, 'env_var', 'error', null, 'email_not_configured');
      return { status: 'error', deliveryLogId, errorMessage: 'email_not_configured' };
    }
    throw err;
  }

  // Fallback offline: caller deve passar offlineLink.
  if (credential === null) {
    if (!payload.offlineLink) {
      throw new Error('sender_misuse: offlineLink ausente quando fallback offline está ativo');
    }
    const deliveryLogId = await logDelivery(payload, 'offline_fallback', 'fallback_offline', payload.offlineLink, null);
    return { status: 'fallback_offline', deliveryLogId, offlineLink: payload.offlineLink };
  }

  // Envio via SMTP.
  try {
    const transporter = nodemailer.createTransport({
      host:   credential.host,
      port:   credential.port,
      secure: credential.secure,
      auth:   { user: credential.user, pass: credential.password },
    });
    await transporter.sendMail({
      from:    credential.fromEmail,
      to:      payload.to,
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    });
    const deliveryLogId = await logDelivery(payload, credential.source, 'sent', null, null);
    return { status: 'sent', deliveryLogId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const errorMessage = raw.slice(0, 1000);
    console.error('[email:sender]', err);
    const deliveryLogId = await logDelivery(payload, credential.source, 'error', null, errorMessage);
    return { status: 'error', deliveryLogId, errorMessage };
  }
}
