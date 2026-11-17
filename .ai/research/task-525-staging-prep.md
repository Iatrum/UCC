# Task 525 staging prep notes
- Medplum config: file path argument and `MEDPLUM_*` env mapping per https://www.medplum.com/docs/self-hosting/setting-configuration and https://www.medplum.com/docs/self-hosting/running-medplum-docker-container (container takes one config-path argument, `file:`). Compose uses a generated JSON config (the signing key is multi-line PEM, awkward as env).
- Not verified (no server access allowed): exact config keys accepted by the pinned image, Postgres major version, bootstrap of the first project/super admin on an empty DB, `binaryStorage` path persistence (no volume for binaries yet, fine for fake data).
- Compose `env_file` `required: false` needs Compose >= 2.24 (https://docs.docker.com/reference/compose-file/services/#env_file).
- Validated only with `docker compose config`; nothing was started.
