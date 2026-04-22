import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ConditionalEdge,
  computeSchemaHash,
  PredicateKind,
  resolveVisibility,
  SurveyQuestion,
  SurveySchema,
  validateDag
} from '../../shared/src';

const api = (path: string, init?: RequestInit) =>
  fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Request failed');
    return data;
  });

export function App() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [surveys, setSurveys] = useState<SurveySchema[]>([]);
  const [active, setActive] = useState<SurveySchema | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number | string[]>>({});
  const [error, setError] = useState('');

  const load = () => api('/surveys').then((data) => {
    setSurveys(data.surveys);
    setActive(data.surveys[0] ?? null);
  });

  useEffect(() => {
    if (user) load().catch((err) => setError(err.message));
  }, [user]);

  if (!user) return <Login onLogin={setUser} />;
  if (!active) return <main className="shell"><button onClick={() => setUser(null)}>Logout</button><p>No surveys.</p></main>;

  const validation = validateDag(active);
  const preview = resolveVisibility(active, answers);

  const saveDraft = async (next: SurveySchema) => {
    const survey = { ...next, schemaHash: computeSchemaHash(next) };
    setActive(survey);
    setSurveys((items) => items.map((item) => (item.id === survey.id ? survey : item)));
    await api(`/surveys/${survey.id}`, { method: 'PUT', body: JSON.stringify(survey) });
  };

  const publish = async () => {
    const data = await api(`/surveys/${active.id}/publish`, { method: 'POST', body: '{}' });
    setActive(data.survey);
    await load();
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CS458 Software Verification and Validation</p>
          <h1>ARES-X Survey Architect</h1>
        </div>
        <div className="session-chip" data-testid="session-user">{user.name} / {user.role}</div>
      </header>

      {error && <div className="alert" data-testid="web-error">{error}</div>}

      <section className="workspace">
        <aside className="panel survey-list" aria-label="Survey list">
          <h2>Surveys</h2>
          {surveys.map((survey) => (
            <button
              className={survey.id === active.id ? 'survey-button active' : 'survey-button'}
              data-testid={`survey-${survey.id}`}
              key={survey.id}
              onClick={() => setActive(survey)}
            >
              <span>{survey.title}</span>
              <small>v{survey.version}</small>
            </button>
          ))}
          <button
            className="ghost"
            data-testid="reset-seed"
            onClick={() => api('/test/reset', { method: 'POST' }).then(load)}
          >
            Reset Seed
          </button>
        </aside>

        <section className="panel architect">
          <div className="section-head">
            <div>
              <p className="eyebrow">Schema hash {active.schemaHash}</p>
              <h2>{active.title}</h2>
            </div>
            <button data-testid="publish-survey" disabled={!validation.valid} onClick={publish}>Publish v{active.version + 1}</button>
          </div>

          <QuestionEditor survey={active} onChange={saveDraft} />
          <EdgeEditor survey={active} onChange={saveDraft} />
        </section>

        <aside className="panel inspector">
          <h2>GBCR/RCLR Live Validation</h2>
          <div className={validation.valid ? 'status ok' : 'status bad'} data-testid="dag-status">
            {validation.valid ? 'DAG valid' : 'DAG invalid'}
          </div>
          <ul className="issue-list">
            {validation.issues.map((issue) => (
              <li key={`${issue.code}-${issue.edgeId ?? issue.nodeId ?? issue.message}`}>
                <strong>{issue.code}</strong> {issue.message}
              </li>
            ))}
          </ul>
          <h3>Native Preview Path</h3>
          <Preview survey={active} answers={answers} onAnswers={setAnswers} />
          <div className="preview-meta">
            <span data-testid="visible-path">Visible: {preview.visibleQuestionIds.join(' -> ')}</span>
            <span data-testid="send-state">Send: {preview.sendEnabled ? 'enabled' : 'blocked'}</span>
            <span>Stable: {preview.stableNodeId ?? 'none'}</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Login({ onLogin }: { onLogin: (user: { name: string; role: string }) => void }) {
  const [email, setEmail] = useState('admin@ares.test');
  const [password, setPassword] = useState('Admin123!');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <main className="auth-wrap">
      <form className="auth-card" data-testid="web-login-form" onSubmit={submit}>
        <h1>ARES<span>.</span>X</h1>
        <p>Secure adaptive survey orchestration.</p>
        {error && <div className="alert" role="alert">{error}</div>}
        <label>Email</label>
        <input data-testid="web-login-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Password</label>
        <input data-testid="web-login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="risk-panel">Risk-aware Project 1 login style adapted for ARES-X admin access.</div>
        <button data-testid="web-login-submit">Sign In</button>
      </form>
    </main>
  );
}

