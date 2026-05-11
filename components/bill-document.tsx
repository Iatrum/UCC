import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { OrganizationDetails } from "@/lib/org";

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    padding: 40,
  },
  headerContainer: {
    marginBottom: 30,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  logoBox: { width: 140, height: 50 },
  logoText: { fontSize: 20, color: '#1f2937', fontWeight: 'bold' },
  org: { marginTop: 4 },
  orgName: { fontSize: 12, color: '#111827', fontWeight: 'bold' },
  orgText: { fontSize: 10, color: '#6b7280' },
  billInfo: {
    textAlign: 'right',
  },
  billTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  billNumber: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  headerBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 20,
  },
  patientInfo: {
    flex: 1,
  },
  dateInfo: {
    flex: 1,
    textAlign: 'right',
  },
  label: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    color: '#1f2937',
  },
  section: {
    marginVertical: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 10,
  },
  table: {
    display: 'flex',
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tableCell: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
  },
  tableCellWide: {
    flex: 2,
    fontSize: 12,
    color: '#374151',
  },
  totalSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 2,
    borderTopColor: '#e5e7eb',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 14,
    color: '#374151',
    marginRight: 40,
  },
  totalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1f2937',
    width: 100,
    textAlign: 'right',
  },
  grandTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a56db',
  },
  footer: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 20,
    fontSize: 10,
    color: '#6b7280',
    textAlign: 'center',
  },
});

interface BillDocumentProps {
  data: {
    id: string;
    patientName: string;
    date: string;
    prescriptions: Array<{
      name: string;
      dosage: string;
      price: number;
    }>;
    procedures: Array<{
      name: string;
      description: string;
      price: number;
    }>;
  };
  organization?: OrganizationDetails | null;
}

export function BillDocument({ data, organization }: BillDocumentProps) {
  const logoUrl = organization?.logoUrl ?? null;
  const org = organization ?? null;

  const calculateSubtotal = (items: Array<{ price: number }>) => {
    return items.reduce((sum, item) => sum + item.price, 0);
  };

  const prescriptionTotal = calculateSubtotal(data.prescriptions);
  const procedureTotal = calculateSubtotal(data.procedures);
  const total = prescriptionTotal + procedureTotal;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerContainer}>
          <View style={styles.headerTop}>
            <View>
              {logoUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={logoUrl} style={styles.logoBox} />
              ) : (
                <Text style={styles.logoText}>EMR System</Text>
              )}
              {org && (org.name || org.address || org.phone) && (
                <View style={styles.org}>
                  {org.name ? <Text style={styles.orgName}>{org.name}</Text> : null}
                  {org.address ? <Text style={styles.orgText}>{org.address}</Text> : null}
                  {org.phone ? <Text style={styles.orgText}>{org.phone}</Text> : null}
                </View>
              )}
            </View>
            <View style={styles.billInfo}>
              <Text style={styles.billTitle}>MEDICAL BILL</Text>
              <Text style={styles.billNumber}>Bill #{data.id}</Text>
            </View>
          </View>
          
          <View style={styles.headerBottom}>
            <View style={styles.patientInfo}>
              <Text style={styles.label}>BILLED TO</Text>
              <Text style={styles.value}>{data.patientName}</Text>
            </View>
            <View style={styles.dateInfo}>
              <Text style={styles.label}>DATE ISSUED</Text>
              <Text style={styles.value}>{data.date}</Text>
            </View>
          </View>
        </View>

        {/* Prescriptions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prescriptions</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableCellWide}>Medicine</Text>
              <Text style={styles.tableCell}>Dosage</Text>
              <Text style={styles.tableCell}>Price</Text>
            </View>
            {data.prescriptions.map((prescription, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.tableCellWide}>{prescription.name}</Text>
                <Text style={styles.tableCell}>{prescription.dosage}</Text>
                <Text style={styles.tableCell}>${prescription.price.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Services and documents */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services & Documents</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.tableCellWide}>Item</Text>
              <Text style={styles.tableCellWide}>Description</Text>
              <Text style={styles.tableCell}>Price</Text>
            </View>
            {data.procedures.map((procedure, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.tableCellWide}>{procedure.name}</Text>
                <Text style={styles.tableCellWide}>{procedure.description}</Text>
                <Text style={styles.tableCell}>${procedure.price.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Totals */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Prescriptions Subtotal</Text>
            <Text style={styles.totalValue}>${prescriptionTotal.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Services & Documents Subtotal</Text>
            <Text style={styles.totalValue}>${procedureTotal.toFixed(2)}</Text>
          </View>
          <View style={[styles.totalRow, { marginTop: 12 }]}>
            <Text style={[styles.totalLabel, styles.grandTotal]}>TOTAL</Text>
            <Text style={[styles.totalValue, styles.grandTotal]}>${total.toFixed(2)}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Thank you for choosing our medical services.</Text>
          <Text>For any inquiries about this bill, please contact our billing department.</Text>
        </View>
      </Page>
    </Document>
  );
}
