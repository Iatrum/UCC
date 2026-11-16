-- Orthanc -> UCC: tell UCC that a study is complete (stable). UCC does NOT trust this payload for
-- anything clinical: it only learns the Orthanc study id, then reads the study from Orthanc itself
-- (server-side, with Orthanc credentials) and matches it by AccessionNumber. Auth: per-device key (#236).
-- OnStableStudy (not OnStoredInstance) so a multi-image study posts once, after the last image.
--
-- The device key is read on every event from the file UCC_DEVICE_KEY_FILE (default
-- /run/ucc/device-key, a read-only mount), falling back to the UCC_DEVICE_KEY env var. A file means
-- the key can be rotated without restarting Orthanc. The key is never logged.
local function deviceKey()
  local path = os.getenv('UCC_DEVICE_KEY_FILE') or '/run/ucc/device-key'
  local file = io.open(path, 'r')
  if file then
    local key = file:read('*l')
    file:close()
    if key and key ~= '' then return key end
  end
  return os.getenv('UCC_DEVICE_KEY')
end

function OnStableStudy(studyId, tags, metadata)
  local url = os.getenv('UCC_INGRESS_URL')
  local key = deviceKey()
  if url == nil or url == '' or key == nil or key == '' then
    print('ucc-webhook: UCC_INGRESS_URL or device key not set, skipping ' .. studyId)
    return
  end
  local body = DumpJson({ orthancStudyId = studyId }, false)
  local ok, err = pcall(function()
    HttpPost(url, body, { ['Content-Type'] = 'application/json', ['Authorization'] = 'Bearer ' .. key })
  end)
  if not ok then print('ucc-webhook: POST failed for ' .. studyId .. ': ' .. tostring(err)) end
end
