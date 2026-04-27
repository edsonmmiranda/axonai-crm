export interface DashboardMetrics {
  activeOrgsCount: number;
  activeUsersCount: number;
  leadsTotal: number;
  refreshedAt: string;
  /** true se lazy refresh falhou (ex: billing não tem permissão) */
  isStaleAfterFetch: boolean;
}

interface MetricsRow {
  id: number;
  active_orgs_count: number;
  active_users_count: number;
  leads_total: number;
  refreshed_at: string;
}

export function mapMetricsRow(row: MetricsRow, isStale = false): DashboardMetrics {
  return {
    activeOrgsCount:   row.active_orgs_count,
    activeUsersCount:  row.active_users_count,
    leadsTotal:        row.leads_total,
    refreshedAt:       row.refreshed_at,
    isStaleAfterFetch: isStale,
  };
}
