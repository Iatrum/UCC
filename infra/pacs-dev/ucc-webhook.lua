-- Orthanc -> UCC: tell UCC that a study is complete (stable). UCC does NOT trust this payload for
-- anything clinical: it only learns the Orthanc study id, then reads the study from Orthanc itself
-- (server-side, with Orthanc credentials) and matches it by AccessionNumber. Auth: per-device key (#236).
-- OnStableStudy (not OnStoredInstance) so a multi-image study posts once, after the last image.
function OnStableStudy(studyId, tags, metadata)
  local url = os.getenv('UCC_INGRESS_URL')
  local key = os.getenv('UCC_DEVICE_KEY')
  if url == nil or key == nil or key == '' then
    PrintRecursive('ucc-webhook: UCC_INGRESS_URL / UCC_DEVICE_KEY not set, skipping')
    return
  end
  local body = DumpJson({ orthancStudyId = studyId }, false)
  local ok, err = pcall(function()
    HttpPost(url, body, { ['Content-Type'] = 'application/json', ['Authorization'] = 'Bearer ' .. key })
  end)
  if not ok then PrintRecursive('ucc-webhook: POST failed: ' .. tostring(err)) end
end
