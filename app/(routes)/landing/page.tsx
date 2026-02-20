import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center text-center">
      <h1 className="text-3xl font-semibold tracking-tight">UCC EMR</h1>
      <p className="mt-4 text-base text-muted-foreground">
        A modern EMR platform for clinics on a single secure SaaS domain.
      </p>
      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Sign in
        </Link>
        <Link href="/login" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Clinic access
        </Link>
      </div>
    </div>
  );
}
