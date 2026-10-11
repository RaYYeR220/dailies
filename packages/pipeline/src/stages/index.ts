import type { CostMeter, ModelClient } from '@dailies/agent';
import type { TtsProvider } from '@dailies/voice';
import type { Database } from '../types';

export type { EditArtifact } from './edit';

export interface StageDeps { db: Database; client: ModelClient; meter: CostMeter; tts: TtsProvider | null; voice: string }
