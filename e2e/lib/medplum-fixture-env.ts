export function hasLocalMedplumFixtureCredentials(): boolean {
  if (!process.env.MEDPLUM_CLIENT_ID || !process.env.MEDPLUM_CLIENT_SECRET) {
    try {
      process.loadEnvFile(new URL('../../.env.local', import.meta.url));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return Boolean(process.env.MEDPLUM_CLIENT_ID && process.env.MEDPLUM_CLIENT_SECRET);
}
