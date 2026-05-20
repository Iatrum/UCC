import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app/(routes)/orders/checkout/[consultationId]/checkout-client.tsx"


class CheckoutDocumentPreviewStaticTest(unittest.TestCase):
    def read_source(self) -> str:
        return SOURCE.read_text()

    def test_patient_bill_card_keeps_only_preview_bill_button(self):
        source = self.read_source()
        self.assertEqual(source.count("Print bill"), 1)
        self.assertIn("Preview bill", source)
        self.assertIn("Add at least one billable item before previewing.", source)

    def test_document_preview_dialog_and_print_action_are_present(self):
        source = self.read_source()
        for expected in [
            "Document preview",
            "Print document",
            "onPreviewDocument={setDocumentPreviewItem}",
            "McDocument",
            "ReferralDocument",
            "PDFViewer",
        ]:
            self.assertIn(expected, source)


if __name__ == "__main__":
    unittest.main()
