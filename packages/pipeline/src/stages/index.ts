import type { CostMeter, ModelClient } from '@dailies/agent';
import type { TtsProvider } from '@dailies/voice';
import type { Database } from '../types';

export type { EditArtifact } from './edit';
export type { VerifyArtifact } from './verify';
export type { ScriptArtifact } from './script';
export type { GroundArtifact } from './ground';
export type { GateArtifact } from './gate';

export interface StageDeps { db: Database; client: ModelClient; meter: CostMeter; tts: TtsProvider | null; voice: string }
