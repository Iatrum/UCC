import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { OrganizationDetails } from "@/lib/org";

const PRIMARY = "#1e3a5f";
const MUTED = "#6b7280";
const BODY = "#111827";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingRight: 48,
    paddingBottom: 48,
    paddingLeft: 48,
    fontSize: 11,
    color: BODY,
    fontFamily: "Helvetica",
  },

  // Letterhead
  letterhead: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  logo: {
    width: 56,
    height: 56,
    marginRight: 12,
    objectFit: "contain",
  },
  letterheadText: {
    flex: 1,
    justifyContent: "center",
  },
  clinicName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: PRIMARY,
    marginBottom: 2,
  },
  clinicMeta: {
    fontSize: 9,
    color: MUTED,
    lineHeight: 1.4,
  },

  // Rules
  ruleThick: {
    borderBottomWidth: 2,
    borderBottomColor: PRIMARY,
    marginBottom: 0,
  },
  ruleThin: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#d1d5db",
    marginBottom: 0,
  },

  // Title band
  titleBand: {
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "center",
  },
  title: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    color: PRIMARY,
    textAlign: "center",
  },

  // Date
  dateRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
    marginBottom: 16,
  },
  dateText: {
    fontSize: 10,
    color: MUTED,
  },

  // Recipient block
  recipientBlock: {
    marginBottom: 14,
  },
  recipientToLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: BODY,
    marginBottom: 3,
  },
  recipientLine: {
    fontSize: 11,
    color: BODY,
    marginBottom: 2,
    paddingLeft: 0,
  },
  recipientMeta: {
    fontSize: 10,
    color: MUTED,
    marginBottom: 2,
  },

  // RE: subject
  reBlock: {
    marginBottom: 16,
  },
  reRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  reLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BODY,
    marginRight: 6,
    width: 28,
  },
  rePatient: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BODY,
    flex: 1,
  },
  reMeta: {
    fontSize: 9,
    color: MUTED,
    marginLeft: 34,
    marginBottom: 2,
  },

  // Body
  body: {
    marginTop: 4,
    marginBottom: 28,
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.6,
    color: BODY,
    marginBottom: 6,
  },

  // Signature
  sigBlock: {
    marginTop: "auto",
  },
  sigLine: {
    borderBottomWidth: 1,
    borderBottomColor: BODY,
    width: 160,
    marginBottom: 6,
  },
  sigName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BODY,
    marginBottom: 2,
  },
  sigClinic: {
    fontSize: 10,
    color: MUTED,
  },
});

export interface ReferralDocumentMetadata {
  patientName?: string | null;
  patientId?: string | null;
  patientDateOfBirth?: string | null;
  patientPhone?: string | null;
  patientEmail?: string | null;
  department?: string | null;
  facility?: string | null;
  specialty?: string | null;
  doctorName?: string | null;
  dateLabel?: string | null;
  toLine?: string | null;
  fromLine?: string | null;
}

export interface ReferralDocumentProps {
  letterText: string;
  organization?: OrganizationDetails | null;
  metadata?: ReferralDocumentMetadata | null;
}

function renderParagraphs(letterText: string) {
  return letterText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .map((line, index) => (
      <Text key={`p-${index}`} style={styles.paragraph}>
        {line.length > 0 ? line : " "}
      </Text>
    ));
}

export function ReferralDocument({ letterText, organization, metadata }: ReferralDocumentProps) {
  const logoUrl = organization?.logoUrl ?? null;
  const hasLetterhead = Boolean(organization?.name || organization?.address || organization?.phone);

  const recipientName = metadata?.doctorName || metadata?.toLine || null;
  const recipientSpecialty = metadata?.specialty || null;
  const recipientDept = metadata?.department || null;
  const recipientFacility = metadata?.facility || null;
  const hasRecipient = Boolean(recipientName || recipientSpecialty || recipientDept || recipientFacility);

  const hasPatient = Boolean(metadata?.patientName);

  const patientMetaParts = [
    metadata?.patientId ? `NRIC: ${metadata.patientId}` : null,
    metadata?.patientDateOfBirth ? `DOB: ${metadata.patientDateOfBirth}` : null,
    metadata?.patientPhone ? `Tel: ${metadata.patientPhone}` : null,
  ].filter(Boolean);

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Letterhead */}
        {hasLetterhead && (
          <View style={styles.letterhead}>
            {logoUrl && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={logoUrl} style={styles.logo} />
            )}
            <View style={styles.letterheadText}>
              {organization?.name ? (
                <Text style={styles.clinicName}>{organization.name}</Text>
              ) : null}
              {organization?.address ? (
                <Text style={styles.clinicMeta}>{organization.address}</Text>
              ) : null}
              {organization?.phone ? (
                <Text style={styles.clinicMeta}>Tel: {organization.phone}</Text>
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.ruleThick} />

        {/* Title */}
        <View style={styles.titleBand}>
          <Text style={styles.title}>REFERRAL LETTER</Text>
        </View>

        <View style={styles.ruleThin} />

        {/* Date */}
        {metadata?.dateLabel ? (
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>{metadata.dateLabel}</Text>
          </View>
        ) : null}

        {/* Recipient block */}
        {hasRecipient && (
          <View style={styles.recipientBlock}>
            <Text style={styles.recipientToLabel}>To:</Text>
            {recipientName ? (
              <Text style={styles.recipientLine}>{recipientName}</Text>
            ) : null}
            {recipientSpecialty ? (
              <Text style={styles.recipientMeta}>{recipientSpecialty}</Text>
            ) : null}
            {recipientDept ? (
              <Text style={styles.recipientMeta}>{recipientDept}</Text>
            ) : null}
            {recipientFacility ? (
              <Text style={styles.recipientMeta}>{recipientFacility}</Text>
            ) : null}
          </View>
        )}

        {/* RE: patient */}
        {hasPatient && (
          <View style={styles.reBlock}>
            <View style={styles.reRow}>
              <Text style={styles.reLabel}>Re:</Text>
              <Text style={styles.rePatient}>{metadata!.patientName}</Text>
            </View>
            {patientMetaParts.length > 0 ? (
              <Text style={styles.reMeta}>{patientMetaParts.join("  |  ")}</Text>
            ) : null}
            {metadata?.patientEmail ? (
              <Text style={styles.reMeta}>Email: {metadata.patientEmail}</Text>
            ) : null}
          </View>
        )}

        {/* Divider before body */}
        <View style={[styles.ruleThin, { marginBottom: 14 }]} />

        {/* Letter body */}
        <View style={styles.body}>{renderParagraphs(letterText)}</View>

        {/* Signature */}
        <View style={styles.sigBlock}>
          <View style={styles.sigLine} />
          {metadata?.fromLine ? (
            <Text style={styles.sigName}>{metadata.fromLine}</Text>
          ) : null}
          {organization?.name && organization.name !== metadata?.fromLine ? (
            <Text style={styles.sigClinic}>{organization.name}</Text>
          ) : null}
        </View>

      </Page>
    </Document>
  );
}

export default ReferralDocument;
