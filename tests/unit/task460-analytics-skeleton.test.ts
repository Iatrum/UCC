import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AnalyticsSkeleton from '../../components/analytics/analytics-skeleton';
import { HORIZONTAL_BAR_MARGIN } from '../../components/analytics/analytics-charts';

describe('Task 460 analytics loading state', () => {
  test('skeleton renders heading, 4 metric and 5 chart placeholders as a busy status', () => {
    const html = renderToStaticMarkup(createElement(AnalyticsSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Analytics');
    expect(html.match(/animate-pulse/g)?.length).toBe(9);
  });
  test('horizontal bar charts leave room for value labels at the right edge', () => {
    expect(HORIZONTAL_BAR_MARGIN.right).toBeGreaterThanOrEqual(32);
  });
});
