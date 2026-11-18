import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AnalyticsSkeleton, { AnalyticsBodySkeleton } from '../../components/analytics/analytics-skeleton';

describe('Task 460/551 analytics loading state', () => {
  test('page skeleton renders heading, tab bar, 4 metric and 4 chart placeholders as a busy status', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Analytics');
    expect(html.match(/animate-pulse/g)?.length).toBe(9);
  });
  test('tab body skeleton has no heading (shown under the live tabs)', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsBodySkeleton));
    expect(html).not.toContain('<h1');
    expect(html.match(/animate-pulse/g)?.length).toBe(8);
  });
});
