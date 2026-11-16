import { useEffect, useRef, useState } from 'react';
import { Search, ExternalLink, Globe2, Loader2, X } from 'lucide-react';
import { runMentoSearch, SOURCES, type MentoResult } from './searchProviders';
import './search.css';

// Types are imported from searchProviders

const PREFERENCES_KEY = 'mentosearch-preferences:v2';
const defaultSources = () =>
  SOURCES.filter((s) => s.defaultEnabled).map((s) => s.id);

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
  const [results, setResults] = useState<MentoResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState(loadPreferences);
  const [sourcePreferences, setSourcePreferences] = useState<Set<string>>(
    () => new Set(prefs.sources),
  );
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    savePreferences({ sources: [...sourcePreferences], sort: prefs.sort });
  }, [sourcePreferences, prefs.sort]);

  const abortSearch = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setError('');
    setResults(null);
    setFailedSources([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    abortSearch();

    setLoading(true);
    setError('');
    setLastQuery(q);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await runMentoSearch(
        q,
        sourcePreferences,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResults(outcome.results);
      setFailedSources(outcome.failedSources);
    } catch (err) {
      if (!abortRef.current?.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Search failed');
      }
    } finally {
      setLoading(false);
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

  const sortedResults = results
    ? prefs.sort === 'newest'
      ? [...results].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      : results
    : null;

  const renderSourceChips = () => (
    <div className="source-chips">
      {SOURCES.map((source) => {
        const enabled = sourcePreferences.has(source.id);
        return (
          <button
            key={source.id}
            className={`source-chip ${enabled ? 'active' : ''}`}
            onClick={() => toggleSource(source.id)}
            aria-pressed={enabled}
          >
            {source.name}
            {enabled && <span className="chip-icon">✓</span>}
          </button>
        );
      })}
    </div>
  );

  const renderSortToggle = () => (
    <div className="sort-toggle">
      <button
        className={prefs.sort === 'relevance' ? 'active' : ''}
        onClick={() => toggleSort('relevance')}
      >
        Relevance
      </button>
      <button
        className={prefs.sort === 'newest' ? 'active' : ''}
        onClick={() => toggleSort('newest')}
      >
        Newest
      </button>
    </div>
  );

  const renderGoogleScholarLink = (searchQuery: string | null) => {
    if (!searchQuery) return null;
    const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(searchQuery)}`;
    return (
      <a
        className="scholar-link"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        <Globe2 size={16} /> Open in Google Scholar
      </a>
    );
  };

  const resultsHeader = () => {
    if (!lastQuery) return null;
    return (
      <div className="results-header">
        <div className="result-count">
          {results ? results.length : 0} results for “{lastQuery}”
        </div>
        {renderGoogleScholarLink(lastQuery)}
      </div>
    );
  };

  const renderResults = (list: MentoResult[]) => {
    return (
      <ol className="results-list">
        {list.map((result) => (
          <li key={result.id} className="result-item">
            <div className="result-header">
              <span className={`source-badge ${result.sourceId}`}>
                {result.sourceName}
              </span>
              {result.year && <span className="year">{result.year}</span>}
              {typeof result.citations === 'number' && (
                <span className="citations">{result.citations} citations</span>
              )}
            </div>
            <a className="result-title" href={result.url} target="_blank" rel="noreferrer">
              {result.title} <ExternalLink size={14} />
            </a>
            {result.authors.length > 0 && (
              <p className="result-authors">
                {result.authors.slice(0, 4).join(', ')}
                {result.authors.length > 4 && ' et al.'}
              </p>
            )}
            {result.abstract && (
              <p className="result-abstract">{result.abstract.slice(0, 240)}…</p>
            )}
            {result.doi && <p className="result-doi">DOI: {result.doi}</p>}
          </li>
        ))}
      </ol>
    );
  };

  return (
    <section className="mentosearch-screen">
      <div className="page-title">
        <span className="eyebrow">TRUSTED SOURCE SEARCH</span>
        <h1>MentoSearch</h1>
        <p>
          Search a topic and get results from trusted scholarly platforms —
          Crossref, OpenAlex, Europe PMC, PubMed, and arXiv.
        </p>
      </div>

      <div className="search-container">
        <form className="search-form" onSubmit={handleSubmit}>
          <Search size={20} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a topic, e.g. “spaced repetition in learning”"
            aria-label="Search topics"
          />
          {query && (
            <button type="button" className="clear-btn" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
          <button type="submit" className="primary" disabled={loading || !query.trim()}>
            {loading ? <Loader2 size={17} className="spin" /> : <Search size={17} />}
            Search
          </button>
        </form>

        <div className="prefs-panel">
          <div className="source-prefs">
            <span className="pref-label">TRUSTED SOURCES</span>
            {renderSourceChips()}
            <span className="pref-label sort-label">SORT</span>
            {renderSortToggle()}
          </div>
        </div>
      </div>

      {loading && (
        <div className="loading-skeleton">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-result">
                <div className="skeleton-meta"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="empty-state error">
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && failedSources.length > 0 && (
        <div className="empty-state warning" role="status">
          <p>
            {failedSources.join(', ')}{' '}
            {failedSources.length === 1 ? 'is' : 'are'} unavailable right now.
            Results from the other sources are shown.
          </p>
        </div>
      )}

      {resultsHeader()}

      {sortedResults && sortedResults.length > 0 && renderResults(sortedResults)}

      {!loading && !error && sortedResults === null && (
        <div className="empty-state">
          <p>Search a topic to explore it across trusted platforms.</p>
        </div>
      )}

      {!loading && !error && sortedResults && sortedResults.length === 0 && (
        <div className="empty-state">
          <p>
            {failedSources.length > 0 &&
            failedSources.length >= sourcePreferences.size
              ? 'The selected sources are unavailable right now. Try again in a moment.'
              : 'No results found. Try different keywords or enable more sources.'}
          </p>
        </div>
      )}
    </section>
  );
}

// Type is imported from searchProviders
