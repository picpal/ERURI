// 메일 요약 모델(스펙 §7 "모델") — S3 에서는 타입만. S4 가 summaryRequest·parseSummary·summarize 를 채운다
export type SummaryInput = { today: string; request: string; from: string; date: string; subject: string; body: string; translateSource: string | null };
export type SummaryOutput = { status: "ok" | "ask"; lines: string[]; dates: string[]; amounts: string[]; todos: string[]; language: string;
  translation: string | null; ask: string | null };
