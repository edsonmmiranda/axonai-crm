export type LeadSource = 'whatsapp' | 'website' | 'indicacao';
export type LeadStatus = 'novo' | 'reuniao' | 'proposta';
export type LeadStatusTone = 'info' | 'warning' | 'accent';
export type AvatarTone = 'info' | 'accent' | 'danger' | 'warning' | 'success';

export interface Lead {
  id: string;
  name: string;
  initials: string;
  avatarTone: AvatarTone;
  interest: string;
  source: LeadSource;
  status: LeadStatus;
  statusLabel: string;
  statusTone: LeadStatusTone;
}

export type KpiTrend = 'up' | 'down' | 'neutral';
export type KpiIcon =
  | 'user-plus'
  | 'dollar-sign'
  | 'phone'
  | 'message-circle';

export interface KPI {
  id: string;
  label: string;
  value: string;
  icon: KpiIcon;
  iconTone: 'primary' | 'info' | 'accent' | 'success';
  badge?: {
    text: string;
    trend: KpiTrend;
    tone: 'success' | 'primary' | 'neutral';
  };
}

export interface SalesGoal {
  id: string;
  tag: string;
  title: string;
  collaboratorsCount: number;
  extraCount: number;
  ctaLabel: string;
}

export interface MonthlyGoal {
  label: string;
  progressPercent: number;
  progressLabel: string;
  helperText: string;
}

export type PipelineTone = 'info' | 'warning' | 'accent' | 'success';

export interface PipelineStage {
  id: string;
  name: string;
  count: number;
  progressPercent: number;
  tone: PipelineTone;
}

export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  title: string;
  scheduleLabel: string;
  priority: TaskPriority;
}

export const mockKpis: KPI[] = [
  {
    id: 'new-leads',
    label: 'Novos Leads (Hoje)',
    value: '12',
    icon: 'user-plus',
    iconTone: 'primary',
    badge: { text: '30%', trend: 'up', tone: 'success' },
  },
  {
    id: 'in-negotiation',
    label: 'Em Negociação',
    value: 'R$ 2.4M',
    icon: 'dollar-sign',
    iconTone: 'info',
    badge: { text: '12%', trend: 'up', tone: 'success' },
  },
  {
    id: 'contacts',
    label: 'Contatos Realizados',
    value: '18',
    icon: 'phone',
    iconTone: 'accent',
    badge: { text: 'Hoje', trend: 'neutral', tone: 'neutral' },
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    value: '8',
    icon: 'message-circle',
    iconTone: 'success',
    badge: { text: 'Não lidas', trend: 'neutral', tone: 'primary' },
  },
];

export const mockRecentLeads: Lead[] = [
  {
    id: 'lead-1',
    name: 'Ana Maria',
    initials: 'AM',
    avatarTone: 'info',
    interest: 'Consultoria Premium',
    source: 'whatsapp',
    status: 'novo',
    statusLabel: 'Novo',
    statusTone: 'info',
  },
  {
    id: 'lead-2',
    name: 'Carlos Souza',
    initials: 'CS',
    avatarTone: 'accent',
    interest: 'Plano SaaS Enterprise',
    source: 'website',
    status: 'reuniao',
    statusLabel: 'Reunião',
    statusTone: 'warning',
  },
  {
    id: 'lead-3',
    name: 'Mariana Jones',
    initials: 'MJ',
    avatarTone: 'danger',
    interest: 'Licença Corporativa',
    source: 'whatsapp',
    status: 'proposta',
    statusLabel: 'Proposta',
    statusTone: 'accent',
  },
  {
    id: 'lead-4',
    name: 'Paulo Ricardo',
    initials: 'PR',
    avatarTone: 'warning',
    interest: 'Mentoria Executiva',
    source: 'indicacao',
    status: 'novo',
    statusLabel: 'Novo',
    statusTone: 'info',
  },
];

export const mockSalesGoal: SalesGoal = {
  id: 'q4-campaign',
  tag: 'Meta de Vendas',
  title: 'Campanha Q4: Fechamento Anual',
  collaboratorsCount: 2,
  extraCount: 15,
  ctaLabel: 'Ver Detalhes',
};

export const mockMonthlyGoal: MonthlyGoal = {
  label: 'Metas do Mês',
  progressPercent: 82,
  progressLabel: '82% Concluído',
  helperText: 'Faltam R$ 180k para atingir o bônus.',
};

export const mockPipelineStages: PipelineStage[] = [
  { id: 'prospect', name: 'Prospecção', count: 14, progressPercent: 45, tone: 'info' },
  { id: 'demo', name: 'Demonstração', count: 8, progressPercent: 30, tone: 'warning' },
  { id: 'proposal', name: 'Proposta', count: 5, progressPercent: 15, tone: 'accent' },
  { id: 'closing', name: 'Fechamento', count: 2, progressPercent: 10, tone: 'success' },
];

export const mockUpcomingTasks: Task[] = [
  {
    id: 'task-1',
    title: 'Reunião: Demo Produto (Carlos)',
    scheduleLabel: '14:00 - Hoje',
    priority: 'medium',
  },
  {
    id: 'task-2',
    title: 'Ligar: Follow-up Proposta',
    scheduleLabel: '15:30 - Hoje',
    priority: 'high',
  },
  {
    id: 'task-3',
    title: 'Enviar contrato: Ana Maria',
    scheduleLabel: '09:00 - Amanhã',
    priority: 'low',
  },
];

export function formatTodayLong(): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
  });
  return formatter.format(new Date());
}
