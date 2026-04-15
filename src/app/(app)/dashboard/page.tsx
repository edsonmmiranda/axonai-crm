import {
  formatTodayLong,
  mockKpis,
  mockMonthlyGoal,
  mockPipelineStages,
  mockRecentLeads,
  mockSalesGoal,
  mockUpcomingTasks,
} from '@/lib/mocks/dashboard';

import { GoalsRow } from './_components/GoalsRow';
import { GreetingHeader } from './_components/GreetingHeader';
import { KpiCards } from './_components/KpiCards';
import { PipelineCard } from './_components/PipelineCard';
import { RecentLeadsTable } from './_components/RecentLeadsTable';
import { UpcomingTasksCard } from './_components/UpcomingTasksCard';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 pb-10">
      <GreetingHeader greeting="Bom dia, Roberto!" dateLabel={formatTodayLong()} />
      <KpiCards kpis={mockKpis} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <RecentLeadsTable leads={mockRecentLeads} />
          <GoalsRow salesGoal={mockSalesGoal} monthlyGoal={mockMonthlyGoal} />
        </div>
        <div className="flex flex-col gap-6">
          <PipelineCard stages={mockPipelineStages} />
          <UpcomingTasksCard tasks={mockUpcomingTasks} />
        </div>
      </div>
    </div>
  );
}
