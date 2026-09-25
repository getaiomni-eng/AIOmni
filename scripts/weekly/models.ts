// Registry of weekly models the backtest can run by name.
import type { WeeklyModel } from '../../supabase/functions/_shared/weekly/types.ts';
import { modelRecency } from '../../supabase/functions/_shared/weekly/recency.ts';
import { modelMatchup } from '../../supabase/functions/_shared/weekly/matchup.ts';
import { modelContext } from '../../supabase/functions/_shared/weekly/context.ts';
import { ensembleModel } from '../../supabase/functions/_shared/weekly/ensemble.ts';

const BASE: Record<string, WeeklyModel> = {
  recency: modelRecency,   // A: last-5 / last-7 blend + usage-spike investigation
  matchup: modelMatchup,   // B: current-season defense-vs-role transfer + Vegas + weather + depth
  context: modelContext,   // C: travel + weather + usage + opponent strength, current season only
};

export const MODELS: Record<string, WeeklyModel> = {
  ...BASE,
  ensemble: ensembleModel(BASE),   // equal-weight rank average of the three (manual has no history)
};
