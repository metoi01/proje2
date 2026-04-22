# ARES-X Report Code Snippets

Bu dosya rapora koyulabilecek kritik ARES-X kod parçalarını içerir. Tam kod yerine DAG/GBCR/RCLR, schema versioning, atomic recovery, rollback, mobil rendering ve backend sync davranışını gösteren seçilmiş snippetler verilmiştir.

## 1. Survey Graph Model

Kaynak: `shared/src/types.ts`

```ts
export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  title: string;
  required: boolean;
  stable: boolean;
  options?: QuestionOption[];
  min?: number;
  max?: number;
}

export interface ConditionalEdge {
  id: string;
  from: string;
  to: string;
  predicate: Predicate;
}

export interface SurveySchema {
  id: string;
  title: string;
  description: string;
  version: number;
  schemaHash: string;
  questions: SurveyQuestion[];
  edges: ConditionalEdge[];
  publishedAt?: string;
}
```

Bu modelde survey bir directed graph olarak tutulur. `questions` node listesidir, `edges` ise node'lar arası koşullu geçişleri temsil eder.

## 2. DAG-Based Survey Logic Example

Kaynak: `shared/src/fixtures.ts`

```ts
edges: [
  {
    id: 'e-channel-mobile',
    from: 'q-channel',
    to: 'q-mobile-rating',
    predicate: { kind: 'equals', questionId: 'q-channel', value: 'mobile' }
  },
  {
    id: 'e-channel-web',
    from: 'q-channel',
    to: 'q-web-rating',
    predicate: { kind: 'equals', questionId: 'q-channel', value: 'web' }
  },
  {
    id: 'e-mobile-final',
    from: 'q-mobile-rating',
    to: 'q-final',
    predicate: { kind: 'answered', questionId: 'q-mobile-rating' }
  }
]
```

Bu snippet ARES-X'te branching survey akışının node-edge yapısıyla kurulduğunu gösterir.

## 3. Conditional Logic Evaluation

Kaynak: `shared/src/gbcr.ts`

```ts
export function predicateSatisfied(
  predicate: Predicate,
  edge: ConditionalEdge,
  answers: AnswerMap
): boolean {
  const questionId = predicate.questionId ?? edge.from;
  const answer = answers[questionId];

  switch (predicate.kind) {
    case 'equals':
      return answer === predicate.value;
    case 'includes':
      return Array.isArray(answer) && answer.includes(String(predicate.value));
    case 'rating-at-least':
      return typeof answer === 'number' && answer >= Number(predicate.value);
    case 'answered':
      return isAnswered(answer);
    case 'not-answered':
      return !isAnswered(answer);
    default:
      return false;
  }
}
```

Koşullu edge'in aktif olup olmadığı bu fonksiyonla değerlendirilir.

## 4. GBCR - DAG Validation

Kaynak: `shared/src/gbcr.ts`

```ts
export function validateDag(schema: SurveySchema): DagValidationResult {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const q of schema.questions) {
    if (!q.id.trim()) {
      issues.push({ code: 'EMPTY_NODE_ID', severity: 'error', message: 'Question id cannot be empty.' });
      continue;
    }
    if (nodeIds.has(q.id)) {
      issues.push({ code: 'DUPLICATE_NODE', severity: 'error', message: `Duplicate question id ${q.id}.`, nodeId: q.id });
    }
    nodeIds.add(q.id);
    incoming.set(q.id, 0);
    outgoing.set(q.id, []);
  }

  for (const edge of schema.edges) {
    if (!nodeIds.has(edge.from)) {
      issues.push({ code: 'MISSING_EDGE_SOURCE', severity: 'error', message: `${edge.id} points from a missing question.`, edgeId: edge.id });
    }
    if (!nodeIds.has(edge.to)) {
      issues.push({ code: 'MISSING_EDGE_TARGET', severity: 'error', message: `${edge.id} points to a missing question.`, edgeId: edge.id });
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const roots = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  const indegree = new Map(incoming);
  const queue = roots.slice();
  const topologicalOrder: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }

  if (topologicalOrder.length !== schema.questions.length) {
    issues.push({ code: 'CYCLE_DETECTED', severity: 'error', message: 'Conditional logic must be acyclic.' });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    roots,
    topologicalOrder
  };
}
```

