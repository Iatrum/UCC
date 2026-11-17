'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Clock, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { LabReportSummary } from '@/lib/fhir/lab-constants';
import { startLabResultUpdates, type LabLoadError, type LabResultUpdates } from '@/lib/poct/live-results';
import type { PendingPoctOrder } from '@/lib/fhir/lab-service';
import type { PendingXrayOrder } from '@/lib/fhir/imaging-service';

interface LabResultsViewProps {
  patientId: string;
  encounterId?: string;
}

export function LabResultsView({ patientId, encounterId }: LabResultsViewProps) {
  const [reports, setReports] = useState<LabReportSummary[]>([]);
  const [pending, setPending] = useState<PendingPoctOrder[]>([]);
  const [xrayPending, setXrayPending] = useState<PendingXrayOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<LabLoadError | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveOff, setLiveOff] = useState(false);
  const updates = useRef<LabResultUpdates | null>(null);

  useEffect(() => {
    setReports([]);
    setPending([]);
    setXrayPending([]);
    setIsLoading(true);
    setLoadError(null);
    setFetchedAt(null);
    setIsRefreshing(false);
    setLiveOff(false);
    const handle = startLabResultUpdates({
      patientId, encounterId,
      onResults: (data, at) => {
        setReports(data.reports || []); setPending(data.pending || []); setXrayPending(data.xrayPending || []);
        setLoadError(null); setFetchedAt(at);
      },
      // A failed fetch never becomes an empty list: known results stay (except after 401/403, where access is gone).
      onError: (error) => {
        setLoadError(error);
        if (error === 'denied') { setReports([]); setPending([]); setXrayPending([]); setFetchedAt(null); }
      },
      onLoaded: () => { setIsLoading(false); setIsRefreshing(false); },
      onLiveStatus: (live) => setLiveOff(!live),
    });
    updates.current = handle;
    return () => { handle.stop(); updates.current = null; };
  }, [patientId, encounterId]);

  const refresh = () => { setIsRefreshing(true); updates.current?.refresh(); };
  const hasKnownData = fetchedAt !== null;

  const statusBar = (
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="lab-status-bar">
      <p className="text-xs text-muted-foreground" data-testid="lab-last-updated" aria-live="polite">
        {fetchedAt ? `Last updated ${new Date(fetchedAt).toLocaleTimeString()}` : 'Not updated yet'}
        {liveOff && fetchedAt && (
          <span data-testid="lab-live-off"> · Live updates off – press Refresh</span>
        )}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
        <RefreshCw className={`mr-2 h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
        {isRefreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  );

  const errorBanner = loadError === 'failed' && hasKnownData && (
    <Alert variant="destructive" data-testid="lab-stale-banner">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Could not refresh lab results</AlertTitle>
      <AlertDescription>
        Showing the results last received at {new Date(fetchedAt!).toLocaleTimeString()}. They may be out of date. Retrying automatically.
      </AlertDescription>
    </Alert>
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'final': return 'default';
      case 'preliminary': return 'secondary';
      case 'corrected': return 'outline';
      case 'cancelled': return 'destructive';
      default: return 'secondary';
    }
  };

  const getInterpretationIcon = (interpretation?: string) => {
    switch (interpretation) {
      case 'normal':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'high':
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      case 'low':
        return <TrendingDown className="h-4 w-4 text-blue-500" />;
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Failed first load (or access revoked): never present this as "no results".
  if (loadError && !hasKnownData) {
    const denied = loadError === 'denied';
    return (
      <Card>
        <CardHeader>
          <CardTitle>Laboratory Results</CardTitle>
          <CardDescription>{denied ? 'Lab results are not available to you' : 'Lab results could not be loaded'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive" data-testid="lab-load-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{denied ? 'Access denied' : 'Could not load lab results'}</AlertTitle>
            <AlertDescription>
              {denied
                ? 'Your session may have expired or you may no longer have access to this clinic. Sign in again, then retry.'
                : 'This is a loading problem, not an empty record: results may exist. Retry, or check your connection.'}
            </AlertDescription>
          </Alert>
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
            <RefreshCw className={`mr-2 h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Retrying…' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // The accession number joins the DICOM study to this order in the PACS (X-ray phase 3); the column
  // only exists when an order carries one.
  const showAccession = xrayPending.some((order) => order.accessionNumber);

  if (reports.length === 0 && pending.length === 0 && xrayPending.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Laboratory Results</CardTitle>
          <CardDescription>No lab results available</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorBanner}
          <p className="text-sm text-muted-foreground">
            No laboratory tests have been ordered or completed for this {encounterId ? 'encounter' : 'patient'}.
          </p>
          {statusBar}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {statusBar}
      {errorBanner}
      {pending.length > 0 && (
        <Card aria-label="Pending POCT tests">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending POCT Tests
            </CardTitle>
            <CardDescription>Waiting on the analyser — results will appear below once received.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.testName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.authoredOn ? new Date(order.authoredOn).toLocaleString() : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs capitalize">{order.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {xrayPending.length > 0 && (
        <Card aria-label="Pending X-ray studies">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending X-ray
            </CardTitle>
            <CardDescription>Waiting on the device — the study will appear in Imaging once received.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Study</TableHead>
                  {showAccession && <TableHead>Accession #</TableHead>}
                  <TableHead>Ordered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {xrayPending.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.display}</TableCell>
                    {showAccession && (
                      <TableCell className="font-mono text-sm" data-testid="xray-accession">{order.accessionNumber || '—'}</TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground">
                      {order.authoredOn ? new Date(order.authoredOn).toLocaleString() : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs capitalize">{order.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {reports.map((report) => (
        <Card key={report.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Laboratory Report</CardTitle>
                <CardDescription>
                  Ordered: {new Date(report.orderedAt).toLocaleDateString()}
                  {report.issuedAt && ` • Issued: ${new Date(report.issuedAt).toLocaleDateString()}`}
                </CardDescription>
              </div>
              <Badge variant={getStatusColor(report.status)}>
                {report.status.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Critical Results Alert */}
            {report.results.some(r => r.interpretation === 'critical') && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Critical Results Detected</AlertTitle>
                <AlertDescription>
                  This report contains critical values that require immediate attention.
                </AlertDescription>
              </Alert>
            )}

            {/* Results Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Reference Range</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Interpretation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.results.map((result, idx) => (
                  <TableRow key={idx} className={result.interpretation === 'critical' ? 'bg-red-50' : ''}>
                    <TableCell className="font-medium">{result.testName}</TableCell>
                    <TableCell>
                      {result.value} {result.unit}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {result.referenceRange || 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {result.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {getInterpretationIcon(result.interpretation)}
                        {result.interpretation && (
                          <span className="text-xs capitalize">
                            {result.interpretation}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Conclusion */}
            {report.conclusion && (
              <div className="rounded-lg bg-muted p-4">
                <h4 className="text-sm font-semibold mb-2">Conclusion</h4>
                <p className="text-sm">{report.conclusion}</p>
              </div>
            )}

            {/* Ordering Physician */}
            {report.orderingPhysician && (
              <p className="text-sm text-muted-foreground">
                Ordered by: {report.orderingPhysician}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}






