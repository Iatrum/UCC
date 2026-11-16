#!/usr/bin/env python3
"""Generate SYNTHETIC DX (digital X-ray) DICOM instances with pydicom. No real patient data:
the pixels are a computed test pattern and every identifier is fake.

  gen-synthetic-dicom.py --out DIR --accession UX123 [--images 1] [--patient-id FAKE-1] [--size 512]

Prints one line per file: <path>. All images share one study + one series.
"""
import argparse
import datetime
import math
import os
import struct

from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

DX_FOR_PRESENTATION = "1.2.840.10008.5.1.4.1.1.1.1"


def pattern(size: int, seed: int) -> bytes:
    """16-bit MONOCHROME2 test pattern: soft ellipse ("phantom"), ribs-like bands, corner marker."""
    out = bytearray()
    c = size / 2.0
    for y in range(size):
        for x in range(size):
            dx, dy = (x - c) / (size * 0.36), (y - c) / (size * 0.44)
            r = dx * dx + dy * dy
            v = 300.0
            if r < 1.0:
                v = 1400.0 + 1200.0 * (1.0 - r)
                v += 350.0 * math.sin((y + seed * 7) / (size / 28.0))  # bands
                if abs(dx) < 0.07:
                    v += 900.0  # central column
            if x < size // 10 and y < size // 10 and (x // 4 + y // 4) % 2 == 0:
                v = 3800.0  # checker marker = obviously synthetic
            out += struct.pack("<H", max(0, min(4095, int(v))))
    return bytes(out)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--accession", required=True)
    p.add_argument("--images", type=int, default=1)
    p.add_argument("--patient-id", default="FAKE-SYNTH-0001")
    p.add_argument("--size", type=int, default=512)
    a = p.parse_args()
    if len(a.accession) > 16:
        raise SystemExit("AccessionNumber is VR SH: max 16 characters")
    os.makedirs(a.out, exist_ok=True)
    now = datetime.datetime.now()
    study_uid, series_uid = generate_uid(), generate_uid()
    for i in range(1, a.images + 1):
        sop_uid = generate_uid()
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = DX_FOR_PRESENTATION
        meta.MediaStorageSOPInstanceUID = sop_uid
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.ImplementationClassUID = generate_uid()
        path = os.path.join(a.out, f"synthetic-{a.accession}-{i}.dcm")
        ds = FileDataset(path, {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID, ds.SOPInstanceUID = DX_FOR_PRESENTATION, sop_uid
        ds.StudyInstanceUID, ds.SeriesInstanceUID = study_uid, series_uid
        ds.PatientName, ds.PatientID = "FAKE^SYNTHETIC", a.patient_id
        ds.PatientBirthDate, ds.PatientSex = "19000101", "O"
        ds.AccessionNumber = a.accession
        ds.StudyDate = ds.SeriesDate = ds.ContentDate = now.strftime("%Y%m%d")
        ds.StudyTime = ds.SeriesTime = ds.ContentTime = now.strftime("%H%M%S")
        ds.StudyDescription = "SYNTHETIC TEST X-RAY"
        ds.SeriesDescription = "Synthetic PA"
        ds.Modality, ds.BodyPartExamined = "DX", "CHEST"
        ds.StudyID, ds.SeriesNumber, ds.InstanceNumber = "1", 1, i
        ds.Manufacturer, ds.InstitutionName = "UCC synthetic generator", "FAKE CLINIC"
        ds.ReferringPhysicianName = "FAKE^DOCTOR"
        ds.PresentationIntentType, ds.ImageType = "FOR PRESENTATION", ["DERIVED", "PRIMARY"]
        ds.BurnedInAnnotation = "NO"
        ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
        ds.Rows = ds.Columns = a.size
        ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
        ds.PixelSpacing = ds.ImagerPixelSpacing = [0.5, 0.5]
        ds.WindowCenter, ds.WindowWidth = 2000, 3600
        ds.RescaleIntercept, ds.RescaleSlope, ds.RescaleType = 0, 1, "US"
        ds.PixelIntensityRelationship, ds.PixelIntensityRelationshipSign = "LIN", 1
        ds.LossyImageCompression = "00"
        ds.PixelData = pattern(a.size, i)
        ds.save_as(path, enforce_file_format=True)
        print(path)


if __name__ == "__main__":
    main()
