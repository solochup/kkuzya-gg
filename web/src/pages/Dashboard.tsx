import { DataGate } from '../components/DataGate';
import { TrendCard } from '../components/TrendCard';
import { DnaCard } from './dashboard/DnaCard';
import { HeroesCard, RecentMatches } from './dashboard/HeroesMatches';
import { KpiGrid, ProfileHeader } from './dashboard/ProfileKpi';
import s from './dashboard/dashboard.module.css';

export default function Dashboard() {
  return (
    <DataGate>
      {(p) => (
        <div className={s.page}>
          <ProfileHeader p={p} />
          <KpiGrid p={p} />
          <div className={s.grid2}>
            <DnaCard p={p} />
            <TrendCard p={p} />
          </div>
          <div className={s.grid12}>
            <HeroesCard p={p} />
            <RecentMatches p={p} />
          </div>
        </div>
      )}
    </DataGate>
  );
}
