import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Copy,
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
import { formatCitation, type CitationStyle } from './citation';
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

const scholarUrl = (title: string, from?: number, to?: number) => {
  const params = new URLSearchParams({ q: title });
  if (from !== undefined) params.set('as_ylo', String(from));
  if (to !== undefined) params.set('as_yhi', String(to));
  return `https://scholar.google.com/scholar?${params}`;
};

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

function paperKey(paper: MentoResult) {
  return paper.doi ? `doi:${paper.doi.toLowerCase()}` : `title:${paper.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function mergePapers(current: MentoResult[], incoming: MentoResult[], from?: number, to?: number) {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((paper) => {
    if ((from !== undefined && (paper.year === undefined || paper.year < from)) ||
        (to !== undefined && (paper.year === undefined || paper.year > to))) return false;
    const key = paperKey(paper);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function MentoSearchPage() {
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [tab, setTab] = useState<Tab>('papers');
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
  const [sourceMessages, setSourceMessages] = useState<string[]>([]);
  const currentYear = new Date().getFullYear();
  const [yearFromInput, setYearFromInput] = useState('');
  const [yearToInput, setYearToInput] = useState('');
  const [yearRange, setYearRange] = useState<{ from?: number; to?: number }>({});
  const [yearFilterLabel, setYearFilterLabel] = useState('Any time');
  const [yearRangeError, setYearRangeError] = useState('');
  const [showCustomYears, setShowCustomYears] = useState(false);
  const [showMobileYearFilters, setShowMobileYearFilters] = useState(false);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('APA');
  const [copiedCitation, setCopiedCitation] = useState<string | null>(null);

  const briefAbort = useRef<AbortController | null>(null);
  const papersAbort = useRef<AbortController | null>(null);
  const papersRequest = useRef<Promise<MentoResult[]> | null>(null);

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

  const loadPapers = async (q: string, from = yearRange.from, to = yearRange.to): Promise<MentoResult[]> => {
    papersAbort.current?.abort();
    const controller = new AbortController();
    papersAbort.current = controller;
    setPapersLoading(true);
    setPapersError('');
    setFailedSources([]);
    setSourceMessages([]);
    try {
      const outcome = await runMentoSearch(q, sourcePreferences, controller.signal, 30_000, from, to, prefs.sort);
      if (controller.signal.aborted) return [];
      setPapers(outcome.results);
      setFailedSources(outcome.failedSources);
      setSourceMessages(outcome.sourceMessages ?? []);
      return outcome.results;
    } catch (err) {
      if (!controller.signal.aborted) {
        setPapersError(err instanceof Error ? err.message : 'Search failed');
        setPapers([]);
      }
      return [];
    } finally {
      if (!controller.signal.aborted) setPapersLoading(false);
    }
  };

  const startPapers = (q: string, from = yearRange.from, to = yearRange.to) => {
    const request = loadPapers(q, from, to);
    papersRequest.current = request;
    void request;
    return request;
  };

  const loadBrief = async (q: string, from = yearRange.from, to = yearRange.to, providedPapers?: MentoResult[]) => {
    briefAbort.current?.abort();
    const controller = new AbortController();
    briefAbort.current = controller;
    setBrief(null);
    setBriefError('');
    setBriefLoading(true);
    try {
      const currentPapers = providedPapers ?? (papersLoading
        ? await (papersRequest.current ?? Promise.resolve(papers ?? []))
        : (papers ?? await (papersRequest.current ?? Promise.resolve([]))));
      const orderedPapers = prefs.sort === 'newest'
        ? [...currentPapers].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        : currentPapers;
      const data = await searchBrief(q, [...sourcePreferences], prefs.sort, controller.signal, 25_000, from, to, orderedPapers);
      if (!controller.signal.aborted) {
        const evidencePapers = data.evidence.map((item, index): MentoResult => ({
          id: item.id,
          title: item.title,
          url: item.url,
          sourceId: item.source,
          sourceName: sourceName(item.source),
          authors: item.authors,
          year: item.year ?? undefined,
          venue: item.venue,
          citations: item.citations,
          doi: item.doi,
          abstract: item.abstract,
          rank: index,
        }));
        const merged = mergePapers(orderedPapers, evidencePapers, from, to);
        setPapers(merged);
        setBrief({ ...data, evidence: merged.map((paper) => ({
          id: paper.id,
          source: paper.sourceId,
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          venue: paper.venue,
          doi: paper.doi,
          url: paper.url,
          abstract: paper.abstract,
          citations: paper.citations,
          scholar_url: scholarUrl(paper.title, from, to),
        })) });
      }
    } catch (err) {
      if (!controller.signal.aborted) setBriefError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      if (!controller.signal.aborted) setBriefLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (sourcePreferences.size === 0) {
      setTab('answer');
      setBriefError('Enable at least one trusted source to search.');
      return;
    }
    briefAbort.current?.abort();
    papersAbort.current?.abort();
    setTab('papers');
    setLastQuery(q);
    setBrief(null);
    setBriefError('');
    setBriefLoading(false);
    setPapers(null);
    setPapersError('');
    setFailedSources([]);
    setActiveEvidence(null);

    startPapers(q);
  };

  const applyYearFilter = (from?: number, to?: number, label = 'Any time') => {
    setYearRange({ from, to });
    setYearFilterLabel(label);
    setYearRangeError('');
    setShowCustomYears(false);
    const activeQuery = query.trim();
    if (activeQuery) {
      setLastQuery(activeQuery);
      void startPapers(activeQuery, from, to).then((results) => {
        if (tab === 'answer') void loadBrief(activeQuery, from, to, results);
      });
    }
  };

  const applyCustomYears = () => {
    const from = yearFromInput ? Number(yearFromInput) : undefined;
    const to = yearToInput ? Number(yearToInput) : undefined;
    if ((from && (from < 1900 || from > 2200)) || (to && (to < 1900 || to > 2200)) || (from && to && from > to)) {
      setYearRangeError('Enter years from 1900–2200 with From no later than To.');
      return;
    }
    setYearRangeError('');
    applyYearFilter(from, to, from || to ? `${from ?? 'Any'}–${to ?? 'Any'}` : 'Any time');
  };

  const copyCitation = async (paper: MentoResult, id: string) => {
    try {
      await navigator.clipboard.writeText(formatCitation(paper, citationStyle).text);
      setCopiedCitation(id);
      window.setTimeout(() => setCopiedCitation(null), 1500);
    } catch {
      setPapersError('Clipboard access failed. Select and copy the citation text instead.');
    }
  };

  const renderCitation = (paper: MentoResult, id: string) => {
    const citation = formatCitation(paper, citationStyle);
    const authorIndex = citation.text.indexOf(citation.authors);
    const yearIndex = citation.text.indexOf(citation.year, authorIndex + citation.authors.length);
    return (
      <div className="citation-block">
        <p>
          {citation.text.slice(0, authorIndex)}
          <span className="citation-author">{citation.authors}</span>
          {citation.text.slice(authorIndex + citation.authors.length, yearIndex)}
          <span className="citation-year">{citation.year}</span>
          {citation.text.slice(yearIndex + citation.year.length)}
        </p>
        <button type="button" className="secondary" onClick={() => void copyCitation(paper, id)}>
          <Copy size={13} /> {copiedCitation === id ? 'Copied' : 'Copy citation'}
        </button>
      </div>
    );
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
            onClick={() => void loadBrief(lastQuery)}
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
                href={scholarUrl(brief.query, yearRange.from, yearRange.to)}
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
                  {item.year && <span className="year year-pill">{item.year}</span>}
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
                      <p className="result-authors authors-highlight">
                        {item.authors.slice(0, 4).join(', ')}
                        {item.authors.length > 4 && ' et al.'}
                      </p>
                    )}
                    {item.venue && (
                      <p className="result-doi">{item.venue}</p>
                    )}
                    {renderCitation({
                      id: item.id,
                      sourceId: item.source,
                      sourceName: sourceName(item.source),
                      title: item.title,
                      url: item.url,
                      authors: item.authors,
                      year: item.year ?? undefined,
                      venue: item.venue,
                      doi: item.doi,
                      abstract: item.abstract,
                      citations: item.citations,
                      rank: evidenceNumber(item.id),
                    }, item.id)}
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

  const renderYearFilter = () => (
    <div className="year-filter" aria-label="Publication year filter">
      <span className="year-filter-label">Publication year</span>
      <div className="year-filter-pills">
        <button className={yearFilterLabel === 'Any time' ? 'active' : ''} onClick={() => applyYearFilter()} type="button">Any time</button>
        {[currentYear, currentYear - 1, currentYear - 3, currentYear - 4].map((year) => (
          <button key={year} className={yearFilterLabel === `Since ${year}` ? 'active' : ''} onClick={() => applyYearFilter(year, undefined, `Since ${year}`)} type="button">Since {year}</button>
        ))}
        <button
          type="button"
          className={yearRange.from !== undefined || yearRange.to !== undefined ? 'active' : ''}
          onClick={() => {
            if (yearFilterLabel.includes('–')) {
              setYearFromInput('');
              setYearToInput('');
              setShowCustomYears(false);
              applyYearFilter();
            } else {
              setShowCustomYears((shown) => !shown);
            }
          }}
        >
          {yearFilterLabel.includes('–') ? `${yearFilterLabel} ×` : 'Custom range ▾'}
        </button>
      </div>
      {showCustomYears && (
        <div className="custom-year-range">
          <input aria-label="From year" inputMode="numeric" placeholder="From" value={yearFromInput} onChange={(event) => { setYearFromInput(event.target.value.replace(/\D/g, '').slice(0, 4)); setYearRangeError(''); }} />
          <span>—</span>
          <input aria-label="To year" inputMode="numeric" placeholder="To" value={yearToInput} onChange={(event) => { setYearToInput(event.target.value.replace(/\D/g, '').slice(0, 4)); setYearRangeError(''); }} />
          <button type="button" className="primary" onClick={applyCustomYears}>Apply</button>
          {yearRangeError && <span className="year-range-error" role="alert">{yearRangeError}</span>}
        </div>
      )}
    </div>
  );

  const renderPapers = () => {
    let content;
    if (papersLoading) {
      content = (
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
    } else if (papersError) {
      content = (
        <div className="empty-state error" role="alert">
          <p>{papersError}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => startPapers(lastQuery)}
          >
            Retry search
          </button>
        </div>
      );
    } else if (!papers) {
      content = (
        <div className="empty-state">
          <p>Open this tab to load the full paper list.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => startPapers(lastQuery)}
          >
            Load papers
          </button>
        </div>
      );
    } else {
    const sorted =
      prefs.sort === 'newest'
        ? [...papers].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        : papers;
    content = (
      <>
        {failedSources.length > 0 && (
          <div className="empty-state warning" role="status">
            <p>
              {sourceMessages.join(' ')}{' '}
              {failedSources.filter((name) => !sourceMessages.some((message) => message.startsWith(name))).length > 0 && (
                <>{failedSources.filter((name) => !sourceMessages.some((message) => message.startsWith(name))).join(', ')}{' '}
                  {failedSources.length === 1 ? 'is' : 'are'} unavailable right now. Results from other sources are shown.</>
              )}
            </p>
          </div>
        )}
        <div className="results-header">
          <div className="result-count">
            {sorted.length} paper{sorted.length === 1 ? '' : 's'} for “{lastQuery}”
          </div>
          <a
            className="scholar-link"
            href={scholarUrl(lastQuery, yearRange.from, yearRange.to)}
            target="_blank"
            rel="noreferrer"
          >
            <Globe2 size={16} /> Open in Google Scholar
          </a>
          <button type="button" className="secondary copy-all" onClick={async () => {
            try {
              await navigator.clipboard.writeText(sorted.map((result) => formatCitation(result, citationStyle).text).join('\n\n'));
              setCopiedCitation('all');
              window.setTimeout(() => setCopiedCitation(null), 1500);
            } catch { setPapersError('Clipboard access failed.'); }
          }}><Copy size={14} /> {copiedCitation === 'all' ? 'Copied' : 'Copy all citations'}</button>
          <select aria-label="Citation style" value={citationStyle} onChange={(event) => setCitationStyle(event.target.value as CitationStyle)}><option>APA</option><option>IEEE</option><option>MLA</option></select>
        </div>
        {sorted.length > 0 ? (
          <ol className="results-list">
            {sorted.map((result) => (
              <li key={result.id} className="result-item">
                <div className="result-header">
                  <span className={`source-badge ${result.sourceId}`}>
                    {result.sourceName}
                  </span>
                  {result.year && <span className="year year-pill">{result.year}</span>}
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
                    <p className="result-authors authors-highlight">
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
                {renderCitation(result, result.id)}
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
    }
    return content;
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
            disabled={!query.trim()}
          >
            <Search size={17} />
            Search
          </button>
        </form>

        <div className="search-tools-row">
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
        {renderYearFilter()}
        </div>
      </div>

      {lastQuery && (
        <div className="result-tabs" role="tablist" aria-label="Search views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'papers'}
            className={tab === 'papers' ? 'active' : ''}
            onClick={() => setTab('papers')}
          >
            <BookOpen size={15} /> Papers
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'answer'}
            className={tab === 'answer' ? 'active' : ''}
            onClick={() => { setTab('answer'); if (lastQuery && !brief && !briefLoading) void loadBrief(lastQuery); }}
          >
            <Sparkles size={15} /> Answer
          </button>
        </div>
      )}

      {tab === 'answer' ? renderAnswer() : renderPapers()}
    </section>
  );
}
