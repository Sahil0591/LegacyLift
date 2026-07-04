export function hasConfiguredValue(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    !normalized.includes("your-") &&
    !normalized.includes("placeholder")
  );
}

export const clerkEnabled = hasConfiguredValue(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
