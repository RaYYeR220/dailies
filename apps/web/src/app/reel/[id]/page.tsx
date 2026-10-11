import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchReel } from '../../../ui/api';
import { repoName } from '../../../ui/format';
import { ReelView } from '../../../ui/ReelView';
import shell from '../../shell.module.css';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const reel = await fetchReel(id).catch(() => null);
  return { title: reel ? `${reel.storyboard?.repo ?? repoName(reel.run.repoUrl)}, the reel` : 'Reel not found' };
}

export default async function ReelPage({ params }: Params) {
  const { id } = await params;
  const reel = await fetchReel(id);
  if (!reel) notFound();
  return (
    <div className={shell.app}>
      <ReelView data={reel} />
    </div>
  );
}
