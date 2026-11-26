import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ExternalLink,
  Globe2,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { searchBrief, type BriefResponse, type BriefSupport } from '../../lib/api';
import { runMentoSearch, SOURCES, type MentoResult } from './searchProviders';
import './search.css';

const PREFERENCES_KEY = 'mentosearch-preferences:v2';
const defaultSources = () =>
  SOURCES.filter((s) => s.defaultEnabled).map((s) => s.id);

type Tab = 'answer' | 'papers';

const SUPPORT_LABELS: Record<BriefSupport, string> = {
  strong: 'Strong evidence',
  partial: 'Partial evidence',
  general: 'General overview',
  'evidence-only': 'Sources only',
};

const scholarUrl = (title: string) =>
  `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`;

const sourceName = (id: string) =>
  SOURCES.find((source) => source.id === id)?.name ?? id;

function loadPreferences(): { sources: string[]; sort: 'relevance' | 'newest' } {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      return { sources: defaultSources(), sort: 'relevance' };
    }
    const parsed = JSON.parse(raw);
    const known = new Set(SOURCES.map((s) => s.id));
    return {
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((id: unknown): id is string =>
            typeof id === 'string' && known.has(id),
          )
        : defaultSources(),
      sort: parsed.sort === 'newest' ? 'newest' : 'relevance',
    };
  } catch {
    return { sources: defaultSources(), sort: 'relevance' };
  }
}

