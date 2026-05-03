import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { Patient } from "@/lib/models";
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
    borderBottomColor: PRIMARY,
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

  // Date row
  dateRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
    marginBottom: 16,
  },
  dateLabel: {
    fontSize: 10,
    color: MUTED,
    marginRight: 4,
  },
  dateValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: BODY,
  },

  // Patient details box
  patientBox: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 4,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 14,
    paddingRight: 14,
    marginBottom: 20,
    backgroundColor: "#f9fafb",
  },
  patientRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  patientLabel: {
    width: 100,
    fontSize: 10,
    color: MUTED,
    fontFamily: "Helvetica-Bold",
  },
  patientValue: {
    flex: 1,
    fontSize: 11,
    color: BODY,
  },

  // Certification
  certPara: {
    fontSize: 11,
    lineHeight: 1.6,
    color: BODY,
    marginBottom: 32,
  },

  // Signature block
  sigBlock: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: "auto",
  },
  sigLeft: {
    width: 200,
  },
  sigLine: {
    borderBottomWidth: 1,
    borderBottomColor: BODY,
    marginBottom: 6,
    width: 160,
  },
  sigName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BODY,
    marginBottom: 2,
  },
  sigTitle: {
    fontSize: 10,
    color: MUTED,
    marginBottom: 2,
  },
  sigDate: {
    fontSize: 10,
    color: MUTED,
  },
  stampBox: {
    width: 80,
    height: 80,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderStyle: "dashed",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  stampLabel: {
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
});

export interface McDocumentProps {
  patient: Patient;
  issuedDate: string;
  startDate: string;
  endDate: string;
  numDays: number;
  doctorName: string;
  organization?: OrganizationDetails | null;
}

export function McDocument({
  patient,
  issuedDate,
  startDate,
  endDate,
  numDays,
  doctorName,
  organization,
}: McDocumentProps) {
  const logoUrl = organization?.logoUrl ?? null;
  const hasLetterhead = Boolean(organization?.name || organization?.address || organization?.phone);

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
          <Text style={styles.title}>MEDICAL CERTIFICATE</Text>
        </View>

        <View style={styles.ruleThin} />

        {/* Date */}
        <View style={styles.dateRow}>
          <Text style={styles.dateLabel}>Date Issued:</Text>
          <Text style={styles.dateValue}>{issuedDate}</Text>
        </View>

        {/* Patient Details */}
        <View style={styles.patientBox}>
          <View style={styles.patientRow}>
            <Text style={styles.patientLabel}>Patient Name</Text>
            <Text style={styles.patientValue}>{patient.fullName}</Text>
          </View>
          <View style={[styles.patientRow, { marginBottom: 0 }]}>
            <Text style={styles.patientLabel}>NRIC / ID</Text>
            <Text style={styles.patientValue}>{patient.nric}</Text>
          </View>
        </View>

        {/* Certification */}
        <Text style={styles.certPara}>
          This is to certify that the above-named patient was examined at our clinic and is certified medically unfit for work/school from{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{startDate}</Text>
          {" "}to{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{endDate}</Text>
          {" "}({numDays} day{numDays > 1 ? "s" : ""}).
        </Text>

        {/* Signature */}
        <View style={styles.sigBlock}>
          <View style={styles.sigLeft}>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>{doctorName}</Text>
            <Text style={styles.sigTitle}>Medical Practitioner</Text>
            <Text style={styles.sigDate}>Date: {issuedDate}</Text>
          </View>
          <View style={styles.stampBox}>
            <Text style={styles.stampLabel}>Clinic</Text>
            <Text style={styles.stampLabel}>Stamp</Text>
          </View>
        </View>

      </Page>
    </Document>
  );
}
