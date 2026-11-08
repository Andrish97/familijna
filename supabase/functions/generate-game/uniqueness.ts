// Porównanie dokładne i tekstowe działa niezależnie od dostępności modelu.
export const SEMANTIC_MODEL = "paraphrase-multilingual-minilm-l12-v2-qa-v1";
export type QuestionVector = { question_pos: number; embedding: number[] };
export type SemanticState = { status: string; complete?: boolean; error?: string; [key: string]: unknown };

export function normalizedVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 384 || value.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('invalid_semantic_response');
  const norm = Math.sqrt(value.reduce((sum, n) => sum + n * n, 0));
  if (!Number.isFinite(norm) || norm < 1e-10) throw new Error('invalid_semantic_response');
  return value.map(n => n / norm);
}

export async function embedQuestions(questions: { question_pos: number; text: string }[], env: (key: string) => string | undefined): Promise<QuestionVector[]> {
  const base = (env('MARKET_SEMANTIC_URL') || '').replace(/\/+$/, '');
  const token = env('MARKET_SEMANTIC_TOKEN') || ''; // E24 R25: osobny sekret, bez zapasowego
  if (!base || !token) throw new Error('semantic_not_configured');
  const result: QuestionVector[] = [];
  for (let offset = 0; offset < questions.length; offset += 32) {
    const batch = questions.slice(offset, offset + 32);
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(`${base}/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': token },
        body: JSON.stringify({ model: SEMANTIC_MODEL, texts: batch.map(q => q.text) }), signal: AbortSignal.timeout(25000) });
      if (response.status !== 429 || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    if (!response?.ok) throw new Error(`semantic_http_${response?.status || 503}`);
    const body = await response.json();
    if (body.ok === false || body.model !== SEMANTIC_MODEL || !Array.isArray(body.vectors) || body.vectors.length !== batch.length) throw new Error('invalid_semantic_response');
    for (let i = 0; i < batch.length; i++) result.push({ question_pos: batch[i].question_pos, embedding: normalizedVector(body.vectors[i]) });
  }
  return result;
}

async function rpc(client: any, name: string, params: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw new Error(`${name}_failed`);
  return data;
}

export async function indexSemanticQuestions(client: any, env: (key: string) => string | undefined, { id = null, limit = 5 }: { id?: string | null; limit?: number } = {}) {
  const jobs = await rpc(client, 'market_embedding_jobs', { p_model: SEMANTIC_MODEL, p_limit: Math.min(25, Math.max(1, limit)), p_id: id });
  if (!jobs?.length) return { ok: true, processed: 0, games: 0, complete: true };
  if (!env('MARKET_SEMANTIC_URL')) return { ok: false, error: 'semantic_not_configured', processed: 0, games: 0 };
  let processed = 0, games = 0;
  const started = Date.now();
  for (const job of jobs || []) {
    if (Date.now() - started > 35000) break;
    try {
      const vectors = await embedQuestions(job.questions, env);
      const stored = await rpc(client, 'market_store_question_embeddings', { p_id: job.game_id, p_revision: job.revision, p_model: SEMANTIC_MODEL, p_vectors: vectors });
      if (!stored?.ok) return { ok: false, error: stored?.error || 'semantic_store_failed', processed, games };
      processed += Number(stored.stored) || 0; games++;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'semantic_unavailable', processed, games };
    }
  }
  const remaining = await rpc(client, 'market_embedding_jobs', { p_model: SEMANTIC_MODEL, p_limit: 1, p_id: id });
  return { ok: true, processed, games, complete: !remaining?.length };
}

export async function checkGameUniqueness(client: any, env: (key: string) => string | undefined, args: { id?: string; payload?: any; lang?: string }) {
  let vectors: QuestionVector[] | null = null;
  let semanticError = '';
  try {
    if (args.id) {
      const indexed = await indexSemanticQuestions(client, env, { id: args.id, limit: 1 });
      if (!indexed.ok) semanticError = indexed.error || 'semantic_unavailable';
    } else if (Array.isArray(args.payload?.questions)) {
      const inputs = await rpc(client, 'market_embedding_inputs', { p_payload: args.payload });
      vectors = await embedQuestions(inputs, env);
    }
  } catch (error) { semanticError = error instanceof Error ? error.message : 'semantic_unavailable'; }
  // Brak modelu nie wyłącza porównania dokładnego ani tekstowego.
  const report = await rpc(client, 'market_uniqueness_report', { p_id: args.id || null, p_payload: args.payload || null,
    p_lang: args.lang || 'pl', p_vectors: vectors, p_model: SEMANTIC_MODEL });
  if (!report?.ok) throw new Error(report?.error || 'uniqueness_check_failed');
  if (semanticError) report.semantic = { ...report.semantic, status: 'unavailable', complete: false, error: semanticError };
  return report;
}

export function isExactCopyError(error: any): boolean {
  return error?.code === '23505' && [error?.message, error?.details, error?.constraint].some(value => String(value || '').includes('market_games_active_content_unique'));
}
