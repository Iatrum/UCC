import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "components/orders/order-composer.tsx"


class OrderComposerDocumentDialogStaticTest(unittest.TestCase):
    def read_source(self) -> str:
        return SOURCE.read_text()

    def test_composer_search_opens_mc_dialog_before_adding_document_line(self):
        source = self.read_source()
        for expected in [
            "MEDICAL CERTIFICATE (MC)",
            "Fill out information below to complete document",
            "MC preview",
            "Complete document",
        ]:
            self.assertIn(expected, source)

    def test_composer_search_opens_referral_dialog_before_adding_document_line(self):
        source = self.read_source()
        for expected in [
            "REFERRAL LETTER",
            "Compose content",
            "Insert smart fields",
            "Patient name",
            "Referral to:",
            "defaultReferralContent",
            "buildReferralDefaultContent",
            "entry.meta?.referralContent || defaultReferralContent",
        ]:
            self.assertIn(expected, source)

    def test_referral_defaults_are_built_from_consultation_context(self):
        source = self.read_source()
        for expected in [
            "consultation?: {",
            "const clinicalSummary = htmlToPlainText(consultation?.chiefComplaint);",
            "const additionalNotes = htmlToPlainText(consultation?.notes);",
            "const progressNote = htmlToPlainText(consultation?.progressNote);",
            'const diagnosis = (consultation?.diagnosis || "").trim();',
            "const dateLabel = consultation?.date ? formatDisplayDate(consultation.date) : \"\";",
            "Thank you for seeing ${patientLabel}",
            "setReferralDiagnosis(entry.meta?.referralDiagnosis || defaultReferralDiagnosis);",
            "setReferralContent(entry.meta?.referralContent || defaultReferralContent);",
        ]:
            self.assertIn(expected, source)

    def test_referral_preview_preserves_multiline_paragraphs(self):
        source = self.read_source()
        for expected in [
            "function multilineTextToHtml(value: string): string",
            ".split(/\\n{2,}/)",
            'line-height: 1.65;',
            "referralBody: multilineTextToHtml(referralContent),",
            'className="min-h-[260px] leading-6"',
        ]:
            self.assertIn(expected, source)


if __name__ == "__main__":
    unittest.main()
