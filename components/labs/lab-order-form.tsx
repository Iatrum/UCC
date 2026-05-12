'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { getClinicalCatalog, type ClinicalCatalogItem } from '@/lib/clinical-catalog';
import { toast } from 'sonner';

interface LabOrderFormProps {
  patientId: string;
  encounterId?: string;
  onOrderPlaced?: (serviceRequestId: string) => void;
}

// Group tests by category (restricted)
export function LabOrderForm({ patientId, encounterId, onOrderPlaced }: LabOrderFormProps) {
  const [catalog, setCatalog] = useState<ClinicalCatalogItem[]>([]);
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState('');
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void getClinicalCatalog('lab').then((items) => {
      const activeItems = items.filter((item) => item.active);
      setCatalog(activeItems);
      setActiveCategory((current) => current || activeItems[0]?.category || 'General');
    });
  }, []);

  const categories = Array.from(new Set(catalog.map((item) => item.category || 'General')));

  const toggleTest = (testCode: string) => {
    const newSelected = new Set(selectedTests);
    if (newSelected.has(testCode)) {
      newSelected.delete(testCode);
    } else {
      newSelected.add(testCode);
    }
    setSelectedTests(newSelected);
  };

  const selectCategory = (category: string) => {
    const newSelected = new Set(selectedTests);
    catalog
      .filter((test) => (test.category || 'General') === category)
      .forEach(test => newSelected.add(test.id));
    setSelectedTests(newSelected);
  };

  const handleSubmit = async () => {
    if (selectedTests.size === 0) {
      toast.error('Please select at least one test');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/labs/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          encounterId,
          tests: Array.from(selectedTests)
            .map((id) => catalog.find((item) => item.id === id))
            .filter(Boolean)
            .map((item) => ({
              code: item!.code || item!.id,
              display: item!.display || item!.name,
              system: item!.system || 'http://loinc.org',
            })),
          priority,
          clinicalNotes: clinicalNotes || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to place lab order');
      }

      toast.success('Lab order placed successfully');
      
      // Reset form
      setSelectedTests(new Set());
      setClinicalNotes('');
      setPriority('routine');

      if (onOrderPlaced) {
        onOrderPlaced(data.serviceRequestId);
      }
    } catch (error: any) {
      console.error('Error placing lab order:', error);
      toast.error(error.message || 'Failed to place lab order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Laboratory Tests</CardTitle>
        <CardDescription>
          Select tests and specify priority for Point-of-Care Testing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Priority Selection */}
        <div className="space-y-2">
          <Label>Priority</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={priority === 'routine' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPriority('routine')}
            >
              Routine
            </Button>
            <Button
              type="button"
              variant={priority === 'urgent' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPriority('urgent')}
            >
              Urgent
            </Button>
            <Button
              type="button"
              variant={priority === 'stat' ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setPriority('stat')}
            >
              STAT
            </Button>
          </div>
        </div>

        {/* Test Selection */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Select Tests</Label>
            {selectedTests.size > 0 && (
              <Badge variant="secondary">{selectedTests.size} tests selected</Badge>
            )}
          </div>

          <Tabs value={activeCategory || categories[0] || 'General'} onValueChange={setActiveCategory} className="w-full">
            <TabsList className="flex w-full flex-wrap">
              {categories.map((category) => (
                <TabsTrigger key={category} value={category}>{category}</TabsTrigger>
              ))}
            </TabsList>

            {categories.map((category) => (
              <TabsContent key={category} value={category} className="space-y-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectCategory(category)}
                >
                  Select All {category}
                </Button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {catalog.filter((test) => (test.category || 'General') === category).map((test) => (
                    <div key={test.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={test.id}
                        checked={selectedTests.has(test.id)}
                        onCheckedChange={() => toggleTest(test.id)}
                      />
                      <Label
                        htmlFor={test.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {test.display || test.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        {/* Clinical Notes */}
        <div className="space-y-2">
          <Label htmlFor="clinicalNotes">Clinical Notes (Optional)</Label>
          <Textarea
            id="clinicalNotes"
            placeholder="Enter clinical indication or special instructions..."
            value={clinicalNotes}
            onChange={(e) => setClinicalNotes(e.target.value)}
            rows={3}
          />
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || selectedTests.size === 0}
          className="w-full"
        >
          {isSubmitting ? 'Placing Order...' : `Place Order (${selectedTests.size} tests)`}
        </Button>
      </CardContent>
    </Card>
  );
}