function QuestionEditor({ survey, onChange }: { survey: SurveySchema; onChange: (schema: SurveySchema) => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<SurveyQuestion['type']>('single');

  const addQuestion = () => {
    const id = `q-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now()}`;
    const question: SurveyQuestion = {
      id,
      title: title || 'New question',
      type,
      required: true,
      stable: false,
      options: type === 'single' || type === 'multiple'
        ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
        : undefined,
      min: type === 'rating' ? 1 : undefined,
      max: type === 'rating' ? 5 : undefined
    };
    setTitle('');
    onChange({ ...survey, questions: [...survey.questions, question] });
  };

  return (
    <div className="editor-block">
      <h3>Questions</h3>
      <div className="question-grid">
        {survey.questions.map((question) => (
          <article className="question-card" data-testid={`question-editor-${question.id}`} key={question.id}>
            <input
              value={question.title}
              onChange={(e) => onChange({
                ...survey,
                questions: survey.questions.map((item) => item.id === question.id ? { ...item, title: e.target.value } : item)
              })}
            />
            <small>{question.id} / {question.type}</small>
            <label className="toggle"><input type="checkbox" checked={question.required} onChange={(e) => onChange({
              ...survey,
              questions: survey.questions.map((item) => item.id === question.id ? { ...item, required: e.target.checked } : item)
            })} /> required</label>
            <label className="toggle"><input type="checkbox" checked={question.stable} onChange={(e) => onChange({
              ...survey,
              questions: survey.questions.map((item) => item.id === question.id ? { ...item, stable: e.target.checked } : item)
            })} /> stable</label>
          </article>
        ))}
      </div>
      <div className="inline-form">
        <input data-testid="new-question-title" placeholder="Question title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as SurveyQuestion['type'])}>
          <option value="single">Single choice</option>
          <option value="multiple">Multiple choice</option>
          <option value="rating">Rating</option>
          <option value="text">Open-ended</option>
        </select>
        <button data-testid="add-question" onClick={addQuestion}>Add</button>
      </div>
    </div>
  );
}

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
      <div className="edge-list">
        {survey.edges.map((edge) => (
          <div className="edge-row" data-testid={`edge-${edge.id}`} key={edge.id}>
            <span>{edge.from} {'->'} {edge.to}</span>
            <code>{edge.predicate.kind} {String(edge.predicate.value ?? '')}</code>
            <button onClick={() => onChange({ ...survey, edges: survey.edges.filter((item) => item.id !== edge.id) })}>Delete</button>
          </div>
        ))}
      </div>
      <div className="inline-form">
        <select data-testid="edge-from" value={from} onChange={(e) => setFrom(e.target.value)}>{survey.questions.map((q) => <option key={q.id}>{q.id}</option>)}</select>
        <select data-testid="edge-to" value={to} onChange={(e) => setTo(e.target.value)}>{survey.questions.map((q) => <option key={q.id}>{q.id}</option>)}</select>
        <select value={kind} onChange={(e) => setKind(e.target.value as PredicateKind)}>
          <option value="answered">answered</option>
          <option value="not-answered">not-answered</option>
          <option value="equals">equals</option>
          <option value="includes">includes</option>
          <option value="rating-at-least">rating-at-least</option>
        </select>
        <input data-testid="edge-value" value={value} onChange={(e) => setValue(e.target.value)} />
        <button data-testid="add-edge" onClick={addEdge}>Connect</button>
      </div>
    </div>
  );
}

function Preview({
  survey,
  answers,
  onAnswers
}: {
  survey: SurveySchema;
  answers: Record<string, string | number | string[]>;
  onAnswers: (answers: Record<string, string | number | string[]>) => void;
}) {
  const visibility = useMemo(() => resolveVisibility(survey, answers), [survey, answers]);
  const visibleQuestions = survey.questions.filter((q) => visibility.visibleQuestionIds.includes(q.id));
  return (
    <div className="preview">
      {visibleQuestions.map((question) => (
        <label className="preview-question" data-testid={`preview-${question.id}`} key={question.id}>
          <span>{question.title}</span>
          {question.type === 'rating' ? (
            <input type="range" min={question.min ?? 1} max={question.max ?? 5} value={Number(answers[question.id] ?? question.min ?? 1)} onChange={(e) => onAnswers({ ...answers, [question.id]: Number(e.target.value) })} />
          ) : question.type === 'text' ? (
            <textarea value={String(answers[question.id] ?? '')} onChange={(e) => onAnswers({ ...answers, [question.id]: e.target.value })} />
          ) : (
            <select value={String(answers[question.id] ?? '')} onChange={(e) => onAnswers({ ...answers, [question.id]: e.target.value })}>
              <option value="">Choose</option>
              {question.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        </label>
      ))}
      <button data-testid="preview-send" disabled={!visibility.sendEnabled}>Send</button>
    </div>
  );
}