GBCR tarafında schema publish edilmeden önce duplicate node, missing edge endpoint, root availability ve cycle detection kontrol edilir.

## 5. RCLR - Recursive Conditional Logic Resolution

Kaynak: `shared/src/gbcr.ts`

```ts
export function resolveVisibility(schema: SurveySchema, answers: AnswerMap): VisibilityResult {
  const validation = validateDag(schema);
  const questions = questionMap(schema);
  const incomingByTarget = new Map<string, ConditionalEdge[]>();
  const outgoingBySource = new Map<string, ConditionalEdge[]>();

  for (const edge of schema.edges) {
    if (!questions.has(edge.from) || !questions.has(edge.to)) continue;
    incomingByTarget.set(edge.to, [...(incomingByTarget.get(edge.to) ?? []), edge]);
    outgoingBySource.set(edge.from, [...(outgoingBySource.get(edge.from) ?? []), edge]);
  }

  const visible = new Set<string>();
  const orphanQuestionIds = new Set<string>();
  const roots = validation.roots.length ? validation.roots : schema.questions.slice(0, 1).map((q) => q.id);

  const visit = (id: string) => {
    if (visible.has(id) || !questions.has(id)) return;
    visible.add(id);
    for (const edge of outgoingBySource.get(id) ?? []) {
      if (predicateSatisfied(edge.predicate, edge, answers)) {
        visit(edge.to);
      }
    }
  };
  roots.forEach(visit);

  for (const id of [...visible]) {
    if (roots.includes(id)) continue;
    const parents = incomingByTarget.get(id) ?? [];
    const hasLogicalParent = parents.some((edge) =>
      visible.has(edge.from) && predicateSatisfied(edge.predicate, edge, answers)
    );
    if (!hasLogicalParent) orphanQuestionIds.add(id);
  }

  const visibleQuestionIds = validation.topologicalOrder.filter((id) => visible.has(id));
  const blockers = visibleQuestionIds
    .map((id) => questions.get(id)!)
    .filter((q) => q.required && !isAnswered(answers[q.id]))
    .map((q) => q.id);

  const hiddenClearedAnswerIds = Object.keys(answers).filter((id) => !visible.has(id));
  const answeredVisibleStable = visibleQuestionIds
    .map((id) => questions.get(id)!)
    .filter((q) => q.stable && isAnswered(answers[q.id]));
  const fallbackStable = visibleQuestionIds
    .map((id) => questions.get(id)!)
    .find((q) => q.stable);

  return {
    visibleQuestionIds,
    sendEnabled: blockers.length === 0 && orphanQuestionIds.size === 0 && validation.valid,
    blockers,
    stableNodeId: answeredVisibleStable.at(-1)?.id ?? fallbackStable?.id ?? null,
    orphanQuestionIds: [...orphanQuestionIds],
    hiddenClearedAnswerIds
  };
}
```

RCLR root node'lardan başlar, koşulu sağlanan edge'leri recursive şekilde dolaşır ve görünür soru listesini hesaplar. Aynı zamanda orphan/zombie node, required blocker, hidden answer cleanup ve stable rollback node bilgisini üretir.

## 6. Schema Hashing and Versioning

Kaynak: `shared/src/gbcr.ts`, `backend/src/app.ts`

