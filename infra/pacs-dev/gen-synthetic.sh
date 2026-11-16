#!/usr/bin/env bash
# Generate synthetic DX DICOM with pydicom inside a throw-away container (the host has no pip),
# reusing the already-pulled Orthanc image for its python3. Output: <out-dir>/synthetic-<acc>-N.dcm
# Usage: ./gen-synthetic.sh <out-dir> <accession> [images]
# pydicom is installed once into a local cache dir (PYDICOM_CACHE, default ~/.cache/ucc-pacs-pydicom).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(mkdir -p "$1" && cd "$1" && pwd); acc=$2; n=${3:-1}
cache=${PYDICOM_CACHE:-$HOME/.cache/ucc-pacs-pydicom}; mkdir -p "$cache"
run() { docker run --rm --memory 256m --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONPATH=/py \
  -v "$cache:/py" -v "$here/gen-synthetic-dicom.py:/gen.py:ro" -v "$out:/out" "$@"; }
if [ ! -d "$cache/pydicom" ]; then
  run --entrypoint pip3 orthancteam/orthanc:26.11.0 install -q --no-cache-dir --target /py 'pydicom==3.0.1' >&2
fi
run --network none --entrypoint python3 orthancteam/orthanc:26.11.0 /gen.py --out /out --accession "$acc" --images "$n" \
  | sed "s#^/out#$out#"
