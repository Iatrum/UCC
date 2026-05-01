import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TABLE_SOURCE = ROOT / "components/inventory/inventory-table.tsx"
ADD_FORM_SOURCE = ROOT / "components/inventory/add-medication-form.tsx"
EDIT_FORM_SOURCE = ROOT / "components/inventory/edit-medication-form.tsx"


class InventoryAccessibilityValidationStaticTest(unittest.TestCase):
    def test_inventory_action_buttons_have_accessible_names(self):
        source = TABLE_SOURCE.read_text()

        for expected in [
            'aria-label={`Edit medication ${medication.name}`}',
            'title={`Edit medication ${medication.name}`}',
            'aria-label={`Delete medication ${medication.name}`}',
            'title={`Delete medication ${medication.name}`}',
        ]:
            self.assertIn(expected, source)

    def test_add_medication_form_shows_inline_validation_messages(self):
        source = ADD_FORM_SOURCE.read_text()

        for expected in [
            "validateMedicationForm",
            "noValidate",
            'role="alert"',
            "Medication name is required.",
            "Category is required.",
            "aria-invalid={Boolean(errors.name)}",
            "aria-invalid={Boolean(errors.category)}",
        ]:
            self.assertIn(expected, source)

    def test_edit_medication_form_shows_inline_validation_messages(self):
        source = EDIT_FORM_SOURCE.read_text()

        for expected in [
            "validateMedicationForm",
            "noValidate",
            'role="alert"',
            "Medication name is required.",
            "Category is required.",
            "aria-invalid={Boolean(errors.name)}",
            "aria-invalid={Boolean(errors.category)}",
        ]:
            self.assertIn(expected, source)


if __name__ == "__main__":
    unittest.main()
