import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchRun } from '../../../ui/api';
import { repoName } from '../../../ui/format';
import { RunView } from '../../../ui/RunView';
import shell from '../../shell.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const found = await fetchRun(id).catch(() => null);
  return { title: found ? `${repoName(found.run.repoUrl)}, the run` : 'Run not found' };
}

export default async function RunPage({ params }: Params) {
  const { id } = await params;
  const found = await fetchRun(id);
  if (!found) notFound();
  return (
    <div className={shell.app}>
      <RunView initial={found} />
    </div>
  );
}