function savePreferences(prefs: { sources: string[]; sort: 'relevance' | 'newest' }) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export default function MentoSearchPage() {
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [tab, setTab] = useState<Tab>('answer');
  const [prefs, setPrefs] = useState(loadPreferences);
  const [sourcePreferences, setSourcePreferences] = useState<Set<string>>(
    () => new Set(prefs.sources),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);

  const [papers, setPapers] = useState<MentoResult[] | null>(null);
  const [papersLoading, setPapersLoading] = useState(false);
  const [papersError, setPapersError] = useState('');
  const [failedSources, setFailedSources] = useState<string[]>([]);

  const briefAbort = useRef<AbortController | null>(null);
  const papersAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    savePreferences({ sources: [...sourcePreferences], sort: prefs.sort });
  }, [sourcePreferences, prefs.sort]);

  useEffect(
    () => () => {
      briefAbort.current?.abort();
      papersAbort.current?.abort();
    },
    [],
  );

  const loadPapers = async (q: string) => {
    papersAbort.current?.abort();
    const controller = new AbortController();
    papersAbort.current = controller;
    setPapersLoading(true);
    setPapersError('');
    setFailedSources([]);
    try {
      const outcome = await runMentoSearch(q, sourcePreferences, controller.signal, 30_000);
      if (controller.signal.aborted) return;
      setPapers(outcome.results);
      setFailedSources(outcome.failedSources);
    } catch (err) {
      if (!controller.signal.aborted) {
        setPapersError(err instanceof Error ? err.message : 'Search failed');
        setPapers([]);
      }
    } finally {
      if (!controller.signal.aborted) setPapersLoading(false);
    }
  };

  useEffect(() => {
    if (tab !== 'papers' || !lastQuery) return;
    if (papers !== null || papersLoading) return;
    void loadPapers(lastQuery);
    // Papers load once per search, when their tab is first opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lastQuery, papers, papersLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || briefLoading) return;
    if (sourcePreferences.size === 0) {
      setBriefError('Enable at least one trusted source to search.');
      return;
    }
    briefAbort.current?.abort();
    papersAbort.current?.abort();
    const controller = new AbortController();
    briefAbort.current = controller;

    setTab('answer');
    setLastQuery(q);
    setBrief(null);
    setBriefError('');
    setBriefLoading(true);
    setPapers(null);
    setPapersError('');
    setFailedSources([]);
    setActiveEvidence(null);

    try {
      const data = await searchBrief(
        q,
        [...sourcePreferences],
        prefs.sort,
        controller.signal,
        25_000,
      );
      if (controller.signal.aborted) return;
      setBrief(data);
    } catch (err) {
      if (!controller.signal.aborted) {
        setBriefError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      if (!controller.signal.aborted) setBriefLoading(false);
    }
  };

  const toggleSource = (id: string) => {
    setSourcePreferences((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSort = (sort: 'relevance' | 'newest') => {
    setPrefs((previous) => ({ ...previous, sort }));
  };

  const focusEvidence = (id: string) => {
    setActiveEvidence(id);
    document
      .getElementById(`evidence-${id}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  };

  const evidenceNumber = (id: string) =>
    (brief?.evidence.findIndex((item) => item.id === id) ?? -1) + 1;

  const renderCitations = (ids: string[]) => {
    if (!ids.length) {
      return <span className="general-tag">General knowledge</span>;
    }
    return (
      <span className="citation-chips">
        {ids.map((id) => {
          const number = evidenceNumber(id);
          if (number < 1) return null;
          return (
            <button
              key={id}
              type="button"
              className="citation-chip"
              onClick={() => focusEvidence(id)}
              aria-label={`Show evidence ${number}`}
            >
              [{number}]
            </button>
          );
        })}
      </span>
    );
  };

  const renderAnswer = () => {
    if (briefLoading) {
      return (
        <div className="loading-skeleton" aria-live="polite">
          <div className="skeleton-answer">
            <div className="skeleton-meta"></div>
            <div className="skeleton-line"></div>
            <div className="skeleton-line short"></div>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton-result"></div>
          ))}
        </div>
      );
    }
    if (briefError) {
      return (
        <div className="empty-state error" role="alert">
          <p>{briefError}</p>
          <button
            type="button"
            className="secondary"
            onClick={handleSubmit}
          >
            Retry search
          </button>
        </div>
      );
    }
    if (!brief) {
      return (
        <div className="empty-state">
          <p>Ask about a topic to get an overview with supporting sources.</p>
        </div>
      );
    }

    const failed = brief.coverage.failed;
    return (
      <div className="answer-panel">
        {brief.support === 'evidence-only' && (
          <div className="brief-banner warning" role="status">
            <AlertTriangle size={16} />
            <span>
              The AI overview was unavailable, so this is a cited digest of the
              retrieved abstracts.
            </span>
          </div>
        )}
        {brief.support === 'general' && brief.evidence.length === 0 && (
          <div className="brief-banner warning" role="status">
            <AlertTriangle size={16} />
            <span>
              No matching papers were found. This overview uses general
              knowledge, so verify it before relying on it.
            </span>
          </div>
        )}
        {brief.cached && (
          <div className="brief-banner info" role="status">
            <ShieldCheck size={16} />
            <span>Cached answer from a recent search.</span>
          </div>
        )}
        {failed.length > 0 && (
          <div className="brief-banner warning" role="status">
            <AlertTriangle size={16} />
            <span>
              {failed.map(sourceName).join(', ')}{' '}
              {failed.length === 1 ? 'was' : 'were'} unavailable. Results from
              the other sources are shown.
            </span>
          </div>
        )}

        <div className="answer-header">
          <div>
            <span className="eyebrow">TOPIC OVERVIEW</span>
            <h2>{brief.brief.title}</h2>
          </div>
          <span className={`support-badge ${brief.support}`}>
            <Sparkles size={13} />
            {SUPPORT_LABELS[brief.support]}
          </span>
        </div>

        <p className="answer-overview">
          {brief.brief.overview}{' '}
          {renderCitations(brief.brief.overview_evidence_ids)}
        </p>

        {brief.brief.sections.map((section) => (
          <section className="answer-section" key={section.heading}>
            <h3>{section.heading}</h3>
            <ul>
              {section.points.map((point, index) => (
                <li key={`${section.heading}-${index}`}>
                  <span>{point.text}</span> {renderCitations(point.evidence_ids)}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {brief.brief.key_terms.length > 0 && (
          <div className="key-terms">
            <span className="pref-label">KEY TERMS</span>
            <div className="key-term-chips">
              {brief.brief.key_terms.map((term) => (
                <span className="key-term" key={term}>
                  {term}
                </span>
              ))}
            </div>
          </div>
        )}

        {brief.evidence.length > 0 && (
          <section className="evidence-section">
            <div className="evidence-header">
              <h3>
                <BookOpen size={18} /> Evidence ({brief.evidence.length})
              </h3>
              <a
                className="scholar-link"
                href={scholarUrl(brief.query)}
                target="_blank"
                rel="noreferrer"
              >
                <Globe2 size={16} /> Open in Google Scholar
              </a>
            </div>
            <ol className="evidence-list">
              {brief.evidence.map((item) => (
                <li
                  key={item.id}
                  id={`evidence-${item.id}`}
                  className={`evidence-card ${
                    activeEvidence === item.id ? 'active' : ''
                  }`}
                >
                  <span className="evidence-number">
                    {evidenceNumber(item.id)}
                  </span>
                  <div className="evidence-body">
                    <div className="evidence-meta">
                      <span className={`source-badge ${item.source}`}>
                        {sourceName(item.source)}
                      </span>
                      {item.year && <span className="year">{item.year}</span>}
                      {typeof item.citations === 'number' && (
                        <span className="citations">
                          {item.citations} citations
                        </span>
                      )}
                    </div>
                    <a
                      className="evidence-title"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.title} <ExternalLink size={13} />
                    </a>
                    {item.authors.length > 0 && (
                      <p className="result-authors">
                        {item.authors.slice(0, 4).join(', ')}
                        {item.authors.length > 4 && ' et al.'}
                      </p>
                    )}
                    {item.venue && (
                      <p className="result-doi">{item.venue}</p>
                    )}
                    <div className="evidence-actions">
                      <a
                        className="evidence-link"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View paper <ExternalLink size={13} />
                      </a>
                      <a
                        className="evidence-link"
                        href={item.scholar_url || scholarUrl(item.title)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Globe2 size={13} /> Verify on Google Scholar
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <p className="answer-disclaimer">
          AI overview generated from general knowledge and the papers shown.
          Points marked “General knowledge” are not drawn from a specific paper.
        </p>
      </div>
    );
  };

  const renderPapers = () => {
    if (papersLoading) {
      return (
        <div className="loading-skeleton" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-result">
                <div className="skeleton-meta"></div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (papersError) {
      return (
        <div className="empty-state error" role="alert">
          <p>{papersError}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void loadPapers(lastQuery)}
          >
            Retry search
          </button>
        </div>
      );
    }
    if (!papers) {
      return (
        <div className="empty-state">
          <p>Open this tab to load the full paper list.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void loadPapers(lastQuery)}
          >
            Load papers
          </button>
        </div>
      );
    }
    const sorted =
      prefs.sort === 'newest'
        ? [...papers].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        : papers;
    return (
      <>
        {failedSources.length > 0 && (
          <div className="empty-state warning" role="status">
            <p>
              {failedSources.join(', ')}{' '}
              {failedSources.length === 1 ? 'is' : 'are'} unavailable right
              now. Results from the other sources are shown.
            </p>
          </div>
        )}
        <div className="results-header">
          <div className="result-count">
            {sorted.length} paper{sorted.length === 1 ? '' : 's'} for “{lastQuery}”
          </div>
          <a
            className="scholar-link"
            href={scholarUrl(lastQuery)}
            target="_blank"
            rel="noreferrer"
          >
            <Globe2 size={16} /> Open in Google Scholar
          </a>
        </div>
        {sorted.length > 0 ? (
          <ol className="results-list">
            {sorted.map((result) => (
              <li key={result.id} className="result-item">
                <div className="result-header">
                  <span className={`source-badge ${result.sourceId}`}>
                    {result.sourceName}
                  </span>
                  {result.year && <span className="year">{result.year}</span>}
                  {typeof result.citations === 'number' && (
                    <span className="citations">
                      {result.citations} citations
                    </span>
                  )}
                </div>
                <a
                  className="result-title"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.title} <ExternalLink size={14} />
                </a>
                {result.authors.length > 0 && (
                  <p className="result-authors">
                    {result.authors.slice(0, 4).join(', ')}
                    {result.authors.length > 4 && ' et al.'}
                  </p>
                )}
                {result.abstract && (
                  <p className="result-abstract">
                    {result.abstract.slice(0, 240)}…
                  </p>
                )}
                {result.doi && (
                  <p className="result-doi">DOI: {result.doi}</p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state">
            <p>
              {failedSources.length > 0 &&
              failedSources.length >= sourcePreferences.size
                ? 'The selected sources are unavailable right now. Try again in a moment.'
                : 'No papers found. Try different keywords or enable more sources.'}
            </p>
          </div>
        )}
      </>
    );
  };

  return (
    <section className="mentosearch-screen">
      <div className="page-title">
        <span className="eyebrow">TRUSTED TOPIC SEARCH</span>
        <h1>MentoSearch</h1>
        <p>
          Ask about a topic and get a clear overview with the papers that
          support it. Use Google Scholar to verify any source.
        </p>
      </div>

      <div className="search-container">
        <form className="search-form" onSubmit={handleSubmit}>
          <Search size={20} />
          <input
            id="topic-search"
            name="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about a topic, e.g. “IT fundamentals”"
            aria-label="Search topics"
          />
          {query && (
            <button
              type="button"
              className="clear-btn"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="submit"
            className="primary"
            disabled={briefLoading || !query.trim()}
          >
            {briefLoading ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <Search size={17} />
            )}
            Search
          </button>
        </form>

        <div className="advanced-panel">
          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setShowAdvanced((value) => !value)}
            aria-expanded={showAdvanced}
          >
            <ChevronDown
              size={15}
              className={showAdvanced ? 'rotated' : ''}
            />
            Advanced sources
            <span className="advanced-count">
              {sourcePreferences.size} enabled
            </span>
          </button>
          {showAdvanced && (
            <div className="prefs-panel">
              <div className="source-prefs">
                <span className="pref-label">TRUSTED SOURCES</span>
                <div className="source-chips">
                  {SOURCES.map((source) => {
                    const enabled = sourcePreferences.has(source.id);
                    return (
                      <button
                        key={source.id}
                        type="button"
                        className={`source-chip ${enabled ? 'active' : ''}`}
                        onClick={() => toggleSource(source.id)}
                        aria-pressed={enabled}
                        title={source.description}
                      >
                        {source.name}
                        {enabled && <span className="chip-icon">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <span className="pref-label sort-label">SORT</span>
                <div className="sort-toggle">
                  <button
                    type="button"
                    className={prefs.sort === 'relevance' ? 'active' : ''}
                    onClick={() => toggleSort('relevance')}
                  >
                    Relevance
                  </button>
                  <button
                    type="button"
                    className={prefs.sort === 'newest' ? 'active' : ''}
                    onClick={() => toggleSort('newest')}
                  >
                    Newest
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {lastQuery && (
        <div className="result-tabs" role="tablist" aria-label="Search views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'answer'}
            className={tab === 'answer' ? 'active' : ''}
            onClick={() => setTab('answer')}
          >
            <Sparkles size={15} /> Answer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'papers'}
            className={tab === 'papers' ? 'active' : ''}
            onClick={() => setTab('papers')}
          >
            <BookOpen size={15} /> Papers
          </button>
        </div>
      )}

      {tab === 'answer' ? renderAnswer() : renderPapers()}
    </section>
  );
}