```ts
export function computeSchemaHash(schema: Omit<SurveySchema, 'schemaHash'> | SurveySchema): string {
  const clone = JSON.parse(JSON.stringify(schema)) as SurveySchema;
  clone.schemaHash = '';
  const input = stableStringify({
    id: clone.id,
    title: clone.title,
    description: clone.description,
    questions: clone.questions,
    edges: clone.edges
  });

  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `gbcr-${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

app.post('/api/surveys/:id/publish', (req, res) => {
  const db = store.read();
  const existing = db.surveys.find((survey) => survey.id === req.params.id);
  const validation = validateDag(existing);
  if (!validation.valid) return res.status(400).json({ validation });

  const published: SurveySchema = {
    ...existing,
    version: existing.version + 1,
    publishedAt: now()
  };
  published.schemaHash = computeSchemaHash(published);

  store.update((draft) => {
    const index = draft.surveys.findIndex((survey) => survey.id === published.id);
    draft.surveys[index] = published;
    draft.history[published.id] = [...(draft.history[published.id] ?? []), published];
  });

  return res.json({ survey: published, validation });
});
```

Her publish işleminde schema version artırılır, hash yeniden hesaplanır ve eski versiyon history içine alınır.

## 7. Backend Schema Fetch

Kaynak: `backend/src/app.ts`

```ts
app.get('/api/surveys/:id/schema', (req, res) => {
  const db = store.read();
  const requestedVersion = req.query.version ? Number(req.query.version) : null;
  const schema = requestedVersion
    ? (db.history[req.params.id] ?? []).find((entry) => entry.version === requestedVersion)
    : db.surveys.find((survey) => survey.id === req.params.id);

  if (!schema) return res.status(404).json({ error: 'Schema not found' });
  return res.json({ schema, validation: validateDag(schema) });
});
```

Mobil veya web client güncel schema'yı ya da belirli bir eski versiyonu bu endpoint üzerinden alabilir.

## 8. Mobile Session and Backend Schema Version Comparison

Kaynak: `backend/src/app.ts`

```ts
app.patch('/api/sessions/:id/answers', (req, res) => {
  const { answers = {}, clientSchemaVersion } = req.body as {
    answers: AnswerMap;
    clientSchemaVersion?: number;
  };

  const db = store.read();
  const session = db.sessions.find((candidate) => candidate.id === req.params.id);
  const currentSchema = db.surveys.find((survey) => survey.id === session.surveyId);
  const clientVersion = clientSchemaVersion ?? session.schemaVersion;
  const oldSchema =
    (db.history[session.surveyId] ?? []).find((schema) => schema.version === clientVersion)
    ?? currentSchema;

  let payload;
  if (clientVersion !== currentSchema.version) {
    const resolution = resolveSyncConflict(oldSchema, currentSchema, answers);
    session.answers = resolution.preservedAnswers;
    session.schemaVersion = currentSchema.version;
    session.stableNodeId = resolution.rollbackStableNodeId ?? resolution.visibility.stableNodeId;
    session.status = resolution.action === 'conflict' ? 'conflict' : 'active';
    payload = { session, schema: currentSchema, resolution };
  }

  store.write(db);
  return res.json(payload);
});
```

Backend, mobilin gönderdiği `clientSchemaVersion` ile güncel schema versiyonunu karşılaştırır. Fark varsa sync conflict resolution çalışır.

## 9. Atomic State Recovery

Kaynak: `shared/src/gbcr.ts`

```ts
export function resolveSyncConflict(
  oldSchema: SurveySchema,
  newSchema: SurveySchema,
  clientAnswers: AnswerMap
): SyncResolution {
  const newQuestionById = questionMap(newSchema);
  const oldQuestionById = questionMap(oldSchema);
  const oldVisibility = resolveVisibility(oldSchema, clientAnswers);
  const preservedAnswers: AnswerMap = {};
  const droppedAnswerIds: string[] = [];

  for (const [id, value] of Object.entries(clientAnswers)) {
    const oldQuestion = oldQuestionById.get(id);
    const newQuestion = newQuestionById.get(id);
    if (!oldQuestion || !newQuestion || oldQuestion.type !== newQuestion.type) {
      droppedAnswerIds.push(id);
      continue;
    }
    preservedAnswers[id] = value;
  }

  const visibility = resolveVisibility(newSchema, preservedAnswers);
  const hiddenAnswered = Object.keys(preservedAnswers).filter((id) =>
    !visibility.visibleQuestionIds.includes(id)
  );

  if (hiddenAnswered.length) {
    hiddenAnswered.forEach((id) => {
      delete preservedAnswers[id];
      droppedAnswerIds.push(id);
    });
  }

  // Rollback/conflict guard clauses pass before this success branch is returned.
  return {
    action: 'atomic_recovery',
    message: 'Schema version changed; answers were atomically mapped to the new DAG.',
    preservedAnswers,
    droppedAnswerIds,
    rollbackStableNodeId: null,
    visibility
  };
}
```

Atomic recovery, eski cevapları yeni graph yapısındaki aynı id ve aynı type'a sahip node'lara map eder. Yeni DAG'da gizli kalan cevaplar atomik olarak temizlenir.

## 10. Session Rollback Mechanism

Kaynak: `shared/src/gbcr.ts`

```ts
const removedVisiblePathIds = oldVisibility.visibleQuestionIds.filter((id) => !newQuestionById.has(id));
if (removedVisiblePathIds.length) {
  return {
    action: 'rollback',
    conflictCode: 'RCLR_ROLLBACK',
    message: 'A visible path node was removed by a newer schema; session rolled back to the last stable node.',
    preservedAnswers,
    droppedAnswerIds: [...new Set([...droppedAnswerIds, ...removedVisiblePathIds])],
    rollbackStableNodeId: visibility.stableNodeId,
    visibility
  };
}

if (visibility.orphanQuestionIds.length) {
  return {
    action: 'conflict',
    conflictCode: 'RCLR_CONFLICT',
    message: 'The new schema would expose a zombie question without a logical parent.',
    preservedAnswers,
    droppedAnswerIds,
    rollbackStableNodeId: visibility.stableNodeId,
    visibility
  };
}

if (droppedAnswerIds.length) {
  return {
    action: 'rollback',
    conflictCode: 'RCLR_ROLLBACK',
    message: 'Schema changed incompatibly; session rolled back to the last stable node.',
    preservedAnswers,
    droppedAnswerIds,
    rollbackStableNodeId: visibility.stableNodeId,
    visibility: resolveVisibility(newSchema, preservedAnswers)
  };
}
```

Schema değişimi görünür path'i kırarsa, zombie/orphan node üretirse veya cevap tipi artık korunamazsa session son stable node'a rollback edilir.

## 11. Mobile RCLR Engine

Kaynak: `mobile/app/src/main/java/edu/bilkent/aresx/RclrEngine.kt`

```kotlin
object RclrEngine {
    fun resolveVisibility(schema: SurveySchema, answers: Map<String, Any?>): VisibilityResult {
        val questionById = schema.questions.associateBy { it.id }
        val incoming = schema.edges.groupBy { it.to }
        val outgoing = schema.edges.groupBy { it.from }
        val roots = schema.questions
            .filter { question -> schema.edges.none { it.to == question.id } }
            .map { it.id }
            .ifEmpty { schema.questions.take(1).map { it.id } }

        val visible = linkedSetOf<String>()
        fun visit(id: String) {
            if (!questionById.containsKey(id) || !visible.add(id)) return
            outgoing[id].orEmpty()
                .filter { predicateSatisfied(it.predicate, it, answers) }
                .forEach { visit(it.to) }
        }
        roots.forEach { visit(it) }

        val orphan = visible.filter { id ->
            id !in roots && incoming[id].orEmpty().none { edge ->
                edge.from in visible && predicateSatisfied(edge.predicate, edge, answers)
            }
        }
        val ordered = topologicalOrder(schema).filter { it in visible }
        val blockers = ordered.mapNotNull { id ->
            val q = questionById[id]
            if (q?.required == true && !isAnswered(answers[id])) id else null
        }
        val answeredStable = ordered.mapNotNull { questionById[it] }.filter { it.stable && isAnswered(answers[it.id]) }
        val fallbackStable = ordered.mapNotNull { questionById[it] }.firstOrNull { it.stable }

        return VisibilityResult(
            visibleQuestionIds = ordered,
            sendEnabled = blockers.isEmpty() && orphan.isEmpty() && validateDag(schema),
            blockers = blockers,
            stableNodeId = answeredStable.lastOrNull()?.id ?: fallbackStable?.id,
            orphanQuestionIds = orphan,
            hiddenClearedAnswerIds = answers.keys.filter { it !in visible }
        )
    }
}
```

Android client backend ile aynı RCLR mantığını native Kotlin tarafında çalıştırır.

## 12. Mobile Survey Rendering Logic

Kaynak: `mobile/app/src/main/java/edu/bilkent/aresx/MainActivity.kt`

```kotlin
private fun showSurvey() {
    val current = schema ?: return
    val visibility = RclrEngine.resolveVisibility(current, answers)
    val root = ScrollView(this)
    val content = column()
    root.addView(content)

    content.addView(title(current.title, 26))
    content.addView(text("Schema v${current.version} / ${current.schemaHash}", 12, "#8F98AD"))

    current.questions
        .filter { it.id in visibility.visibleQuestionIds }
        .forEach { question -> renderQuestion(content, question) }

    val send = button("Send", "send-button")
    send.isEnabled = visibility.sendEnabled
    send.alpha = if (visibility.sendEnabled) 1f else .45f
    content.addView(send)
    content.addView(text("Visible path: ${visibility.visibleQuestionIds.joinToString(" -> ")}", 12, "#8F98AD"))
    setContentView(root)
}
```

Mobil ekran, RCLR çıktısındaki `visibleQuestionIds` listesine göre dinamik olarak yeniden oluşturulur.

## 13. Question Type Rendering System

Kaynak: `mobile/app/src/main/java/edu/bilkent/aresx/MainActivity.kt`

```kotlin
private fun renderQuestion(parent: LinearLayout, question: SurveyQuestion) {
    parent.addView(text(question.title, 17, "#E8EAF6"))

    when (question.type) {
        "single" -> {
            val group = RadioGroup(this)
            question.options.forEach { option ->
                val rb = RadioButton(this)
                rb.text = option.label
                rb.isChecked = answers[question.id] == option.value
                rb.setOnClickListener { setAnswer(question.id, option.value) }
                group.addView(rb)
            }
            parent.addView(group)
        }
        "multiple" -> {
            val selected = (answers[question.id] as? List<*>)?.map { it.toString() }?.toMutableSet() ?: mutableSetOf()
            question.options.forEach { option ->
                val cb = CheckBox(this)
                cb.text = option.label
                cb.isChecked = selected.contains(option.value)
                cb.setOnCheckedChangeListener { _, checked ->
                    if (checked) selected.add(option.value) else selected.remove(option.value)
                    setAnswer(question.id, selected.toList())
                }
                parent.addView(cb)
            }
        }
        "rating" -> {
            val row = LinearLayout(this)
            for (score in question.min..question.max) {
                val b = button(score.toString(), "answer-${question.id}-$score")
                b.setOnClickListener { setAnswer(question.id, score) }
                row.addView(b)
            }
            parent.addView(row)
        }
        else -> {
            val input = edit(answers[question.id]?.toString() ?: "", "answer-${question.id}-text")
            input.setOnFocusChangeListener { _, hasFocus ->
                if (!hasFocus) setAnswer(question.id, input.text.toString())
            }
            parent.addView(input)
        }
    }
}
```

ARES-X mobile client tek schema modelinden single choice, multiple choice, rating ve text input UI'larını üretir.

## 14. Mobile Answer Submission and Synchronization

Kaynak: `mobile/app/src/main/java/edu/bilkent/aresx/MainActivity.kt`

```kotlin
private fun setAnswer(id: String, value: Any?) {
    answers[id] = value
    val current = schema ?: return
    val visibility = RclrEngine.resolveVisibility(current, answers)
    visibility.hiddenClearedAnswerIds.forEach { answers.remove(it) }
    syncAnswers()
    showSurvey()
}

private fun syncAnswers() {
    val current = schema ?: return
    val sid = sessionId ?: return
    val jsonAnswers = JSONObject()
    answers.forEach { (key, value) ->
        when (value) {
            is List<*> -> jsonAnswers.put(key, JSONArray(value))
            else -> jsonAnswers.put(key, value)
        }
    }

    val body = JSONObject()
        .put("clientSchemaVersion", current.version)
        .put("answers", jsonAnswers)

    postJson("/api/sessions/$sid/answers", body) { result, error ->
        if (error != null || result == null) return@postJson
        val resolution = result.getJSONObject("resolution")
        val action = resolution.getString("action")

        if (action != "ok" && action != "atomic_recovery") {
            conflictMessage = "${resolution.optString("conflictCode", "RCLR_CONFLICT")}: ${resolution.getString("message")}"
            schema = parseSchema(result.getJSONObject("schema"))
            answers.clear()
            val preserved = resolution.getJSONObject("preservedAnswers")
            preserved.keys().forEach { key -> answers[key] = preserved.get(key) }
            showSurvey()
        } else if (action == "atomic_recovery") {
            conflictMessage = "ATOMIC_RECOVERY: ${resolution.getString("message")}"
            schema = parseSchema(result.getJSONObject("schema"))
            showSurvey()
        }
    }
}
```

Her cevap değişiminde mobil client local RCLR hesaplar, gizli cevapları temizler, backend'e schema version ile birlikte cevapları gönderir ve backend resolution sonucuna göre UI'ı günceller.

## 15. Web Architect Graph Management

Kaynak: `web/src/App.tsx`

```tsx
function EdgeEditor({ survey, onChange }: { survey: SurveySchema; onChange: (schema: SurveySchema) => void }) {
  const [from, setFrom] = useState(survey.questions[0]?.id ?? '');
  const [to, setTo] = useState(survey.questions[1]?.id ?? '');
  const [kind, setKind] = useState<PredicateKind>('answered');
  const [value, setValue] = useState('mobile');

  const addEdge = () => {
    const edge: ConditionalEdge = {
      id: `e-${from}-${to}-${Date.now()}`,
      from,
      to,
      predicate: { kind, questionId: from, value: kind === 'rating-at-least' ? Number(value) : value }
    };
    onChange({ ...survey, edges: [...survey.edges, edge] });
  };

  return (
    <div className="editor-block">
      <h3>Conditional Edges</h3>
      {survey.edges.map((edge) => (
        <div className="edge-row" data-testid={`edge-${edge.id}`} key={edge.id}>
          <span>{edge.from} {'->'} {edge.to}</span>
          <code>{edge.predicate.kind} {String(edge.predicate.value ?? '')}</code>
          <button onClick={() => onChange({
            ...survey,
            edges: survey.edges.filter((item) => item.id !== edge.id)
          })}>Delete</button>
        </div>
      ))}
      <button data-testid="add-edge" onClick={addEdge}>Connect</button>
    </div>
  );
}
```

Web Architect, conditional edge ekleme/silme ile survey graph'ını yönetir. Publish sırasında backend bu graph'ı GBCR ile doğrular.

## 16. Backend Data Store for Version History and Sessions

Kaynak: `backend/src/store.ts`

```ts
interface DatabaseShape {
  users: UserRecord[];
  surveys: SurveySchema[];
  history: Record<string, SurveySchema[]>;
  sessions: SurveySession[];
}

export class JsonStore {
  reset() {
    const seed = buildSeedSurvey(1);
    this.write({
      users: seedUsers,
      surveys: [seed],
      history: { [seed.id]: [seed] },
      sessions: []
    });
  }

  update(mutator: (db: DatabaseShape) => void): DatabaseShape {
    const db = this.read();
    mutator(db);
    this.write(db);
    return db;
  }
}
```

Backend aynı anda güncel survey schema'yı, schema history'yi ve aktif mobile survey session'larını saklar.
