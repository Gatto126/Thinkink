import { useEffect, useRef, useState } from 'react';
import { overviewSchema } from '@thinkink/shared/contracts';
import type { TopicData } from '@thinkink/shared/contracts';
import { readApi } from '../api';

type Overview = NonNullable<TopicData['summary']>;
export function OverviewEditor({
  topicId,
  summary,
  onSaved,
  onCancel,
}: {
  topicId: string;
  summary: Overview;
  onSaved: (summary: Overview) => void;
  onCancel: () => void;
}) {
  const [headline, setHeadline] = useState(
    summary.headline ?? 'The story so far.',
  );
  const [paragraphs, setParagraphs] = useState(() =>
    summary.paragraphs?.length
      ? summary.paragraphs.map((p) => ({ ...p }))
      : [{ text: summary.text, sourceIds: [] as string[] }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    return () => controller.current?.abort();
  }, []);
  return (
    <form
      className="overview-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        controller.current = new AbortController();
        try {
          const value = await readApi(
            `/api/topics/${topicId}/overview`,
            overviewSchema,
            controller.current.signal,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                headline,
                paragraphs,
                revision: summary.revision ?? 0,
              }),
            },
          );
          onSaved(value);
        } catch (error) {
          if (!controller.current.signal.aborted)
            setError(
              error instanceof Error
                ? error.message
                : 'The overview could not be saved.',
            );
        } finally {
          setSaving(false);
        }
      }}
    >
      <h2 id="overview-heading" className="sr-only">
        Edit overview
      </h2>
      <fieldset disabled={saving}>
        <div className="auth-field">
          <label htmlFor="overview-title">Overview title</label>
          <textarea
            ref={title}
            id="overview-title"
            className="overview-title-input"
            rows={3}
            maxLength={300}
            required
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
          />
        </div>
        {paragraphs.map((paragraph, index) => (
          <div className="auth-field" key={index}>
            <label htmlFor={`overview-paragraph-${index}`}>
              Paragraph {index + 1}
            </label>
            <textarea
              id={`overview-paragraph-${index}`}
              rows={5}
              maxLength={5000}
              required
              value={paragraph.text}
              onChange={(e) =>
                setParagraphs((previous) =>
                  previous.map((p, i) =>
                    i === index ? { ...p, text: e.target.value } : p,
                  ),
                )
              }
            />
            {summary.sources.length > 0 && (
              <div
                className="overview-source-choices"
                role="group"
                aria-label={`Sources for paragraph ${index + 1}`}
              >
                {summary.sources.map((source, sourceIndex) => (
                  <label key={source.id} title={source.title}>
                    <input
                      type="checkbox"
                      checked={paragraph.sourceIds.includes(source.id)}
                      onChange={(e) =>
                        setParagraphs((previous) =>
                          previous.map((p, i) =>
                            i === index
                              ? {
                                  ...p,
                                  sourceIds: e.target.checked
                                    ? [...p.sourceIds, source.id]
                                    : p.sourceIds.filter(
                                        (id) => id !== source.id,
                                      ),
                                }
                              : p,
                          ),
                        )
                      }
                    />
                    [{sourceIndex + 1}] {source.publisher ?? source.title}
                  </label>
                ))}
              </div>
            )}
            {paragraphs.length > 1 && (
              <button
                type="button"
                className="text-action"
                onClick={() =>
                  setParagraphs((previous) =>
                    previous.filter((_, i) => i !== index),
                  )
                }
              >
                Remove paragraph {index + 1}
              </button>
            )}
          </div>
        ))}
        {paragraphs.length < 12 && (
          <button
            type="button"
            className="text-action"
            onClick={() =>
              setParagraphs((previous) => [
                ...previous,
                { text: '', sourceIds: [] },
              ])
            }
          >
            Add paragraph
          </button>
        )}
        <div className="overview-editor-actions">
          <button className="pill-button" type="submit">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="text-action" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
