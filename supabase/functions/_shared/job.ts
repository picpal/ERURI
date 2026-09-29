export type Job = {
  id: string;
  kind: string;
  user_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  checkpoint: string | null;
};
